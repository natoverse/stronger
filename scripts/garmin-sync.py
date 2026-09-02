#!/usr/bin/env python3
"""Garmin Sync — Garmin Connect -> Firestore pipeline.

Fetches recent activities from Garmin Connect and merges them into yearly
Firestore bucket documents. Uses a saved ``garminconnect`` token bundle for
Garmin auth (no interactive login at run time) and a Firebase service account
for Firestore access.

The provider payload is normalized to the shared activity model used by the
Firebase UI. See specs/031-garmin-direct-sync.spec.md and
specs/052-direct-firestore-sync-actions.spec.md.

Environment variables (all required):
  GARMIN_TOKENS               – ``garminconnect`` token bundle (contents of the
                                saved ``garmin_tokens.json``)
  FIREBASE_SERVICE_ACCOUNT_KEY – JSON key for the Firebase service account
  FIREBASE_USER_ID             – destination UID below ``/users/{uid}``

Flags:
  --backfill   One-time import of full history since ``BACKFILL_START_DATE``
               (2015-01-01) instead of the rolling recent-activity fetch.
               Implies ``--overwrite``.
  --overwrite  Upsert mode: replace matching activity IDs inside their yearly
               buckets. Unrelated entries remain unchanged.

Usage:
  python scripts/garmin-sync.py [--backfill] [--overwrite]
"""

from __future__ import annotations

import os
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

from firestore_sync import get_firestore_access, merge_year_bucket_entries

HEADER = [
    "date",
    "activityId",
    "activityType",
    "name",
    "duration",
    "movingDuration",
    "distance",
    "elevationGain",
    "elevationLoss",
    "avgHR",
    "maxHR",
    "avgSpeed",
    "maxSpeed",
    "steps",
    "aerobicTE",
    "anaerobicTE",
    "vo2Max",
]
COLUMN_COUNT = len(HEADER)  # 17 -> columns A:Q
ACTIVITY_LIMIT = 30

# One-time backfill window (used only with the --backfill flag): 2015-01-01.
# Matches the earliest year selectable in the in-app year picker.
BACKFILL_START_DATE = "2015-01-01"


# ---------------------------------------------------------------------------
# Garmin Connect (via garminconnect)
# ---------------------------------------------------------------------------

def login_from_tokens(token_bundle):
    """Return an authenticated ``garminconnect.Garmin`` client from saved tokens.

    ``token_bundle`` is the contents of a ``garmin_tokens.json`` file (as minted
    once via a local login — see GARMIN_SYNC_SETUP.md). We write it into a
    temporary token directory and resume from it so there is no interactive
    login at run time. garminconnect refreshes the short-lived DI access token
    automatically when it is about to expire.
    """
    from garminconnect import Garmin

    token_dir = tempfile.mkdtemp(prefix="garmin-tokens-")
    (Path(token_dir) / "garmin_tokens.json").write_text(token_bundle)

    garmin = Garmin()
    garmin.login(token_dir)
    return garmin


def fetch_recent_activities(client, limit=ACTIVITY_LIMIT):
    """Fetch the most recent activities from Garmin Connect."""
    activities = client.get_activities(0, limit)
    return activities or []


def activity_fetch_end_date(today=None):
    """Return the exclusive date bound for activity-range requests.

    Include the following calendar day so activities near a UTC boundary are not
    excluded when Garmin interprets a date-only end bound at midnight.
    """
    return ((today or date.today()) + timedelta(days=1)).isoformat()


def fetch_activities_since(client, start_date):
    """Fetch every activity on/after ``start_date`` (inclusive).

    ``start_date`` is a ``YYYY-MM-DD`` string. Used for one-time backfills
    (e.g. pulling history back to 2015). Garmin Connect keeps your full
    history, so the only limit on how far back this reaches is the date you
    pass. ``get_activities_by_date`` pages through the range internally.
    """
    end_date = activity_fetch_end_date()
    activities = client.get_activities_by_date(start_date, end_date)
    return activities or []


def _round_int(value):
    try:
        return str(round(float(value)))
    except (TypeError, ValueError):
        return "0"


def _round_dec(value, ndigits=2):
    """Round to ``ndigits`` decimals, trimming trailing zeros. Defaults to "0"."""
    try:
        rounded = round(float(value), ndigits)
    except (TypeError, ValueError):
        return "0"
    # Format without a trailing ".0" / trailing zeros (e.g. 3.50 -> "3.5").
    text = f"{rounded:.{ndigits}f}".rstrip("0").rstrip(".")
    return text or "0"


