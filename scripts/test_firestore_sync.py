#!/usr/bin/env python3
"""Offline unit tests for shared Firestore sync helpers."""

from firestore_sync import (
    firestore_value,
    firestore_value_to_json,
    merge_entries,
    merge_year_bucket_entries,
)


def test_firestore_value_round_trip():
    value = {
        "period": "2026",
        "count": 1,
        "entries": [{"date": "2026-01-01", "value": None}],
    }
    encoded = firestore_value(value)
    assert firestore_value_to_json(encoded) == value


def test_append_merge_preserves_existing_match():
    entries, added, updated = merge_entries(
        [{"date": "2026-01-01", "stravaId": "1", "name": "old"}],
        [
            {"date": "2026-01-01", "stravaId": "1", "name": "new"},
            {"date": "2026-01-02", "stravaId": "2", "name": "second"},
        ],
        "stravaId",
        False,
        "date",
    )
    assert entries == [
        {"date": "2026-01-01", "stravaId": "1", "name": "old"},
        {"date": "2026-01-02", "stravaId": "2", "name": "second"},
    ]
    assert (added, updated) == (1, 0)


def test_overwrite_merge_replaces_only_match():
    entries, added, updated = merge_entries(
        [
            {"date": "2026-01-01", "dateKey": "2026-01-01", "steps": 1},
            {"date": "2026-01-02", "dateKey": "2026-01-02", "steps": 2},
        ],
        [{"date": "2026-01-02", "dateKey": "2026-01-02", "steps": 3}],
        "dateKey",
        True,
        "date",
    )
    assert entries[-1]["steps"] == 3
    assert (added, updated) == (0, 1)


def test_merge_sorts_activity_entries_by_timestamp():
    entries, added, updated = merge_entries(
        [{"timestamp": "2026-01-03T06:30:00", "stravaId": "3"}],
        [
            {"timestamp": "2026-01-02T06:30:00", "stravaId": "2"},
            {"timestamp": "2026-01-01T06:30:00", "stravaId": "1"},
        ],
        "stravaId",
        False,
        "timestamp",
    )
    assert [entry["stravaId"] for entry in entries] == ["1", "2", "3"]
    assert (added, updated) == (2, 0)


def test_year_bucket_rejects_entry_missing_date_field():
    try:
        merge_year_bucket_entries(
            None, "project", "token", "uid", "garminActivities",
            [{"date": "2026-01-02", "stravaId": "1"}],
            "stravaId",
            True,
            "timestamp",
        )
    except ValueError as error:
        assert str(error) == "Invalid timestamp for stravaId '1': ''", error
    else:
        raise AssertionError("expected ValueError for a missing timestamp")


def _run():
    tests = [value for key, value in sorted(globals().items()) if key.startswith("test_")]
    for test in tests:
        test()
        print(f"  ok  {test.__name__}")
    print(f"\n{len(tests)} passed")


if __name__ == "__main__":
    _run()
