#!/usr/bin/env python3
"""Offline tests for the Garmin GPX export."""

import importlib.util
import os
import tempfile
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path
from unittest import mock

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "garmin_gpx_export", os.path.join(_HERE, "garmin-gpx-export.py")
)
export = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(export)

VALID_GPX = b"""<?xml version="1.0"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Old name</name><trkseg>
    <trkpt lat="47.1" lon="-122.2"><time>2026-08-23T00:00:00Z</time></trkpt>
  </trkseg></trk>
</gpx>"""


class FakeGarmin:
    class ActivityDownloadFormat:
        GPX = "gpx"

    def __init__(self):
        self.downloaded = []

    def get_activities_by_date(self, start_date, end_date):
        assert (start_date, end_date) == ("2015-01-01", "2026-08-26")
        return [
            {
                "activityId": 123,
                "activityName": "Ridge",
                "activityType": {"typeKey": "hiking"},
            },
            {
                "activityId": 456,
                "activityName": "Summit",
                "activityType": {"typeKey": "mountaineering"},
            },
            {
                "activityId": 789,
                "activityName": "Run",
                "activityType": {"typeKey": "running"},
            },
        ]

    def download_activity(self, activity_id, download_format):
        assert download_format == self.ActivityDownloadFormat.GPX
        self.downloaded.append(activity_id)
        return VALID_GPX if activity_id == "123" else b"<gpx><trk/></gpx>"


def test_exports_gaia_eligible_tracks_from_2015():
    garmin = FakeGarmin()
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        output_dir = root / "gpx"
        summary, failures = export.export_activities(
            garmin, output_dir, today=date(2026, 8, 25)
        )
        assert failures == 0
        assert garmin.downloaded == ["123", "456"]
        assert [item["result"] for item in summary] == [
            "exported",
            "skipped: no valid track coordinates",
        ]
        assert [path.name for path in output_dir.iterdir()] == ["garmin-123.gpx"]
        exported_gpx = (output_dir / "garmin-123.gpx").read_bytes()
        assert b'<gpx xmlns="http://www.topografix.com/GPX/1/1">' in exported_gpx
        assert b"ns0:" not in exported_gpx
        root = ET.fromstring(exported_gpx)
        names = [node.text for node in root.iter() if node.tag.endswith("}name")]
        assert names == ["Ridge"]


def test_reports_failure_without_discarding_successful_exports():
    class PartialFailureGarmin(FakeGarmin):
        def get_activities_by_date(self, start_date, end_date):
            assert (start_date, end_date) == ("2015-01-01", "2026-08-26")
            return [
                {
                    "activityId": 123,
                    "activityName": "Ridge",
                    "activityType": {"typeKey": "hiking"},
                },
                {
                    "activityId": "invalid",
                    "activityName": "Broken",
                    "activityType": {"typeKey": "hiking"},
                },
            ]

    with tempfile.TemporaryDirectory() as directory:
        output_dir = Path(directory)
        summary, failures = export.export_activities(
            PartialFailureGarmin(), output_dir, today=date(2026, 8, 25)
        )

        assert failures == 1
        assert [item["result"] for item in summary] == [
            "exported",
            "failed: invalid Garmin activity ID",
        ]
        assert (output_dir / "garmin-123.gpx").exists()


def test_exports_only_selected_types_with_full_history_year_boundary():
    for selected, expected_ids in (
        ("cycling", ["1"]),
        ("mountain_biking", ["2"]),
        ("cycling,mountain_biking", ["1", "2"]),
        ("walking", []),
    ):
        garmin = mock.Mock()
        garmin.get_activities_by_date.return_value = [
            {"activityId": index, "activityName": key, "activityType": {"typeKey": key}}
            for index, key in enumerate(
                ("cycling", "mountain_biking", "hiking", "indoor_cycling"), start=1
            )
        ]
        garmin.download_activity.return_value = VALID_GPX
        with tempfile.TemporaryDirectory() as directory:
            summary, failures = export.export_activities(
                garmin, Path(directory), today=date(2026, 12, 31),
                activity_types=export.gaia_sync.parse_activity_types(selected),
            )
            assert failures == 0
            assert [item["activity_id"] for item in summary] == expected_ids
            assert sorted(path.name for path in Path(directory).iterdir()) == [
                f"garmin-{activity_id}.gpx" for activity_id in expected_ids
            ]
        garmin.get_activities_by_date.assert_called_once_with("2015-01-01", "2027-01-01")
        assert [call.args[0] for call in garmin.download_activity.call_args_list] == expected_ids


def test_main_forwards_types_without_gaia_credentials():
    for argv, expected in (
        ([], frozenset({"cycling"})),
        (["--activity-types", "mountain_biking"], frozenset({"mountain_biking"})),
    ):
        with (
            tempfile.TemporaryDirectory() as directory,
            mock.patch.dict(os.environ, {
                "GARMIN_TOKENS": "tokens",
                "GARMIN_ACTIVITY_TYPES": "cycling",
            }, clear=True),
            mock.patch.object(export.gaia_sync, "login_from_tokens") as login,
            mock.patch.object(export.gaia_sync, "GaiaClient") as gaia,
            mock.patch.object(export, "export_activities", return_value=([], 0)) as run,
            mock.patch("builtins.print") as output,
        ):
            export.main(["--output-dir", directory, *argv])
            run.assert_called_once_with(
                login.return_value, Path(directory), activity_types=expected
            )
            gaia.assert_not_called()
            messages = " ".join(str(call) for call in output.call_args_list)
            assert "No eligible activities found for: " + ", ".join(expected) in messages


def test_main_rejects_invalid_types_before_garmin_login():
    for argv, environment in (
        (["--activity-types", "*"], {}),
        ([], {"GARMIN_ACTIVITY_TYPES": ""}),
    ):
        with (
            mock.patch.dict(os.environ, {"GARMIN_TOKENS": "tokens", **environment}, clear=True),
            mock.patch.object(export.gaia_sync, "login_from_tokens") as login,
        ):
            try:
                export.main(argv)
                raise AssertionError("Expected invalid type selection to fail")
            except SystemExit as error:
                assert error.code == 2
            login.assert_not_called()
