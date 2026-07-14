#!/usr/bin/env python3
"""Sheet Backup — copy every tab from a source spreadsheet to a backup one.

Replaces the old in-app "backup after each workout save" logic with a simple,
scheduled pipeline: once a day, copy all tab data from the source (primary)
spreadsheet into a separate backup spreadsheet. Uses a Google service account
for Sheets access (no interactive login at run time), mirroring the other
sync scripts in this directory.

The copy is value-only (not formatting): for each tab present in the source,
the matching tab in the backup is created if missing, cleared, and rewritten
with the source values. Tabs that exist only in the backup are left untouched.

Environment variables (all required):
  GOOGLE_SERVICE_ACCOUNT_KEY  – JSON key for the Google service account
  SOURCE_SPREADSHEET_ID       – spreadsheet to copy from (the primary sheet)
  BACKUP_SPREADSHEET_ID       – spreadsheet to copy into (the backup target)

Usage:
  python scripts/sheet-backup.py
"""

from __future__ import annotations

import json
import os
import sys
from urllib.parse import quote

SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets"

# Open-ended column range used when reading/writing entire tab contents.
FULL_COLUMN_RANGE = "A:ZZ"


# ---------------------------------------------------------------------------
# Pure helpers (offline-testable)
# ---------------------------------------------------------------------------

def tabs_to_copy(source_titles):
    """Return the ordered list of source tab titles to copy.

    Preserves source order and drops duplicates while keeping the first
    occurrence.
    """
    seen = set()
    ordered = []
    for title in source_titles:
        if title and title not in seen:
            seen.add(title)
            ordered.append(title)
    return ordered


def tabs_to_create(source_titles, target_titles):
    """Return source tabs that are missing from the target, in source order."""
    existing = set(target_titles)
    return [t for t in tabs_to_copy(source_titles) if t not in existing]


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


def _sheets_get(session, url, token):
    res = session.get(url, headers={"Authorization": f"Bearer {token}"})
    if not res.ok:
        raise RuntimeError(f"Sheets GET failed ({res.status_code}): {res.text}")
    return res.json()


def list_tab_titles(session, spreadsheet_id, token):
    meta = _sheets_get(
        session,
        f"{SHEETS_API_BASE}/{spreadsheet_id}?fields=sheets.properties.title",
        token,
    )
    return [
        s.get("properties", {}).get("title")
        for s in meta.get("sheets", [])
        if s.get("properties", {}).get("title")
    ]


def add_tab(session, spreadsheet_id, token, tab_name):
    res = session.post(
        f"{SHEETS_API_BASE}/{spreadsheet_id}:batchUpdate",
        headers={"Authorization": f"Bearer {token}"},
        json={"requests": [{"addSheet": {"properties": {"title": tab_name}}}]},
    )
    if not res.ok:
        raise RuntimeError(
            f"Tab creation failed for {tab_name!r} "
            f"({res.status_code}): {res.text}"
        )


def read_tab_values(session, spreadsheet_id, token, tab_name):
    read_range = quote(f"'{tab_name}'!{FULL_COLUMN_RANGE}")
    data = _sheets_get(
        session,
        f"{SHEETS_API_BASE}/{spreadsheet_id}/values/{read_range}",
        token,
    )
    return data.get("values", [])


def clear_tab(session, spreadsheet_id, token, tab_name):
    clear_range = quote(f"'{tab_name}'!{FULL_COLUMN_RANGE}")
    res = session.post(
        f"{SHEETS_API_BASE}/{spreadsheet_id}/values/{clear_range}:clear",
        headers={"Authorization": f"Bearer {token}"},
        json={},
    )
    if not res.ok:
        raise RuntimeError(
            f"Clear failed for {tab_name!r} ({res.status_code}): {res.text}"
        )


def write_tab_values(session, spreadsheet_id, token, tab_name, values):
    if not values:
        return
    write_range = quote(f"'{tab_name}'!A1")
    res = session.put(
        f"{SHEETS_API_BASE}/{spreadsheet_id}/values/{write_range}"
        "?valueInputOption=RAW",
        headers={"Authorization": f"Bearer {token}"},
        json={"values": values},
    )
    if not res.ok:
        raise RuntimeError(
            f"Write failed for {tab_name!r} ({res.status_code}): {res.text}"
        )


def copy_spreadsheet(session, source_id, backup_id, token):
    """Copy every source tab's values into the backup spreadsheet."""
    source_titles = list_tab_titles(session, source_id, token)
    backup_titles = list_tab_titles(session, backup_id, token)
    backup_set = set(backup_titles)

    copied = 0
    for tab_name in tabs_to_copy(source_titles):
        values = read_tab_values(session, source_id, token, tab_name)

        if tab_name not in backup_set:
            add_tab(session, backup_id, token, tab_name)
            backup_set.add(tab_name)

        clear_tab(session, backup_id, token, tab_name)
        write_tab_values(session, backup_id, token, tab_name, values)
        print(f'Copied "{tab_name}" ({len(values)} rows).')
        copied += 1

    return copied


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    import requests

    service_account_key = os.environ.get("GOOGLE_SERVICE_ACCOUNT_KEY")
    source_id = os.environ.get("SOURCE_SPREADSHEET_ID")
    backup_id = os.environ.get("BACKUP_SPREADSHEET_ID")

    if not service_account_key:
        raise SystemExit("Missing GOOGLE_SERVICE_ACCOUNT_KEY environment variable")
    if not source_id:
        raise SystemExit("Missing SOURCE_SPREADSHEET_ID environment variable")
    if not backup_id:
        raise SystemExit("Missing BACKUP_SPREADSHEET_ID environment variable")
    if source_id == backup_id:
        raise SystemExit("SOURCE_SPREADSHEET_ID and BACKUP_SPREADSHEET_ID must differ")

    print("Authenticating with Google Sheets...")
    token = get_google_access_token(service_account_key)

    session = requests.Session()

    print("Copying source spreadsheet to backup...")
    copied = copy_spreadsheet(session, source_id, backup_id, token)
    print(f"Done — backed up {copied} tab(s).")


if __name__ == "__main__":
    try:
        main()
    except Exception as err:  # noqa: BLE001 — top-level guard mirrors garmin-sync
        print(f"Sheet backup failed: {err}", file=sys.stderr)
        sys.exit(1)
