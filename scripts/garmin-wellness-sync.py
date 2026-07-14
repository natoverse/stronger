#!/usr/bin/env python3
"""Garmin Wellness Sync — Garmin Connect daily wellness metrics → Google Sheets.

Writes one row per day to the "Stronger - Garmin Wellness" tab with all of:
  HRV, sleep, body battery, training readiness, training status, acute/chronic
  load, steps, floors, resting HR, VO2 max (running), intensity minutes, hill
  score, and endurance score.

Environment variables (all required):
  GARMIN_TOKENS               – garminconnect token bundle
  GOOGLE_SERVICE_ACCOUNT_KEY  – JSON key for the Google service account
  SPREADSHEET_ID              – Google Sheets spreadsheet ID

Flags:
  --backfill  Sync every date since BACKFILL_START_DATE (2021-01-01) instead
              of the rolling 14-day window. Idempotent: skips dates already in
              the sheet.

Usage:
  python scripts/garmin-wellness-sync.py [--backfill]
"""

from __future__ import annotations

import json
import os
import sys
import time
import tempfile
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import quote

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets"
TAB_NAME = "Stronger - Garmin Wellness"

# 23 columns today — keep in sync with src/google/sheets.ts GARMIN_WELLNESS_HEADER.
# Range math below derives from len(HEADER), so this script keeps working if the
# schema grows or shrinks later.
HEADER = [
    "date",
    "hrvWeeklyAvg", "hrvStatus",
    "sleepDurationSec", "sleepDeepSec", "sleepLightSec",
    "sleepRemSec", "sleepAwakeSec", "sleepScore",
    "bodyBatteryHigh", "bodyBatteryLow",
    "readinessScore",
    "trainingStatus", "trainingAcuteLoad", "trainingChronicLoad",
    "steps", "floors", "restingHR", "vo2Max",
    "intensityMinModerate", "intensityMinVigorous",
    "hillScore", "enduranceScore",
]
COLUMN_COUNT = len(HEADER)   # currently 23 → A:W

ROLLING_DAYS = 14
BACKFILL_START_DATE = "2021-01-01"
PER_DATE_DELAY = 0.15   # seconds between dates (rate-limit courtesy)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _num(v, decimals: int = 1) -> str:
    """Return a sheet-ready string for v, or '' if null/invalid."""
    if v is None:
        return ""
    try:
        f = float(v)
        if f != f:          # NaN
            return ""
        if decimals == 0:
            return str(int(round(f)))
        txt = f"{round(f, decimals):.{decimals}f}".rstrip("0").rstrip(".")
        return txt or "0"
    except (ValueError, TypeError):
        return ""


TRAINING_STATUS_CODE_MAP = {
    # Garmin uses codes 0,1,2,4,5,6,7,8; code 3 is not emitted by the API payloads we ingest.
    # Keys are integers here because script responses are numeric before CSV/string serialization.
    # Keep values in sync with src/google/sheets.ts TRAINING_STATUS_CODE_MAP.
    0: "NO_STATUS",
    1: "DETRAINING",
    2: "UNPRODUCTIVE",
    4: "MAINTAINING",
    5: "RECOVERY",
    6: "PEAKING",
    7: "PRODUCTIVE",
    8: "STRAINED",
}


def normalize_training_status(value) -> str:
    """Normalize Garmin training status values to stable enum text."""
    if value is None:
        return ""
    if isinstance(value, (int, float)):
        return TRAINING_STATUS_CODE_MAP.get(int(value), str(int(value)))

    raw = str(value).strip()
    if not raw:
        return ""
    if raw.isdigit():
        return TRAINING_STATUS_CODE_MAP.get(int(raw), raw)

    upper = raw.upper()
    if upper.startswith("NO_STATUS"):
        return "NO_STATUS"
    for prefix in (
        "PRODUCTIVE",
        "MAINTAINING",
        "RECOVERY",
        "RECOVERY_ACTIVE",
        "UNPRODUCTIVE",
        "STRAINED",
        "OVERREACHING",
        "DETRAINING",
        "PEAKING",
    ):
        if upper == prefix or upper.startswith(prefix + "_"):
            return prefix
    return upper


