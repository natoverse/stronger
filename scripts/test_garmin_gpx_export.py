#!/usr/bin/env python3
"""Offline tests for the Garmin GPX export."""

import importlib.util
import os
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

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


def test_exports_gaia_eligible_tracks_from_2015_and_creates_zip():
    garmin = FakeGarmin()
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        output_dir = root / "gpx"
        summary, failures = export.export_activities(
            garmin, output_dir, today=date(2026, 8, 25)
        )
        archive = export.create_archive(output_dir, root / "garmin-gpx-export.zip")

        assert failures == 0
        assert garmin.downloaded == ["123", "456"]
        assert [item["result"] for item in summary] == [
            "exported",
            "skipped: no valid track coordinates",
        ]
        assert [path.name for path in output_dir.iterdir()] == ["garmin-123.gpx"]
        with zipfile.ZipFile(archive) as bundle:
            assert bundle.namelist() == ["garmin-123.gpx"]
            root = ET.fromstring(bundle.read("garmin-123.gpx"))
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