def activity_to_row(activity):
    """Convert a Garmin activity dict to the legacy row shape.

    The intermediate row keeps mapping behavior identical to the one-time
    migration before it is converted to the Firestore application model.
    """
    start = activity.get("startTimeLocal") or activity.get("startTimeGMT") or ""
    date = start[:10]  # "YYYY-MM-DD"

    activity_id = activity.get("activityId")
    activity_id = str(activity_id) if activity_id is not None else ""

    if not date or not activity_id:
        return None

    activity_type = ""
    type_info = activity.get("activityType")
    if isinstance(type_info, dict):
        activity_type = type_info.get("typeKey") or ""

    return [
        date,
        activity_id,
        activity_type,
        activity.get("activityName") or "",
        _round_int(activity.get("duration", 0)),
        _round_int(activity.get("movingDuration", 0)),
        _round_int(activity.get("distance", 0)),
        _round_int(activity.get("elevationGain", 0)),
        _round_int(activity.get("elevationLoss", 0)),
        _round_int(activity.get("averageHR", 0)),
        _round_int(activity.get("maxHR", 0)),
        _round_dec(activity.get("averageSpeed", 0)),
        _round_dec(activity.get("maxSpeed", 0)),
        _round_int(activity.get("steps", 0)),
        _round_dec(activity.get("aerobicTrainingEffect", 0), 1),
        _round_dec(activity.get("anaerobicTrainingEffect", 0), 1),
        _round_dec(activity.get("vO2MaxValue", 0), 1),
    ]


def activity_row_to_entry(row):
    """Convert the legacy row shape to the Firestore activity model."""
    activity_type = normalize_activity_type(row[2])
    if not activity_type:
        return None
    return {
        "date": row[0],
        "stravaId": row[1],
        "activityType": activity_type,
        "name": row[3],
        "duration": int(row[4]),
        "distance": int(row[6]),
        "elevationGain": int(row[7]),
        "elevationLoss": int(row[8]),
        "calories": 0,
        "avgHR": int(row[9]),
        "maxHR": int(row[10]),
    }


def normalize_activity_type(value):
    key = str(value or "").strip().lower()
    if key == "strength_training":
        return "Weight Training"
    return " ".join(word.capitalize() for word in key.split("_") if word)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    import requests

    garmin_tokens = os.environ.get("GARMIN_TOKENS")
    service_account_key = os.environ.get("FIREBASE_SERVICE_ACCOUNT_KEY")
    uid = os.environ.get("FIREBASE_USER_ID")
    backfill = "--backfill" in sys.argv
    # Backfill implies overwrite so re-running a full sync also refreshes edits
    # to older activities (not just appends new ones).
    overwrite = backfill or "--overwrite" in sys.argv

    if not garmin_tokens:
        raise SystemExit("Missing GARMIN_TOKENS environment variable")
    if not service_account_key:
        raise SystemExit("Missing FIREBASE_SERVICE_ACCOUNT_KEY environment variable")
    if not uid:
        raise SystemExit("Missing FIREBASE_USER_ID environment variable")

    # 1. Authenticate with Garmin using the saved token bundle.
    print("Loading Garmin tokens...")
    garmin = login_from_tokens(garmin_tokens)

    # 2. Fetch activities. Normally the most recent activities for the daily
    #    incremental sync; with --backfill, everything since BACKFILL_START_DATE
    #    for a one-time import of full history. Dedup by activity ID keeps both
    #    safe to re-run.
    if backfill:
        print(f"Backfilling all activities since {BACKFILL_START_DATE}...")
        activities = fetch_activities_since(garmin, BACKFILL_START_DATE)
    else:
        print("Fetching recent activities from Garmin Connect...")
        activities = fetch_recent_activities(garmin, ACTIVITY_LIMIT)
    print(f"Fetched {len(activities)} activities from Garmin.")

    # 3. Authenticate with Firestore.
    print("Authenticating with Firestore...")
    project_id, firestore_token = get_firestore_access(service_account_key)
    session = requests.Session()

    # 4. Convert fetched activities to the exact model stored by migration.
    rows = [r for r in (activity_to_row(a) for a in activities) if r is not None]
    entries = [
        entry
        for entry in (activity_row_to_entry(row) for row in rows)
        if entry is not None
    ]
    if not entries:
        print("No valid activities to sync.")
        return

    result = merge_year_bucket_entries(
        session,
        project_id,
        firestore_token,
        uid,
        "garminActivities",
        entries,
        "stravaId",
        overwrite,
    )
    print(
        f"Done — added {result['added']}, updated {result['updated']} "
        "Garmin activities in Firestore."
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as err:  # noqa: BLE001 — top-level guard mirrors strava-sync
        print(f"Garmin sync failed: {err}", file=sys.stderr)
        sys.exit(1)
