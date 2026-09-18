#!/usr/bin/env python3
"""Garmin Wellness Sync — Garmin Connect daily wellness metrics → Firestore.

Writes one entry per day to yearly Firestore bucket documents with all of:
  HRV, sleep, body battery, training readiness, training status, acute/chronic
  load, steps, floors, resting HR, VO2 max (running), intensity minutes, hill
  score, endurance score, daily average stress, load focus (training load
  balance: low-aerobic / high-aerobic / anaerobic monthly load plus each
  bucket's optimal target range), running lactate threshold (heart rate,
  speed, power), fitness age, and estimated max heart rate (the profile
  ceiling used for zone calculation, not the day's observed peak).

  Lactate threshold is fetched from Garmin's date-range endpoint so historical
  changes are retained. Fitness age and max HR estimate are slow-moving,
  profile-level values fetched on every run of this same hourly sync.

Environment variables (all required):
  GARMIN_TOKENS               – garminconnect token bundle
  FIREBASE_SERVICE_ACCOUNT_KEY – JSON key for the Firebase service account
  FIREBASE_USER_ID             – destination UID below ``/users/{uid}``

Flags:
  --backfill   Sync every date since BACKFILL_START_DATE (2021-01-01) instead
               of the default last-72-hours window. Implies ``--overwrite``.
  --overwrite  Upsert mode: re-fetch every date in the window and replace
               matching dates inside their yearly buckets.

Usage:
  python scripts/garmin-wellness-sync.py [--backfill] [--overwrite]
"""

from __future__ import annotations

import os
import sys
import time
import tempfile
from datetime import date, timedelta
from math import isfinite
from pathlib import Path

from firestore_sync import (
    get_firestore_access,
    merge_settings_values,
    merge_year_bucket_entries,
    read_year_entries,
)

# Fields persisted in the Firestore GarminWellnessEntry model.
WELLNESS_FIELDS = [
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
    "heatAcclimationPct", "altitudeAcclimationPct", "currentAltitude",
    "activeCalories", "bmrCalories",
    "avgStress",
    # Running lactate threshold history and the two slow-moving physiological
    # estimates below are fetched every hourly run alongside everything else.
    "lactateThresholdHr", "lactateThresholdSpeed", "lactateThresholdPower",
    "fitnessAge",
    "maxHrEstimate",
    # Load focus (training load balance) — monthly (rolling ~28-day) load per
    # intensity bucket plus Garmin's optimal target range (min/max) for each.
    "loadFocusAerobicLow", "loadFocusAerobicLowMin", "loadFocusAerobicLowMax",
    "loadFocusAerobicHigh", "loadFocusAerobicHighMin", "loadFocusAerobicHighMax",
    "loadFocusAnaerobic", "loadFocusAnaerobicMin", "loadFocusAnaerobicMax",
    "hrvBaselineMin", "hrvBaselineMax",
]

# Default window: the last 72 hours. Wellness data is stored per calendar day,
# so a 72-hour lookback spans four calendar days (today plus the prior three)
# to fill days that were only partially synced while the device was offline.
ROLLING_DAYS = 4
BACKFILL_START_DATE = "2021-01-01"
PER_DATE_DELAY = 0.15   # seconds between dates (rate-limit courtesy)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _num(v, decimals: int = 1) -> str:
    """Return a normalized numeric string for v, or '' if null/invalid."""
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


def _stress(v) -> str:
    """Return a daily average stress level (0–100), or '' if absent.

    Garmin reports -1 or -2 for days with no stress data (device not worn),
    which must not be written as a real value.
    """
    if v is None:
        return ""
    try:
        f = float(v)
        if f != f or f < 0:   # NaN or Garmin's no-data sentinel
            return ""
        return str(int(round(f)))
    except (ValueError, TypeError):
        return ""


def _lactate_threshold_speed_mps(value) -> str:
    """Convert Garmin biometric range speed (m/s divided by 10) to stored m/s."""
    try:
        speed_mps = float(value) * 10
    except (ValueError, TypeError, OverflowError):
        return ""
    if not isfinite(speed_mps) or speed_mps <= 0:
        return ""
    return _num(speed_mps, 3)


