#!/usr/bin/env python3
"""Offline tests for the Garmin-to-Gaia sync."""

import importlib.util
import os
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "garmin_gaia_sync", os.path.join(_HERE, "garmin-gaia-sync.py")
)
sync = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sync)

VALID_GPX = b"""<?xml version="1.0"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Old name</name><trkseg><trkpt lat="47.1" lon="-122.2"/></trkseg></trk>
</gpx>"""


def test_filters_exact_activity_types():
    assert sync.eligible_activity({"activityType": {"typeKey": "hiking"}})
    assert sync.eligible_activity({"activityType": {"typeKey": "mountaineering"}})
    assert not sync.eligible_activity({"activityType": {"typeKey": "walking"}})
    assert not sync.eligible_activity({"activityType": {"typeKey": "Hiking"}})
    assert not sync.eligible_activity({"activityType": "hiking"})


def test_prepares_valid_gpx_with_deterministic_marker():
    prepared = sync.prepare_gpx(VALID_GPX, "[Garmin activity:123] - Ridge")
    root = ET.fromstring(prepared)
    names = [node.text for node in root.iter() if node.tag.endswith("}name")]
    assert names == ["[Garmin activity:123] - Ridge"]


def test_rejects_out_of_range_or_missing_coordinates():
    no_coordinates = b"<gpx><trk><trkseg><trkpt lat='91' lon='0'/></trkseg></trk></gpx>"
    assert sync.prepare_gpx(no_coordinates, "title") is None
    assert sync.prepare_gpx(b"<gpx><trk/></gpx>", "title") is None


def test_malformed_and_empty_gpx_fail():
    for value in (b"", b"<gpx>"):
        try:
            sync.prepare_gpx(value, "title")
            raise AssertionError("Expected invalid GPX to fail")
        except ValueError:
            pass


def test_activity_title_uses_id_not_date_or_title_for_identity():
    first = {"activityId": 123, "activityName": "Ridge", "startTimeLocal": "2026-01-01"}
    renamed = {"activityId": 123, "activityName": "New name", "startTimeLocal": "2026-02-02"}
    assert sync.activity_marker(first["activityId"]) in sync.activity_title(first)
    assert sync.activity_marker(renamed["activityId"]) in sync.activity_title(renamed)


class FakeGaia:
    def __init__(self, folders, tracks):
        self.folders = folders
        self.tracks = tracks
        self.uploads = 0
        self.deleted = []

    def list_objects(self, object_type):
        return self.folders if object_type == "folder" else self.tracks

    def upload_file(self, path):
        self.uploads += 1
        self.folders.append({"id": "temp", "tracks": ["new-track"]})
        self.tracks.append(
            {"id": "new-track", "title": "[Garmin activity:123] - Ridge"}
        )
        return "temp"

    def put_folder(self, folder):
        return True

    def delete_folder(self, folder_id):
        self.deleted.append(folder_id)


def test_duplicate_in_destination_is_skipped():
    gaia = FakeGaia(
        [{"id": "destination", "tracks": ["existing"]}],
        [{"id": "existing", "title": "[Garmin activity:123] - Ridge"}],
    )
    result = sync.sync_gpx_to_gaia(gaia, Path("unused"), "destination", "123")
    assert result == "duplicate"
    assert gaia.uploads == 0


def test_partial_failure_track_is_recovered_without_upload():
    gaia = FakeGaia(
        [{"id": "destination", "tracks": []}],
        [{"id": "existing", "title": "[Garmin activity:123] - Ridge"}],
    )
    result = sync.sync_gpx_to_gaia(gaia, Path("unused"), "destination", "123")
    assert result == "recovered"
    assert gaia.uploads == 0
    assert gaia.folders[0]["tracks"] == ["existing"]


def test_upload_assigns_tracks_and_removes_temporary_folder():
    gaia = FakeGaia([{"id": "destination", "tracks": []}], [])
    result = sync.sync_gpx_to_gaia(gaia, Path("unused"), "destination", "123")
    assert result == "uploaded"
    assert gaia.folders[0]["tracks"] == ["new-track"]
    assert gaia.deleted == ["temp"]


def test_missing_or_ambiguous_folder_fails_before_upload():
    for folders in (
        [],
        [{"id": "destination", "tracks": []}, {"id": "destination", "tracks": []}],
    ):
        gaia = FakeGaia(folders, [])
        try:
            sync.sync_gpx_to_gaia(gaia, Path("unused"), "destination", "123")
            raise AssertionError("Expected folder validation to fail")
        except RuntimeError:
            pass
        assert gaia.uploads == 0


def test_activity_limit_is_bounded():
    assert sync._activity_limit("30") == 30
    for value in ("0", "101", "bad"):
        try:
            sync._activity_limit(value)
            raise AssertionError("Expected invalid limit to fail")
        except ValueError:
            pass


class FakeGarmin:
    class ActivityDownloadFormat:
        GPX = "gpx"

    def get_activities(self, start, limit):
        assert (start, limit) == (0, 30)
        return [
            {
                "activityId": 123,
                "activityName": "Ridge",
                "activityType": {"typeKey": "hiking"},
            },
            {"activityId": 456, "activityType": {"typeKey": "running"}},
        ]

    def download_activity(self, activity_id, download_format):
        assert activity_id == "123"
        return VALID_GPX


def test_export_mode_writes_only_eligible_valid_tracks():
    with tempfile.TemporaryDirectory() as directory:
        summary, failures = sync.run(FakeGarmin(), Path(directory))
        assert failures == 0
        assert summary == [("123", "exported for manual Gaia import")]
        assert [path.name for path in Path(directory).iterdir()] == ["garmin-123.gpx"]


def _run():
    tests = [value for key, value in sorted(globals().items()) if key.startswith("test_")]
    for test in tests:
        test()
        print(f"  ok  {test.__name__}")
    print(f"\n{len(tests)} passed")


if __name__ == "__main__":
    _run()
