#!/usr/bin/env python3
"""Offline unit tests for the Garmin sync row mapping.

Run with:  python scripts/test_garmin_sync.py

These tests exercise only pure mapping behavior — no network or provider auth.
"""

import importlib.util
import os
from datetime import date

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
        "activeKilocalories": 275.4,
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
        "2026-01-02T06:30:00",
        "123456789",
        "running",
        "Morning Run",
        "1830",
        "1801",
        "5013",
        "43",
        "40",
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
    assert len(row) == len(garmin_sync.HEADER) == 17, row


def test_missing_optional_fields_default_to_zero():
    activity = {
        "activityId": 42,
        "startTimeLocal": "2026-03-04 12:00:00",
    }
    row = garmin_sync.activity_to_row(activity)
    # timestamp, id, type, name, then thirteen numeric zeros
    assert row == [
        "2026-03-04T12:00:00", "42", "", "",
        "0", "0", "0", "0", "0", "0",
        "0", "0", "0", "0", "0", "0", "0",
    ], row


def test_falls_back_to_gmt_start():
    activity = {
        "activityId": 7,
        "startTimeGMT": "2026-04-05 09:15:00",
    }
    row = garmin_sync.activity_to_row(activity)
    assert row[0] == "2026-04-05T09:15:00", row


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
        "averageHR": "n/a",
    }
    row = garmin_sync.activity_to_row(activity)
    assert row[6] == "0" and row[9] == "0", row


def test_maps_firestore_activity_model():
    row = garmin_sync.activity_to_row({
        "activityId": 123,
        "activityName": "Lift",
        "startTimeLocal": "2026-01-02 06:30:00",
        "activityType": {"typeKey": "strength_training"},
        "duration": 600,
        "distance": 0,
        "elevationGain": 0,
        "elevationLoss": 0,
        "averageHR": 100,
        "maxHR": 140,
    })
    assert garmin_sync.activity_row_to_entry(row) == {
        "timestamp": "2026-01-02T06:30:00",
        "stravaId": "123",
        "activityType": "Weight Training",
        "name": "Lift",
        "duration": 600,
        "distance": 0,
        "elevationGain": 0,
        "elevationLoss": 0,
        "calories": 0,
        "avgHR": 100,
        "maxHR": 140,
    }


def test_activity_fetch_end_date_includes_following_day():
    assert garmin_sync.activity_fetch_end_date(date(2026, 8, 13)) == "2026-08-14"


def test_backfill_starts_at_2015():
    assert garmin_sync.BACKFILL_START_DATE == "2015-01-01"


def test_skips_firestore_entry_without_activity_type():
    row = garmin_sync.activity_to_row({
        "activityId": 123,
        "startTimeLocal": "2026-01-02 06:30:00",
    })
    assert garmin_sync.activity_row_to_entry(row) is None


def test_activity_issues_reports_missing_date():
    issues = garmin_sync.activity_issues({"activityId": 1})
    assert issues == ["missing startTimeLocal/startTimeGMT"], issues


def test_activity_issues_reports_malformed_date():
    issues = garmin_sync.activity_issues(
        {"activityId": 1, "startTimeLocal": "not-a-date"}
    )
    assert len(issues) == 1 and issues[0].startswith("malformed start time"), issues


def test_activity_issues_reports_missing_activity_id():
    issues = garmin_sync.activity_issues({"startTimeLocal": "2026-01-02 06:30:00"})
    assert issues == ["missing activityId"], issues


def test_activity_issues_empty_for_valid_activity():
    assert garmin_sync.activity_issues({
        "activityId": 1,
        "startTimeLocal": "2026-01-02 06:30:00",
        "activityType": {"typeKey": "running"},
    }) == []


def test_activity_issues_handles_non_dict_record():
    assert garmin_sync.activity_issues(None) == [
        "record is not an object (got NoneType)"
    ]


def test_build_entries_keeps_valid_and_reports_invalid():
    activities = [
        {"activityId": 1, "startTimeLocal": None},
        {"activityId": 2, "startTimeLocal": "not-a-date"},
        {"startTimeLocal": "2026-01-02 06:30:00"},
        {
            "activityId": 4,
            "startTimeLocal": "2026-01-02 06:30:00",
            "activityType": {"typeKey": "running"},
        },
        {"activityId": 5, "startTimeLocal": "2026-01-02 07:30:00"},
    ]
    entries, invalid = garmin_sync.build_entries(activities)

    assert [entry["stravaId"] for entry in entries] == ["4"], entries
    assert [item["index"] for item in invalid] == [0, 1, 2, 4], invalid
    assert invalid[0]["reasons"] == ["missing startTimeLocal/startTimeGMT"]
    assert invalid[3]["reasons"] == [
        "record could not be mapped to a Firestore entry"
    ]
    # Each invalid record carries an inspectable preview of the raw payload.
    assert '"activityId": 1' in invalid[0]["record"], invalid[0]


def test_safe_record_repr_truncates_large_records():
    text = garmin_sync.safe_record_repr({"name": "x" * 1000})
    assert text.endswith("… (truncated)"), text
    assert len(text) <= garmin_sync.INVALID_RECORD_CHARS + len("… (truncated)")


def test_format_summary_includes_all_counts():
    text = garmin_sync.format_summary({
        "fetched": 3107,
        "valid": 3100,
        "skipped": 7,
        "added": 5,
        "updated": 3095,
        "status": "success",
    })
    for fragment in (
        "fetched 3107", "valid 3100", "skipped 7", "added 5", "updated 3095",
        "status: success",
    ):
        assert fragment in text, text


def test_report_summary_writes_github_files():
    import tempfile

    directory = tempfile.mkdtemp(prefix="garmin-summary-")
    step_summary = os.path.join(directory, "step-summary.md")
    output = os.path.join(directory, "output.txt")
    summary = {
        "fetched": 10,
        "valid": 8,
        "skipped": 2,
        "added": 1,
        "updated": 7,
        "status": "success",
    }

    garmin_sync.report_summary(
        summary,
        {"GITHUB_STEP_SUMMARY": step_summary, "GITHUB_OUTPUT": output},
    )

    with open(output, encoding="utf-8") as handle:
        lines = handle.read().splitlines()
    assert lines == [
        "fetched=10", "valid=8", "skipped=2",
        "added=1", "updated=7", "status=success",
    ], lines

    with open(step_summary, encoding="utf-8") as handle:
        markdown = handle.read()
    assert "### Garmin sync summary" in markdown
    assert "| Skipped | 2 |" in markdown


def test_report_summary_without_github_env_only_prints():
    garmin_sync.report_summary(dict(garmin_sync.SUMMARY), {})


def _run():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"  ok  {t.__name__}")
    print(f"\n{len(tests)} passed")


if __name__ == "__main__":
    _run()
