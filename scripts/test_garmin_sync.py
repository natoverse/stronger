#!/usr/bin/env python3
"""Offline unit tests for the Garmin sync row mapping.

Run with:  python scripts/test_garmin_sync.py

These tests exercise only the pure ``activity_to_row`` mapping — no network,
no Garmin/Google auth. They mirror the sheet's 10-column layout expected by
the app (src/google/config.ts).
"""

import importlib.util
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "garmin_sync", os.path.join(_HERE, "garmin-sync.py")
)
garmin_sync = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(garmin_sync)


def test_maps_full_activity():
    activity = {
        "activityId": 123456789,
        "activityName": "Morning Run",
        "startTimeLocal": "2026-01-02 06:30:00",
        "activityType": {"typeId": 1, "typeKey": "running"},
        "duration": 1830.4,
        "movingDuration": 1800.6,
        "distance": 5012.7,
        "elevationGain": 42.6,
        "elevationLoss": 40.2,
        "calories": 380.2,
        "averageHR": 148.5,
        "maxHR": 172.0,
        "averageSpeed": 2.734,
        "maxSpeed": 3.501,
        "steps": 5123.4,
        "aerobicTrainingEffect": 3.45,
        "anaerobicTrainingEffect": 0.5,
        "vO2MaxValue": 52.0,
    }
    row = garmin_sync.activity_to_row(activity)
    assert row == [
        "2026-01-02",
        "123456789",
        "running",
        "Morning Run",
        "1830",
        "1801",
        "5013",
        "43",
        "40",
        "380",
        "148",
        "172",
        "2.73",
        "3.5",
        "5123",
        "3.5",
        "0.5",
        "52",
    ], row


def test_row_matches_header_length():
    activity = {
        "activityId": 1,
        "startTimeLocal": "2026-01-02 06:30:00",
    }
    row = garmin_sync.activity_to_row(activity)
    assert len(row) == len(garmin_sync.HEADER) == 18, row


def test_missing_optional_fields_default_to_zero():
    activity = {
        "activityId": 42,
        "startTimeLocal": "2026-03-04 12:00:00",
    }
    row = garmin_sync.activity_to_row(activity)
    # date, id, type, name, then fourteen numeric zeros
    assert row == [
        "2026-03-04", "42", "", "",
        "0", "0", "0", "0", "0", "0", "0", "0",
        "0", "0", "0", "0", "0", "0",
    ], row


def test_falls_back_to_gmt_start():
    activity = {
        "activityId": 7,
        "startTimeGMT": "2026-04-05 09:15:00",
    }
    row = garmin_sync.activity_to_row(activity)
    assert row[0] == "2026-04-05", row


def test_skips_activity_without_id():
    activity = {"startTimeLocal": "2026-01-02 06:30:00"}
    assert garmin_sync.activity_to_row(activity) is None


def test_skips_activity_without_date():
    activity = {"activityId": 99}
    assert garmin_sync.activity_to_row(activity) is None


def test_non_numeric_metric_defaults_to_zero():
    activity = {
        "activityId": 5,
        "startTimeLocal": "2026-01-02 06:30:00",
        "distance": None,
        "calories": "n/a",
    }
    row = garmin_sync.activity_to_row(activity)
    assert row[6] == "0" and row[9] == "0", row


def test_column_letter_matches_span():
    # 18 columns -> R
    assert garmin_sync._column_letter(garmin_sync.COLUMN_COUNT) == "R"


def _run():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"  ok  {t.__name__}")
    print(f"\n{len(tests)} passed")


if __name__ == "__main__":
    _run()
