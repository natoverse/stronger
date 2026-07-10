#!/usr/bin/env python3
"""Garmin Sync — Garmin Connect -> Google Sheets pipeline.

Fetches recent activities from Garmin Connect and appends new rows to the
"Stronger - Garmin" tab in a Google Sheet. Uses a saved ``garth`` token dump
for Garmin auth (no interactive login at run time) and a Google service
account for Sheets access.

The tab uses a Garmin-native schema that is richer than the legacy Strava
layout (moving duration, elevation loss, speeds, steps, training effect,
VO2 max). The old "Stronger - Strava" tab is left in place and deprecated
gradually. See specs/031-garmin-direct-sync.spec.md.

Environment variables (all required):
  GARMIN_TOKENS               – base64 ``garth`` token dump (garth.client.dumps())
  GOOGLE_SERVICE_ACCOUNT_KEY  – JSON key for the Google service account
  SPREADSHEET_ID              – Google Sheets spreadsheet ID

Usage:
  python scripts/garmin-sync.py
"""

from __future__ import annotations

import json
import os
import sys
from urllib.parse import quote

SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets"

TAB_NAME = "Stronger - Garmin"
# Garmin-native schema. Column B (`activityId`) is the dedup key. This is
# intentionally richer than the legacy Strava layout; the app view that reads
# it is migrated separately (the Strava tab is deprecated gradually).
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
    "calories",
    "avgHR",
    "maxHR",
    "avgSpeed",
    "maxSpeed",
    "steps",
    "aerobicTE",
    "anaerobicTE",
    "vo2Max",
]
COLUMN_COUNT = len(HEADER)  # 18 -> columns A:R
ACTIVITY_LIMIT = 30


# ---------------------------------------------------------------------------
# Garmin Connect (via garth)
# ---------------------------------------------------------------------------