def _extract_metric_value(raw, *metric_keys: str):
    """Best-effort extract of the first metric value from Garmin metric payloads.

    ``metric_keys`` are tried in order. The first non-null value found across the
    supported response shapes is returned.
    """
    if not raw:
        return None

    def _coerce_metric_value(value):
        """Normalize Garmin metric payload leaves into a scalar value."""
        if isinstance(value, dict):
            for key in ("value", "overallScore", "latestScore"):
                candidate = value.get(key)
                if candidate is not None:
                    return candidate
            return None
        if isinstance(value, list) and value:
            for entry in value:
                candidate = _coerce_metric_value(entry)
                if candidate is not None:
                    return candidate
            return None
        return value

    items = raw if isinstance(raw, list) else [raw]
    for item in items:
        if not isinstance(item, dict):
            continue

        for key in metric_keys:
            direct = _coerce_metric_value(item.get(key))
            if direct is not None:
                return direct

        for container_key in ("generic", "running", "cycling"):
            container = item.get(container_key)
            if not isinstance(container, dict):
                continue
            for key in metric_keys:
                direct = _coerce_metric_value(container.get(key))
                if direct is not None:
                    return direct

        metrics_map = (item.get("allMetrics") or {}).get("metricsMap") or {}
        for metric_key in metric_keys:
            entries = _coerce_metric_value(metrics_map.get(metric_key))
            if entries is not None:
                return entries

    return None


def _date_range(start: str, end: str) -> list[str]:
    """Inclusive list of YYYY-MM-DD strings from start to end."""
    cur = date.fromisoformat(start)
    fin = date.fromisoformat(end)
    result = []
    while cur <= fin:
        result.append(cur.isoformat())
        cur += timedelta(days=1)
    return result


# ---------------------------------------------------------------------------
# Garmin Connect authentication
# ---------------------------------------------------------------------------

def login_from_tokens(token_bundle: str):
    from garminconnect import Garmin
    token_dir = tempfile.mkdtemp(prefix="garmin-wellness-tokens-")
    (Path(token_dir) / "garmin_tokens.json").write_text(token_bundle)
    garmin = Garmin()
    garmin.login(token_dir)
    return garmin


# ---------------------------------------------------------------------------
# Per-date fetchers — each returns a dict of column_name → value_str
# ---------------------------------------------------------------------------

def _fetch_hrv(client, cdate: str) -> dict:
    try:
        data = client.get_hrv_data(cdate)
        if not data:
            return {}
        # The response is {"hrvSummary": {...}, "hrv": [<raw readings>]}.
        # "hrv" is an array of per-minute readings (often empty), NOT the summary.
        summary = data.get("hrvSummary") or {}
        if not summary:
            return {}
        return {
            "hrvWeeklyAvg":  _num(summary.get("weeklyAvg"), 0),
            "hrvStatus":     str(summary.get("status") or ""),
        }
    except Exception as exc:
        print(f"  WARNING [{cdate}] hrv: {exc}", file=sys.stderr)
        return {}


def _fetch_sleep(client, cdate: str) -> dict:
    try:
        data = client.get_sleep_data(cdate)
        if not data:
            return {}
        dto = data.get("dailySleepDTO") or {}
        if not dto:
            return {}
        # Score may live in several places across firmware versions
        scores = dto.get("sleepScores") or {}
        score = None
        if isinstance(scores, dict):
            score = (
                scores.get("totalScore")
                or (scores.get("overall") or {}).get("value")
                or scores.get("score")
            )
        return {
            "sleepDurationSec": _num(dto.get("sleepTimeSeconds"), 0),
            "sleepDeepSec":     _num(dto.get("deepSleepSeconds"), 0),
            "sleepLightSec":    _num(dto.get("lightSleepSeconds"), 0),
            "sleepRemSec":      _num(dto.get("remSleepSeconds"), 0),
            "sleepAwakeSec":    _num(dto.get("awakeSleepSeconds"), 0),
            "sleepScore":       _num(score, 0),
        }
    except Exception as exc:
        print(f"  WARNING [{cdate}] sleep: {exc}", file=sys.stderr)
        return {}


def _fetch_readiness(client, cdate: str) -> dict:
    try:
        data = client.get_training_readiness(cdate)
        if not data:
            return {}
        entry: dict = {}
        if isinstance(data, list) and data:
            # Prefer the post-wakeup snapshot
            morning = next(
                (e for e in data if (e.get("inputContext") or "") == "AFTER_WAKEUP_RESET"),
                None,
            )
            entry = morning or data[0]
        elif isinstance(data, dict):
            entry = data
        return {"readinessScore": _num(entry.get("score"), 0)}
    except Exception as exc:
        print(f"  WARNING [{cdate}] readiness: {exc}", file=sys.stderr)
        return {}


def _fetch_training_status(client, cdate: str) -> dict:
    try:
        data = client.get_training_status(cdate)
        if not data or not isinstance(data, dict):
            return {}
        # Response shape: mostRecentTrainingStatus → latestTrainingStatusData
        # → {<sport-key>: {trainingStatus, acuteTrainingLoadDTO: {dailyTrainingLoadAcute, …}}}
        most_recent = data.get("mostRecentTrainingStatus") or {}
        latest_map = most_recent.get("latestTrainingStatusData") or {}
        entry: dict = {}
        if latest_map:
            first = next(iter(latest_map.values()), None)
            if isinstance(first, dict):
                entry = first
        if not entry:
            return {}
        atl = entry.get("acuteTrainingLoadDTO") or {}
        status = normalize_training_status(
            entry.get("trainingStatusFeedbackPhrase")
            or entry.get("trainingStatusKey")
            or entry.get("trainingStatus")
        )
        return {
            "trainingStatus":      status,
            "trainingAcuteLoad":   _num(atl.get("dailyTrainingLoadAcute"), 1),
            "trainingChronicLoad": _num(atl.get("dailyTrainingLoadChronic"), 1),
        }
    except Exception as exc:
        print(f"  WARNING [{cdate}] training_status: {exc}", file=sys.stderr)
        return {}


