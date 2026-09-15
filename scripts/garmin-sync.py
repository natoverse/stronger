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

Malformed provider records are printed and skipped instead of aborting the run.
A final summary (fetched/valid/skipped/added/updated/status) is printed and, when
running in GitHub Actions, appended to ``GITHUB_STEP_SUMMARY`` and
``GITHUB_OUTPUT``.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path

from firestore_sync import get_firestore_access, merge_year_bucket_entries

HEADER = [
    "timestamp",
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

# Cap on how many invalid records are printed individually so a bad backfill
# cannot flood the job log. The summary always reports exact totals.
INVALID_PRINT_LIMIT = 50
# Characters of an invalid record shown in the log (Garmin payloads are large).
INVALID_RECORD_CHARS = 400

# Counters reported at the end of the run (also exported to the workflow).
SUMMARY = {
    "fetched": 0,
    "valid": 0,
    "skipped": 0,
    "added": 0,
    "updated": 0,
    "status": "not-started",
}


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


def parse_start_timestamp(value):
    """Return an ISO timestamp for a Garmin start time, or ``None`` if unusable."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.isoformat(timespec="seconds")


def activity_to_row(activity):
    """Convert a Garmin activity dict to the legacy row shape.

    The intermediate row keeps mapping behavior identical to the one-time
    migration before it is converted to the Firestore application model.
    """
    start = activity.get("startTimeLocal") or activity.get("startTimeGMT") or ""
    timestamp = parse_start_timestamp(start) or ""

    activity_id = activity.get("activityId")
    activity_id = str(activity_id) if activity_id is not None else ""

    if not timestamp or not activity_id:
        return None

    activity_type = ""
    type_info = activity.get("activityType")
    if isinstance(type_info, dict):
        activity_type = type_info.get("typeKey") or ""

    return [
        timestamp,
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
        "timestamp": row[0],
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
# Validation / diagnostics
# ---------------------------------------------------------------------------

def activity_issues(activity):
    """Return the reasons ``activity`` cannot be synced (empty list when valid)."""
    if not isinstance(activity, dict):
        return [f"record is not an object (got {type(activity).__name__})"]

    reasons = []
    start = activity.get("startTimeLocal") or activity.get("startTimeGMT")
    if start in (None, ""):
        reasons.append("missing startTimeLocal/startTimeGMT")
    elif parse_start_timestamp(start) is None:
        reasons.append(f"malformed start time: {start!r}")

    if activity.get("activityId") in (None, ""):
        reasons.append("missing activityId")

    return reasons


def safe_record_repr(record, limit=INVALID_RECORD_CHARS):
    """Return a truncated, JSON-ish view of a Garmin record for logging.

    Only the provider payload is rendered — never environment configuration —
    and the output is truncated so one malformed record cannot flood the log.
    """
    try:
        text = json.dumps(record, default=str, sort_keys=True)
    except (TypeError, ValueError):
        text = repr(record)
    if len(text) > limit:
        return f"{text[:limit]}… (truncated)"
    return text


def build_entries(activities):
    """Map fetched activities to Firestore entries, collecting invalid records.

    Validation is two-phase: ``activity_issues`` checks the raw provider
    payload, and records that survive it are still skipped when they cannot be
    mapped to a Firestore entry (e.g. an unusable activity type).

    Returns ``(entries, invalid)`` where ``invalid`` holds one dict per skipped
    record with its ``index``, ``reasons`` and a safe ``record`` preview.
    """
    entries = []
    invalid = []
    for index, activity in enumerate(activities):
        reasons = activity_issues(activity)
        entry = None
        if not reasons:
            row = activity_to_row(activity)
            entry = activity_row_to_entry(row) if row is not None else None
            if entry is None:
                reasons = ["record could not be mapped to a Firestore entry"]
        if reasons:
            invalid.append({
                "index": index,
                "reasons": reasons,
                "record": safe_record_repr(activity),
            })
            continue
        entries.append(entry)
    return entries, invalid


def print_invalid_records(invalid, limit=INVALID_PRINT_LIMIT):
    """Print each skipped record so the scale of the problem is visible."""
    if not invalid:
        return
    print(f"Skipping {len(invalid)} invalid Garmin record(s):")
    for item in invalid[:limit]:
        print(
            f"  [{item['index']}] {'; '.join(item['reasons'])} :: {item['record']}"
        )
    if len(invalid) > limit:
        print(f"  … {len(invalid) - limit} more invalid record(s) not shown.")


# ---------------------------------------------------------------------------
# Run summary
# ---------------------------------------------------------------------------

def format_summary(summary):
    return (
        "Garmin sync summary — "
        f"fetched {summary['fetched']}, "
        f"valid {summary['valid']}, "
        f"skipped {summary['skipped']}, "
        f"added {summary['added']}, "
        f"updated {summary['updated']} "
        f"(status: {summary['status']})"
    )


def summary_markdown(summary):
    return "\n".join([
        "### Garmin sync summary",
        "",
        "| Metric | Count |",
        "| --- | --- |",
        f"| Fetched | {summary['fetched']} |",
        f"| Valid | {summary['valid']} |",
        f"| Skipped | {summary['skipped']} |",
        f"| Added | {summary['added']} |",
        f"| Updated | {summary['updated']} |",
        f"| Status | {summary['status']} |",
        "",
    ])


def _append_file(path, text):
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(text)


def report_summary(summary=None, env=None):
    """Print the summary and expose it to GitHub Actions.

    Values are plain counts plus a single-word status, so they are safe to
    write to ``GITHUB_OUTPUT`` and to echo from the workflow.
    """
    summary = SUMMARY if summary is None else summary
    env = os.environ if env is None else env

    print(format_summary(summary))

    step_summary = env.get("GITHUB_STEP_SUMMARY")
    if step_summary:
        _append_file(step_summary, summary_markdown(summary))

    output = env.get("GITHUB_OUTPUT")
    if output:
        _append_file(
            output,
            "".join(f"{key}={value}\n" for key, value in summary.items()),
        )


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
    SUMMARY["fetched"] = len(activities)

    # 3. Authenticate with Firestore.
    print("Authenticating with Firestore...")
    project_id, firestore_token = get_firestore_access(service_account_key)
    session = requests.Session()

    # 4. Convert fetched activities to the exact model stored by migration.
    #    Malformed provider records are printed and skipped so a single bad
    #    activity cannot abort the whole sync.
    entries, invalid = build_entries(activities)
    print_invalid_records(invalid)
    SUMMARY["valid"] = len(entries)
    SUMMARY["skipped"] = len(invalid)
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
    SUMMARY["added"] = result["added"]
    SUMMARY["updated"] = result["updated"]
    print(
        f"Done — added {result['added']}, updated {result['updated']} "
        "Garmin activities in Firestore."
    )


if __name__ == "__main__":
    try:
        main()
        SUMMARY["status"] = "success"
    except Exception as err:  # noqa: BLE001 — top-level guard mirrors strava-sync
        SUMMARY["status"] = "failed"
        print(f"Garmin sync failed: {err}", file=sys.stderr)
        report_summary()
        sys.exit(1)
    report_summary()
