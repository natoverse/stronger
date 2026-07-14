#!/usr/bin/env python3
"""Offline unit tests for the sheet-backup pure helpers.

Run with:  python scripts/test_sheet_backup.py

These tests exercise only the pure tab-selection helpers — no network, no
Google auth.
"""

import importlib.util
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "sheet_backup", os.path.join(_HERE, "sheet-backup.py")
)
sheet_backup = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sheet_backup)


def test_tabs_to_copy_preserves_order():
    titles = ["Stronger - Exercises", "Stronger - Log", "Stronger - Settings"]
    assert sheet_backup.tabs_to_copy(titles) == titles


def test_tabs_to_copy_drops_duplicates_and_empties():
    titles = ["A", "A", "", None, "B"]
    assert sheet_backup.tabs_to_copy(titles) == ["A", "B"]


def test_tabs_to_create_returns_missing_only():
    source = ["A", "B", "C"]
    target = ["B"]
    assert sheet_backup.tabs_to_create(source, target) == ["A", "C"]


def test_tabs_to_create_empty_when_all_present():
    source = ["A", "B"]
    target = ["A", "B", "Extra"]
    assert sheet_backup.tabs_to_create(source, target) == []


def _run():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"  ok  {t.__name__}")
    print(f"\n{len(tests)} passed")


if __name__ == "__main__":
    _run()