def _fetch_daily_summary(client, cdate: str) -> dict:
    """Steps, floors, resting HR, body battery and intensity minutes from the
    daily summary endpoint."""
    try:
        data = client.get_user_summary(cdate)
        if not data:
            return {}
        return {
            "steps":               _num(data.get("totalSteps"), 0),
            "floors":              _num(data.get("floorsAscended"), 0),
            "restingHR":           _num(data.get("restingHeartRate"), 0),
            "bodyBatteryHigh":     _num(data.get("bodyBatteryHighestValue"), 0),
            "bodyBatteryLow":      _num(data.get("bodyBatteryLowestValue"), 0),
            "intensityMinModerate": _num(data.get("moderateIntensityMinutes"), 0),
            "intensityMinVigorous": _num(data.get("vigorousIntensityMinutes"), 0),
        }
    except Exception as exc:
        print(f"  WARNING [{cdate}] daily_summary: {exc}", file=sys.stderr)
        return {}


def _fetch_vo2max(client, cdate: str) -> dict:
    try:
        data = client.get_max_metrics(cdate)
        val = _extract_metric_value(
            data,
            "vo2MaxRunning",
            "vo2MaxPreciseValue",
            "vo2MaxValue",
            "genericVO2MaxValue",
            "VO2MAX_RUNNING",
            "VO2_MAX_RUNNING",
            "GENERIC_VO2_MAX",
        )
        return {"vo2Max": _num(val, 1)} if val is not None else {}
    except Exception as exc:
        print(f"  WARNING [{cdate}] vo2max: {exc}", file=sys.stderr)
        return {}


def _fetch_hill_score(client, cdate: str) -> dict:
    try:
        data = client.get_hill_score(cdate)
        val = _extract_metric_value(data, "overallScore", "hillScore", "score", "value", "HILL_SCORE")
        return {"hillScore": _num(val, 1)}
    except Exception as exc:
        print(f"  WARNING [{cdate}] hill_score: {exc}", file=sys.stderr)
        return {}


def _fetch_endurance_score(client, cdate: str) -> dict:
    try:
        data = client.get_endurance_score(cdate)
        val = _extract_metric_value(
            data,
            "enduranceScore",
            "latestScore",
            "overallScore",
            "score",
            "value",
            "ENDURANCE_SCORE",
        )
        return {"enduranceScore": _num(val, 1)}
    except Exception as exc:
        print(f"  WARNING [{cdate}] endurance_score: {exc}", file=sys.stderr)
        return {}


# ---------------------------------------------------------------------------
# Row builder
# ---------------------------------------------------------------------------

def build_row(client, cdate: str) -> list[str]:
    """Fetch all wellness metrics for a single date and return a sheet row."""
    row: dict[str, str] = {col: "" for col in HEADER}
    row["date"] = cdate

    row.update(_fetch_hrv(client, cdate))
    row.update(_fetch_sleep(client, cdate))
    row.update(_fetch_readiness(client, cdate))
    row.update(_fetch_training_status(client, cdate))
    row.update(_fetch_daily_summary(client, cdate))
    row.update(_fetch_vo2max(client, cdate))
    row.update(_fetch_hill_score(client, cdate))
    row.update(_fetch_endurance_score(client, cdate))

    return [row[col] for col in HEADER]


# ---------------------------------------------------------------------------
# Google Sheets helpers (service-account REST, same pattern as garmin-sync.py)
# ---------------------------------------------------------------------------

def get_google_access_token(service_account_key: str) -> str:
    from google.auth.transport.requests import Request
    from google.oauth2 import service_account

    key = json.loads(service_account_key) if isinstance(service_account_key, str) else service_account_key
    creds = service_account.Credentials.from_service_account_info(
        key, scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )
    creds.refresh(Request())
    return creds.token


def _column_letter(n: int) -> str:
    return chr(64 + n)


def _sheets_get(session, url: str, token: str) -> dict:
    res = session.get(url, headers={"Authorization": "Bearer " + token})
    if not res.ok:
        raise RuntimeError(f"Sheets GET failed ({res.status_code}): {res.text}")
    return res.json()