TRAINING_STATUS_CODE_MAP = {
    # Garmin uses codes 0,1,2,4,5,6,7,8; code 3 is not emitted by the API payloads we ingest.
    # Normalize numeric provider responses to the enum text stored in Firestore.
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
# Per-date fetchers — each returns a dict of metric_name → value_str
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
        baseline = summary.get("baseline") or {}
        return {
            "hrvWeeklyAvg":  _num(summary.get("weeklyAvg"), 0),
            "hrvStatus":     str(summary.get("status") or ""),
            "hrvBaselineMin": _num(baseline.get("balancedLow"), 0),
            "hrvBaselineMax": _num(baseline.get("balancedUpper"), 0),
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


def _extract_load_focus(data: dict) -> dict:
    """Extract load-focus (training load balance) fields from a training-status
    payload. Returns the 9 stored fields, using '' for any missing value.

    Shape: mostRecentTrainingLoadBalance → metricsTrainingLoadBalanceDTOMap →
    {<device-id>: {monthlyLoadAerobicLow, monthlyLoadAerobicLowTargetMin, …}}.
    """
    empty = {
        "loadFocusAerobicLow": "", "loadFocusAerobicLowMin": "", "loadFocusAerobicLowMax": "",
        "loadFocusAerobicHigh": "", "loadFocusAerobicHighMin": "", "loadFocusAerobicHighMax": "",
        "loadFocusAnaerobic": "", "loadFocusAnaerobicMin": "", "loadFocusAnaerobicMax": "",
    }
    balance = data.get("mostRecentTrainingLoadBalance") or {}
    load_map = balance.get("metricsTrainingLoadBalanceDTOMap") or {}
    entry = next((v for v in load_map.values() if isinstance(v, dict)), None)
    if not entry:
        return empty
    return {
        "loadFocusAerobicLow":     _num(entry.get("monthlyLoadAerobicLow"), 1),
        "loadFocusAerobicLowMin":  _num(entry.get("monthlyLoadAerobicLowTargetMin"), 1),
        "loadFocusAerobicLowMax":  _num(entry.get("monthlyLoadAerobicLowTargetMax"), 1),
        "loadFocusAerobicHigh":    _num(entry.get("monthlyLoadAerobicHigh"), 1),
        "loadFocusAerobicHighMin": _num(entry.get("monthlyLoadAerobicHighTargetMin"), 1),
        "loadFocusAerobicHighMax": _num(entry.get("monthlyLoadAerobicHighTargetMax"), 1),
        "loadFocusAnaerobic":      _num(entry.get("monthlyLoadAnaerobic"), 1),
        "loadFocusAnaerobicMin":   _num(entry.get("monthlyLoadAnaerobicTargetMin"), 1),
        "loadFocusAnaerobicMax":   _num(entry.get("monthlyLoadAnaerobicTargetMax"), 1),
    }


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
        acclim = (
            data.get("heatAltitudeAcclimationDTO")
            or data.get("heatAltitudeAcclimation")
            or (data.get("mostRecentVO2Max") or {}).get("heatAltitudeAcclimationDTO")
            or (data.get("mostRecentVO2Max") or {}).get("heatAltitudeAcclimation")
            or entry.get("heatAltitudeAcclimationDTO")
            or entry.get("heatAltitudeAcclimation")
            or {}
        )
        status = normalize_training_status(
            entry.get("trainingStatusFeedbackPhrase")
            or entry.get("trainingStatusKey")
            or entry.get("trainingStatus")
        )
        return {
            "trainingStatus":      status,
            "trainingAcuteLoad":   _num(atl.get("dailyTrainingLoadAcute"), 1),
            "trainingChronicLoad": _num(atl.get("dailyTrainingLoadChronic"), 1),
            "heatAcclimationPct": _num(
                acclim.get("heatAcclimationPercentage") or acclim.get("heatAcclimation"),
                0,
            ),
            "altitudeAcclimationPct": _num(
                acclim.get("altitudeAcclimationPercentage")
                or acclim.get("altitudeAcclimation")
                or acclim.get("acclimationPercentage"),
                0,
            ),
            "currentAltitude": _num(acclim.get("currentAltitude"), 0),
            **_extract_load_focus(data),
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
            "activeCalories":      _num(data.get("activeKilocalories"), 0),
            "bmrCalories":         _num(data.get("bmrKilocalories"), 0),
            "avgStress":           _stress(data.get("averageStressLevel")),
        }
    except Exception as exc:
        print(f"  WARNING [{cdate}] daily_summary: {exc}", file=sys.stderr)
        return {}


def _first_present(data: dict, *keys):
    """Return the first non-null value among ``keys`` in ``data``."""
    for key in keys:
        val = data.get(key)
        if val is not None:
            return val
    return None


def _positive_int(v):
    """Coerce ``v`` to a positive int, or None if absent/zero/invalid.

    The daily-summary payload may omit goal fields entirely, so this must
    tolerate None and non-numeric strings without raising — a single missing
    field should never abort harvesting of the other goals.
    """
    if v is None:
        return None
    try:
        n = int(round(float(v)))
    except (ValueError, TypeError):
        return None
    return n if n > 0 else None


def parse_goals(data: dict) -> dict:
    """Extract step/floor/intensity goals from a Garmin daily-summary payload.

    Garmin uses ``dailyStepGoal``, ``userFloorsAscendedGoal`` and
    ``intensityMinutesGoal`` (the intensity goal is weekly). Field names have
    varied across API versions, so several aliases are accepted. Only goals
    that resolve to a positive integer are returned, so absent fields don't
    overwrite user-configured values with zero.
    """
    if not data:
        return {}
    goals: dict = {}
    step_goal = _positive_int(_first_present(data, "dailyStepGoal", "stepGoal"))
    if step_goal is not None:
        goals["app.garminDailyStepsGoal"] = str(step_goal)
    floors_goal = _positive_int(
        _first_present(data, "userFloorsAscendedGoal", "floorsAscendedGoal")
    )
    if floors_goal is not None:
        goals["app.garminDailyFloorsGoal"] = str(floors_goal)
    intensity_goal = _positive_int(
        _first_present(
            data,
            "intensityMinutesGoal",
            "userIntensityMinutesGoal",
            "weeklyIntensityMinutesGoal",
            "minIntensityMinutesGoalWeekly",
            "weeklyIntensityMinGoal",
        )
    )
    if intensity_goal is not None:
        goals["app.garminWeeklyIntensityMinGoal"] = str(intensity_goal)
    return goals


def _fetch_goals(client) -> dict:
    """Fetch daily/weekly goals (steps, floors, intensity minutes) for today.

    These come from the same daily summary endpoint.  The goal values rarely
    change so we only need to read them once (for today).
    """
    try:
        today = date.today().isoformat()
        data = client.get_user_summary(today)
        return parse_goals(data)
    except Exception as exc:
        print(f"  WARNING: goals fetch: {exc}", file=sys.stderr)
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


def _fetch_lactate_threshold(client, cdate: str) -> dict:
    """Running lactate threshold: heart rate (bpm), speed (m/s), power (watts).

    Garmin's range endpoint returns separate daily series for heart rate, speed,
    and power. Querying the entry date prevents the latest value from being
    copied onto every historical wellness row.
    """
    try:
        data = client.get_lactate_threshold(
            latest=False,
            start_date=cdate,
            end_date=cdate,
            aggregation="daily",
        ) or {}

        def range_value(raw, *keys, parent_date=None):
            """Find a metric recursively, inheriting dates from its containers."""
            if isinstance(raw, list):
                for item in raw:
                    value = range_value(item, *keys, parent_date=parent_date)
                    if value is not None:
                        return value
                return None
            if not isinstance(raw, dict):
                return None
            entry_date = raw.get("calendarDate") or raw.get("date") or raw.get("from") or parent_date
            if entry_date is None or str(entry_date) == cdate:
                value = _extract_metric_value(raw, *keys)
                if value is not None:
                    return value
            for nested in raw.values():
                if isinstance(nested, (dict, list)):
                    value = range_value(nested, *keys, parent_date=entry_date)
                    if value is not None:
                        return value
            return None

        result = {}
        hr = range_value(
            data.get("heart_rate"),
            "lactateThresholdHeartRate", "heartRate", "value",
        )
        if hr is not None:
            result["lactateThresholdHr"] = _num(hr, 0)
        speed = range_value(
            data.get("speed"),
            "lactateThresholdSpeed", "speed", "value",
        )
        if speed is not None:
            result["lactateThresholdSpeed"] = _lactate_threshold_speed_mps(speed)
        watts = range_value(
            data.get("power"),
            "functionalThresholdPower", "power", "value",
        )
        if watts is not None:
            result["lactateThresholdPower"] = _num(watts, 0)
        return result
    except Exception as exc:
        print(f"  WARNING [{cdate}] lactate_threshold: {exc}", file=sys.stderr)
        return {}


def _fetch_fitness_age(client, cdate: str) -> dict:
    """Garmin's Fitness Age estimate (years)."""
    try:
        data = client.get_fitnessage_data(cdate) or {}
        # Some payload variants nest the score under a "fitnessAge" object
        # (with an "age" field); others expose it as a direct scalar/value.
        nested = data.get("fitnessAge") if isinstance(data, dict) else None
        source = nested if isinstance(nested, dict) else data
        val = _extract_metric_value(source, "age", "fitnessAge", "value")
        return {"fitnessAge": _num(val, 1)} if val is not None else {}
    except Exception as exc:
        print(f"  WARNING [{cdate}] fitness_age: {exc}", file=sys.stderr)
        return {}


def _fetch_max_hr(client, cdate: str) -> dict:
    """Estimated max heart rate (bpm) — the physiological-ceiling value used
    for Garmin's heart-rate zone calculation, not the day's observed peak.
    """
    try:
        def zone_max_hr(zones):
            if isinstance(zones, dict):
                zones = [zones]
            if not isinstance(zones, list):
                return None
            zone = None
            for preferred_sport in ("DEFAULT", "RUNNING"):
                zone = next(
                    (
                        item for item in zones
                        if isinstance(item, dict)
                        and item.get("sport") == preferred_sport
                    ),
                    None,
                )
                if zone is not None:
                    break
            if zone is None:
                zone = next((item for item in zones if isinstance(item, dict)), None)
            return _extract_metric_value(
                zone, "maxHeartRateUsed", "maxHeartRate", "maxHr",
            )

        data = client.get_userprofile_settings() or {}
        user_data = data.get("userData") if isinstance(data, dict) else None
        val = _extract_metric_value(user_data, "maxHeartRate", "maxHr")
        if val is None:
            val = _extract_metric_value(data, "maxHeartRate", "maxHr")
        if val is None:
            zones = data.get("heartRateZones") if isinstance(data, dict) else None
            val = zone_max_hr(zones)
        if val is None:
            get_zones = getattr(client, "get_heart_rate_zones", None)
            if callable(get_zones):
                val = zone_max_hr(get_zones() or [])
        return {"maxHrEstimate": _num(val, 0)} if val is not None else {}
    except Exception as exc:
        print(f"  WARNING [{cdate}] max_hr: {exc}", file=sys.stderr)
        return {}


# ---------------------------------------------------------------------------
# Entry builder
# ---------------------------------------------------------------------------

def build_entry(client, cdate: str) -> dict:
    """Fetch all wellness metrics for a single date."""
    metrics: dict[str, str] = {"date": cdate}

    metrics.update(_fetch_hrv(client, cdate))
    metrics.update(_fetch_sleep(client, cdate))
    metrics.update(_fetch_readiness(client, cdate))
    metrics.update(_fetch_training_status(client, cdate))
    metrics.update(_fetch_daily_summary(client, cdate))
    metrics.update(_fetch_vo2max(client, cdate))
    metrics.update(_fetch_hill_score(client, cdate))
    metrics.update(_fetch_endurance_score(client, cdate))
    metrics.update(_fetch_lactate_threshold(client, cdate))
    metrics.update(_fetch_fitness_age(client, cdate))
    metrics.update(_fetch_max_hr(client, cdate))

    return wellness_to_entry(metrics)


def _entry_number(value):
    if value is None or str(value).strip() == "":
        return None
    number = float(value)
    return int(number) if number.is_integer() else number


def wellness_to_entry(metrics):
    """Normalize fetched metrics to the Firestore model."""
    entry = {}
    for field in WELLNESS_FIELDS:
        value = metrics.get(field, "")
        if field in ("date", "hrvStatus"):
            entry[field] = value
        elif field == "trainingStatus":
            entry[field] = normalize_training_status(value)
        else:
            entry[field] = _entry_number(value)
    return entry


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    import requests

    garmin_tokens = os.environ.get("GARMIN_TOKENS")
    service_account_key = os.environ.get("FIREBASE_SERVICE_ACCOUNT_KEY")
    uid = os.environ.get("FIREBASE_USER_ID")
    backfill = "--backfill" in sys.argv
    # Backfill implies overwrite so a full re-sync also refreshes edited days.
    overwrite = backfill or "--overwrite" in sys.argv

    if not garmin_tokens:
        raise SystemExit("Missing GARMIN_TOKENS")
    if not service_account_key:
        raise SystemExit("Missing FIREBASE_SERVICE_ACCOUNT_KEY")
    if not uid:
        raise SystemExit("Missing FIREBASE_USER_ID")

    # 1. Authenticate Garmin
    print("Loading Garmin tokens...")
    garmin = login_from_tokens(garmin_tokens)

    # 2. Authenticate Firestore
    print("Authenticating with Firestore...")
    project_id, firestore_token = get_firestore_access(service_account_key)
    session = requests.Session()

    # 3. Determine date range to sync
    today_str = date.today().isoformat()
    if backfill:
        start_str = BACKFILL_START_DATE
        print(f"Backfilling all dates since {start_str}...")
    else:
        start_str = (date.today() - timedelta(days=ROLLING_DAYS - 1)).isoformat()
        print(f"Syncing last 72 hours ({start_str} → {today_str})...")

    all_dates = _date_range(start_str, today_str)

    # 4. In append-only mode, avoid refetching dates already in Firestore.
    if overwrite:
        dates_to_fetch = all_dates
    else:
        existing = {
            entry["date"]
            for entry in read_year_entries(
                session,
                project_id,
                firestore_token,
                uid,
                "garminWellness",
                (value[:4] for value in all_dates),
            )
        }
        print(f"Found {len(existing)} existing wellness entries in Firestore.")
        dates_to_fetch = [d for d in all_dates if d not in existing]
    print(f"{len(dates_to_fetch)} date(s) to fetch.")

    if not dates_to_fetch:
        print("Nothing to sync.")
        _sync_goals(garmin, session, project_id, firestore_token, uid)
        return

    # 5. Fetch and build entries.
    entries = []
    for idx, cdate in enumerate(dates_to_fetch, 1):
        if backfill and idx % 20 == 0:
            print(f"  Progress: {idx}/{len(dates_to_fetch)} dates fetched...")
        entries.append(build_entry(garmin, cdate))
        if idx < len(dates_to_fetch):
            time.sleep(PER_DATE_DELAY)

    # A wellness backfill can spend long enough in provider calls for the
    # original one-hour service-account token to expire.
    project_id, firestore_token = get_firestore_access(service_account_key)
    result = merge_year_bucket_entries(
        session,
        project_id,
        firestore_token,
        uid,
        "garminWellness",
        entries,
        "date",
        overwrite,
        "date",
    )
    print(
        f"Done — added {result['added']}, updated {result['updated']} "
        "days of wellness data in Firestore."
    )

    # 6. Update goal settings in Firestore.
    _sync_goals(garmin, session, project_id, firestore_token, uid)


def _sync_goals(garmin, session, project_id: str, token: str, uid: str) -> None:
    print("Fetching Garmin goals...")
    goals = _fetch_goals(garmin)
    if goals:
        merge_settings_values(session, project_id, token, uid, goals)
        keys = ", ".join(goals.keys())
        print(f"Updated {len(goals)} goal setting(s) in Firestore ({keys}).")
    else:
        print("No goal data available from Garmin (goals may not be set in the app).")


if __name__ == "__main__":
    try:
        main()
    except Exception as err:  # noqa: BLE001
        print(f"Garmin wellness sync failed: {err}", file=sys.stderr)
        sys.exit(1)