def fetch_recent_activities(limit=ACTIVITY_LIMIT):
    """Fetch the most recent activities from Garmin Connect.

    Assumes ``garth`` has already been authenticated (tokens loaded).
    """
    import garth

    activities = garth.connectapi(
        "/activitylist-service/activities/search/activities",
        params={"start": 0, "limit": limit},
    )
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
    """Convert a Garmin activity dict to a spreadsheet row.

    Returns ``None`` for activities missing required fields (date or id) —
    these would fail to parse when read back by the app.
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
        _round_int(activity.get("calories", 0)),
        _round_int(activity.get("averageHR", 0)),
        _round_int(activity.get("maxHR", 0)),
        _round_dec(activity.get("averageSpeed", 0)),
        _round_dec(activity.get("maxSpeed", 0)),
        _round_int(activity.get("steps", 0)),
        _round_dec(activity.get("aerobicTrainingEffect", 0), 1),
        _round_dec(activity.get("anaerobicTrainingEffect", 0), 1),
        _round_dec(activity.get("vO2MaxValue", 0), 1),
    ]


# ---------------------------------------------------------------------------
# Google Sheets (service account via REST)
# ---------------------------------------------------------------------------

def get_google_access_token(service_account_key):
    from google.auth.transport.requests import Request
    from google.oauth2 import service_account

    key = (
        json.loads(service_account_key)
        if isinstance(service_account_key, str)
        else service_account_key
    )
    creds = service_account.Credentials.from_service_account_info(
        key,
        scopes=["https://www.googleapis.com/auth/spreadsheets"],
    )
    creds.refresh(Request())
    return creds.token


def _column_letter(count):
    # A=1 ... Z=26. HEADER has <= 26 columns.
    return chr(64 + count)


def _sheets_get(session, url, token):
    res = session.get(url, headers={"Authorization": f"Bearer {token}"})
    if not res.ok:
        raise RuntimeError(f"Sheets GET failed ({res.status_code}): {res.text}")
    return res.json()


def ensure_tab(session, spreadsheet_id, token):
    meta = _sheets_get(
        session,
        f"{SHEETS_API_BASE}/{spreadsheet_id}?fields=sheets.properties.title",
        token,
    )
    titles = {
        s.get("properties", {}).get("title") for s in meta.get("sheets", [])
    }
    if TAB_NAME in titles:
        return

    create_res = session.post(
        f"{SHEETS_API_BASE}/{spreadsheet_id}:batchUpdate",
        headers={"Authorization": f"Bearer {token}"},
        json={"requests": [{"addSheet": {"properties": {"title": TAB_NAME}}}]},
    )
    if not create_res.ok:
        raise RuntimeError(
            f"Tab creation failed ({create_res.status_code}): {create_res.text}"
        )

    col = _column_letter(COLUMN_COUNT)
    header_range = quote(f"'{TAB_NAME}'!A1:{col}1")
    header_res = session.put(
        f"{SHEETS_API_BASE}/{spreadsheet_id}/values/{header_range}"
        "?valueInputOption=RAW",
        headers={"Authorization": f"Bearer {token}"},
        json={"values": [HEADER]},
    )
    if not header_res.ok:
        raise RuntimeError(
            f"Header write failed ({header_res.status_code}): {header_res.text}"
        )
    print(f'Created "{TAB_NAME}" tab with header row.')


def read_existing_ids(session, spreadsheet_id, token):
    # Read the id column (column B, starting from row 2).
    id_range = quote(f"'{TAB_NAME}'!B2:B")
    data = _sheets_get(
        session,
        f"{SHEETS_API_BASE}/{spreadsheet_id}/values/{id_range}",
        token,
    )
    ids = set()
    for row in data.get("values", []):
        if row and row[0]:
            ids.add(row[0].strip())
    return ids


def append_rows(session, spreadsheet_id, token, rows):
    if not rows:
        return
    col = _column_letter(COLUMN_COUNT)
    append_range = quote(f"'{TAB_NAME}'!A:{col}")
    res = session.post(
        f"{SHEETS_API_BASE}/{spreadsheet_id}/values/{append_range}:append"
        "?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
        headers={"Authorization": f"Bearer {token}"},
        json={"values": rows},
    )
    if not res.ok:
        raise RuntimeError(f"Append rows failed ({res.status_code}): {res.text}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    import garth
    import requests

    garmin_tokens = os.environ.get("GARMIN_TOKENS")
    service_account_key = os.environ.get("GOOGLE_SERVICE_ACCOUNT_KEY")
    spreadsheet_id = os.environ.get("SPREADSHEET_ID")

    if not garmin_tokens:
        raise SystemExit("Missing GARMIN_TOKENS environment variable")
    if not service_account_key:
        raise SystemExit("Missing GOOGLE_SERVICE_ACCOUNT_KEY environment variable")
    if not spreadsheet_id:
        raise SystemExit("Missing SPREADSHEET_ID environment variable")

    # 1. Authenticate with Garmin using the saved token dump.
    print("Loading Garmin tokens...")
    garth.client.loads(garmin_tokens)

    # 2. Fetch recent activities.
    print("Fetching recent activities from Garmin Connect...")
    activities = fetch_recent_activities(ACTIVITY_LIMIT)
    print(f"Fetched {len(activities)} activities from Garmin.")

    # 3. Authenticate with Google Sheets.
    print("Authenticating with Google Sheets...")
    google_token = get_google_access_token(service_account_key)

    session = requests.Session()

    # 4. Ensure the tab exists.
    ensure_tab(session, spreadsheet_id, google_token)

    # 5. Read existing IDs for deduplication.
    existing_ids = read_existing_ids(session, spreadsheet_id, google_token)
    print(f"Found {len(existing_ids)} existing activities in sheet.")

    # 6. Convert and filter new activities.
    new_rows = []
    for activity in activities:
        row = activity_to_row(activity)
        if row is not None and row[1] not in existing_ids:  # row[1] = id
            new_rows.append(row)

    if not new_rows:
        print("No new activities to sync.")
        return

    # 7. Append new rows.
    print(f"Appending {len(new_rows)} new activities...")
    append_rows(session, spreadsheet_id, google_token, new_rows)
    print(f"Done — synced {len(new_rows)} new activities.")


if __name__ == "__main__":
    try:
        main()
    except Exception as err:  # noqa: BLE001 — top-level guard mirrors strava-sync
        print(f"Garmin sync failed: {err}", file=sys.stderr)
        sys.exit(1)