def ensure_tab(session, spreadsheet_id: str, token: str) -> None:
    meta = _sheets_get(
        session,
        f"{SHEETS_API_BASE}/{spreadsheet_id}?fields=sheets.properties.title",
        token,
    )
    titles = {s.get("properties", {}).get("title") for s in meta.get("sheets", [])}
    if TAB_NAME in titles:
        return

    # Create the tab
    create_res = session.post(
        f"{SHEETS_API_BASE}/{spreadsheet_id}:batchUpdate",
        headers={"Authorization": "Bearer " + token},
        json={"requests": [{"addSheet": {"properties": {"title": TAB_NAME}}}]},
    )
    if not create_res.ok:
        raise RuntimeError(f"Tab creation failed ({create_res.status_code}): {create_res.text}")

    # Write header row
    col = _column_letter(COLUMN_COUNT)
    header_range = quote(f"'{TAB_NAME}'!A1:{col}1")
    header_res = session.put(
        f"{SHEETS_API_BASE}/{spreadsheet_id}/values/{header_range}?valueInputOption=RAW",
        headers={"Authorization": "Bearer " + token},
        json={"values": [HEADER]},
    )
    if not header_res.ok:
        raise RuntimeError(f"Header write failed ({header_res.status_code}): {header_res.text}")
    print(f'Created "{TAB_NAME}" tab with header row.')


def read_existing_dates(session, spreadsheet_id: str, token: str) -> set[str]:
    date_range = quote(f"'{TAB_NAME}'!A2:A")
    data = _sheets_get(
        session,
        f"{SHEETS_API_BASE}/{spreadsheet_id}/values/{date_range}",
        token,
    )
    return {row[0].strip() for row in data.get("values", []) if row and row[0]}


def append_rows(session, spreadsheet_id: str, token: str, rows: list[list[str]]) -> None:
    if not rows:
        return
    col = _column_letter(COLUMN_COUNT)
    append_range = quote(f"'{TAB_NAME}'!A:{col}")
    res = session.post(
        f"{SHEETS_API_BASE}/{spreadsheet_id}/values/{append_range}:append"
        "?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
        headers={"Authorization": "Bearer " + token},
        json={"values": rows},
    )
    if not res.ok:
        raise RuntimeError(f"Append failed ({res.status_code}): {res.text}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    import requests

    garmin_tokens = os.environ.get("GARMIN_TOKENS")
    service_account_key = os.environ.get("GOOGLE_SERVICE_ACCOUNT_KEY")
    spreadsheet_id = os.environ.get("SPREADSHEET_ID")
    backfill = "--backfill" in sys.argv

    if not garmin_tokens:
        raise SystemExit("Missing GARMIN_TOKENS")
    if not service_account_key:
        raise SystemExit("Missing GOOGLE_SERVICE_ACCOUNT_KEY")
    if not spreadsheet_id:
        raise SystemExit("Missing SPREADSHEET_ID")

    # 1. Authenticate Garmin
    print("Loading Garmin tokens...")
    garmin = login_from_tokens(garmin_tokens)

    # 2. Authenticate Google
    print("Authenticating with Google Sheets...")
    google_token = get_google_access_token(service_account_key)
    session = requests.Session()

    # 3. Ensure tab exists
    ensure_tab(session, spreadsheet_id, google_token)

    # 4. Read existing dates for deduplication
    existing = read_existing_dates(session, spreadsheet_id, google_token)
    print(f"Found {len(existing)} existing wellness rows in sheet.")

    # 5. Determine date range to sync
    today_str = date.today().isoformat()
    if backfill:
        start_str = BACKFILL_START_DATE
        print(f"Backfilling all dates since {start_str}...")
    else:
        start_str = (date.today() - timedelta(days=ROLLING_DAYS - 1)).isoformat()
        print(f"Syncing rolling {ROLLING_DAYS}-day window ({start_str} → {today_str})...")

    all_dates = _date_range(start_str, today_str)
    missing = [d for d in all_dates if d not in existing]
    print(f"{len(missing)} date(s) to fetch.")

    if not missing:
        print("Nothing to sync.")
        return

    # 6. Fetch and build rows
    new_rows: list[list[str]] = []
    for idx, cdate in enumerate(missing, 1):
        if backfill and idx % 20 == 0:
            print(f"  Progress: {idx}/{len(missing)} dates fetched...")
        row = build_row(garmin, cdate)
        new_rows.append(row)
        if idx < len(missing):
            time.sleep(PER_DATE_DELAY)

    # 7. Append to sheet
    print(f"Appending {len(new_rows)} new wellness rows...")
    append_rows(session, spreadsheet_id, google_token, new_rows)
    print(f"Done — synced {len(new_rows)} days of wellness data.")


if __name__ == "__main__":
    try:
        main()
    except Exception as err:  # noqa: BLE001
        print(f"Garmin wellness sync failed: {err}", file=sys.stderr)
        sys.exit(1)
