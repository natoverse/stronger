#!/usr/bin/env python3
"""Offline tests for the Garmin-to-Gaia sync."""

import importlib.util
import os
import sys
import tempfile
import types
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path
from unittest import mock

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "garmin_gaia_sync", os.path.join(_HERE, "garmin-gaia-sync.py")
)
sync = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sync)

VALID_GPX = b"""<?xml version="1.0"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Old name</name><trkseg>
    <trkpt lat="47.1" lon="-122.2"><ele>100</ele><time>2026-08-23T00:00:00Z</time></trkpt>
    <trkpt lat="47.1001" lon="-122.2001"><ele>105</ele><time>2026-08-23T00:00:10Z</time></trkpt>
  </trkseg></trk>
</gpx>"""


class FakeCookies:
    def __init__(self):
        self.values = []

    def set(self, name, value, **kwargs):
        self.values.append((name, value, kwargs))

    def get(self, name):
        matches = [value for key, value, _ in self.values if key == name]
        return matches[-1] if matches else None


class FakeSession:
    def __init__(
        self, status_code=200, response_url=None, content=b"", headers=None
    ):
        self.headers = {}
        self.cookies = FakeCookies()
        self.requests = []
        self.status_code = status_code
        self.response_url = response_url
        self.content = content
        self.response_headers = headers or {}

    def request(self, method, url, **kwargs):
        self.requests.append((method, url, kwargs))
        return types.SimpleNamespace(
            status_code=self.status_code,
            url=self.response_url or url,
            ok=self.status_code < 400,
            content=self.content,
            headers=self.response_headers,
        )


def test_gaia_client_uses_browser_impersonation_and_exact_cookie_host():
    created = []

    def session_factory(**kwargs):
        created.append(kwargs)
        return FakeSession()

    fake_curl_cffi = types.SimpleNamespace(
        requests=types.SimpleNamespace(Session=session_factory)
    )
    with mock.patch.dict(sys.modules, {"curl_cffi": fake_curl_cffi}):
        client = sync.GaiaClient("secret", request_delay=0)

    assert created == [{"impersonate": "chrome"}]
    assert client.session.cookies.values == [
        ("sessionid", "secret", {"domain": "www.gaiagps.com"})
    ]
    assert client.session.headers == {}


def test_auth_verification_uses_protected_api_endpoint():
    session = FakeSession()
    client = sync.GaiaClient("secret", request_delay=0, session=session)
    client.verify_auth()
    assert session.requests == [
        (
            "GET",
            "https://www.gaiagps.com/api/objects/folder/",
            {"params": {"count": "1", "page": "1"}},
        )
    ]


def test_auth_verification_rejects_unauthorized_session():
    for status_code in (401, 403):
        client = sync.GaiaClient(
            "secret",
            request_delay=0,
            session=FakeSession(status_code=status_code),
        )
        try:
            client.verify_auth()
            raise AssertionError("Expected invalid Gaia session to fail")
        except RuntimeError as error:
            assert str(error) == (
                f"Gaia session expired or was rejected (status {status_code})"
            )


def test_create_track_uses_captured_json_endpoint_and_csrf_headers():
    session = FakeSession()
    client = sync.GaiaClient("secret", request_delay=0, session=session)
    client.session.cookies.set(
        "csrftoken", "csrf-secret", domain="www.gaiagps.com"
    )
    with mock.patch.object(sync.random, "randrange", return_value=0x12AB34):
        client.create_track(VALID_GPX, "Ridge", "folder", "123")

    assert session.requests[0][:2] == (
        "GET",
        "https://www.gaiagps.com/map/",
    )
    upload_request = session.requests[1][2]
    assert session.requests[1][:2] == (
        "POST",
        "https://www.gaiagps.com/api/v3/tracks/",
    )
    assert upload_request["headers"]["X-CSRFToken"] == "csrf-secret"
    payload = upload_request["json"]
    assert len(payload) == 1
    assert payload[0]["geometry"]["type"] == "LineString"
    assert payload[0]["geometry"]["coordinates"][0] == [
        -122.2,
        47.1,
        100.0,
        1787443200,
    ]
    assert payload[0]["name"] == "Ridge"
    assert payload[0]["source"] == "[Garmin activity:123]"
    assert payload[0]["hex_color"] == "#12AB34"
    assert payload[0]["parent_folder_id"] == "folder"
    assert payload[0]["stats"]["point_count"] == 2
    assert payload[0]["create_date"] == "2026-08-23T00:00:00.000Z"


def test_create_track_fails_without_csrf_token():
    client = sync.GaiaClient(
        "secret",
        request_delay=0,
        session=FakeSession(),
    )
    try:
        client.create_track(VALID_GPX, "title", "folder", "123")
        raise AssertionError("Expected missing Gaia CSRF token to fail")
    except RuntimeError as error:
        assert str(error) == "Gaia map page did not provide a CSRF token"


def test_write_rejection_retries_with_exponential_backoff():
    session = FakeSession(status_code=403)
    delays = []
    client = sync.GaiaClient(
        "secret",
        request_delay=0,
        session=session,
        write_attempts=3,
        retry_delay=5,
        sleep=delays.append,
    )
    try:
        client._request("POST", "/api/v3/tracks/")
        raise AssertionError("Expected rejected Gaia write to fail")
    except sync.GaiaWriteRejected as error:
        assert "temporarily rate limited" in str(error)
    assert delays == [5, 10]
    assert len(session.requests) == 3


def test_write_rejection_honors_retry_after():
    session = FakeSession(status_code=429, headers={"Retry-After": "7"})
    delays = []
    client = sync.GaiaClient(
        "secret",
        request_delay=0,
        session=session,
        write_attempts=2,
        sleep=delays.append,
    )
    try:
        client._request("PUT", "/api/objects/folder/1/")
        raise AssertionError("Expected rate-limited Gaia write to fail")
    except sync.GaiaWriteRejected:
        pass
    assert delays == [7]


def test_rate_limit_honors_retry_after_http_date_for_reads():
    session = FakeSession(
        status_code=429,
        headers={
            "Date": "Mon, 24 Aug 2026 19:26:00 GMT",
            "Retry-After": "Mon, 24 Aug 2026 19:27:15 GMT",
        },
    )
    delays = []
    client = sync.GaiaClient(
        "secret",
        request_delay=0,
        session=session,
        write_attempts=2,
        sleep=delays.append,
    )
    try:
        client._request("GET", "/api/objects/track/")
        raise AssertionError("Expected rate-limited Gaia read to fail")
    except sync.GaiaRateLimited as error:
        assert "Retry-After=Mon, 24 Aug 2026 19:27:15 GMT" in str(error)
    assert delays == [75]
    assert len(session.requests) == 2


def test_failure_reports_relevant_rate_limit_headers_only():
    session = FakeSession(
        status_code=429,
        headers={
            "Retry-After": "7",
            "RateLimit-Remaining": "0",
            "X-RateLimit-Reset": "1787599662",
            "Set-Cookie": "secret",
        },
    )
    client = sync.GaiaClient(
        "secret",
        request_delay=0,
        session=session,
        write_attempts=1,
    )
    try:
        client._request("GET", "/api/objects/track/")
        raise AssertionError("Expected rate-limited Gaia read to fail")
    except sync.GaiaRateLimited as error:
        message = str(error)
        assert "status 429" in message
        assert "Retry-After=7" in message
        assert "RateLimit-Remaining=0" in message
        assert "X-RateLimit-Reset=1787599662" in message
        assert "Set-Cookie" not in message
        assert "secret" not in message


def test_filters_exact_activity_types():
    assert sync.eligible_activity({"activityType": {"typeKey": "hiking"}})
    assert sync.eligible_activity({"activityType": {"typeKey": "mountaineering"}})
    assert not sync.eligible_activity({"activityType": {"typeKey": "walking"}})
    assert not sync.eligible_activity({"activityType": {"typeKey": "Hiking"}})
    assert not sync.eligible_activity({"activityType": "hiking"})


def test_prepares_valid_gpx_with_activity_name_only():
    prepared = sync.prepare_gpx(VALID_GPX, "Ridge")
    root = ET.fromstring(prepared)
    names = [node.text for node in root.iter() if node.tag.endswith("}name")]
    assert names == ["Ridge"]


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


def test_activity_title_uses_activity_name_only():
    first = {"activityId": 123, "activityName": "Ridge", "startTimeLocal": "2026-01-01"}
    renamed = {"activityId": 123, "activityName": "New name", "startTimeLocal": "2026-02-02"}
    assert sync.activity_title(first) == "Ridge"
    assert sync.activity_title(renamed) == "New name"
    try:
        sync.activity_title({"activityId": 123, "activityName": " "})
        raise AssertionError("Expected missing activity name to fail")
    except ValueError as error:
        assert str(error) == "missing Garmin activity name"


class FakeGaia:
    def __init__(self, folders, tracks):
        self.folders = folders
        self.tracks = tracks
        self.uploads = 0
        self.deleted = []

    def list_objects(self, object_type):
        return self.folders if object_type == "folder" else self.tracks

    def create_track(self, gpx_bytes, title, folder_id, activity_id):
        self.uploads += 1
        self.folders[0]["tracks"].append("new-track")
        self.tracks.append(
            {
                "id": "new-track",
                "name": title,
                "source": sync.activity_marker(activity_id),
            }
        )

    def put_folder(self, folder):
        return True

    def delete_folder(self, folder_id):
        self.deleted.append(folder_id)


def test_duplicate_in_destination_is_skipped():
    gaia = FakeGaia(
        [{"id": "destination", "tracks": ["existing"]}],
        [
            {
                "id": "existing",
                "title": "Ridge",
                "source": "[Garmin activity:123]",
            }
        ],
    )
    result = sync.sync_gpx_to_gaia(
        gaia, VALID_GPX, "title", "destination", "123"
    )
    assert result == "duplicate"
    assert gaia.uploads == 0


def test_duplicate_in_destination_is_uploaded_when_allowed():
    gaia = FakeGaia(
        [{"id": "destination", "tracks": ["existing"]}],
        [
            {
                "id": "existing",
                "title": "Ridge",
                "source": "[Garmin activity:123]",
            }
        ],
    )
    result = sync.sync_gpx_to_gaia(
        gaia,
        VALID_GPX,
        "title",
        "destination",
        "123",
        allow_duplicates=True,
    )
    assert result == "uploaded"
    assert gaia.uploads == 1
    assert gaia.folders[0]["tracks"] == ["existing", "new-track"]


def test_partial_failure_track_is_recovered_without_upload():
    gaia = FakeGaia(
        [{"id": "destination", "tracks": []}],
        [{"id": "existing", "title": "[Garmin activity:123] - Ridge"}],
    )
    result = sync.sync_gpx_to_gaia(
        gaia, VALID_GPX, "title", "destination", "123"
    )
    assert result == "recovered"
    assert gaia.uploads == 0
    assert gaia.folders[0]["tracks"] == ["existing"]


def test_legacy_title_marker_is_still_recognized():
    gaia = FakeGaia(
        [{"id": "destination", "tracks": ["existing"]}],
        [{"id": "existing", "title": "[Garmin activity:123] - Ridge"}],
    )
    result = sync.sync_gpx_to_gaia(
        gaia, VALID_GPX, "Ridge", "destination", "123"
    )
    assert result == "duplicate"
    assert gaia.uploads == 0


def test_upload_creates_track_in_destination_folder():
    gaia = FakeGaia([{"id": "destination", "tracks": []}], [])
    result = sync.sync_gpx_to_gaia(
        gaia, VALID_GPX, "title", "destination", "123"
    )
    assert result == "uploaded"
    assert gaia.folders[0]["tracks"] == ["new-track"]
    assert gaia.deleted == []


def test_missing_or_ambiguous_folder_fails_before_upload():
    for folders in (
        [],
        [{"id": "destination", "tracks": []}, {"id": "destination", "tracks": []}],
    ):
        gaia = FakeGaia(folders, [])
        try:
            sync.sync_gpx_to_gaia(
                gaia, VALID_GPX, "title", "destination", "123"
            )
            raise AssertionError("Expected folder validation to fail")
        except RuntimeError:
            pass
        assert gaia.uploads == 0


def test_each_track_gets_a_random_color():
    with mock.patch.object(
        sync.random, "randrange", side_effect=(0x000001, 0xABCDEF)
    ):
        first = sync.gaia_track_payload(VALID_GPX, "First", "folder", "123")
        second = sync.gaia_track_payload(VALID_GPX, "Second", "folder", "456")

    assert first["hex_color"] == "#000001"
    assert second["hex_color"] == "#ABCDEF"


def test_default_window_covers_last_30_days():
    assert sync.activity_date_range(today=date(2026, 8, 24)) == (
        "2026-07-26",
        "2026-08-25",
    )


def test_backfill_starts_at_2015():
    assert sync.activity_date_range(backfill=True, today=date(2026, 8, 24)) == (
        "2015-01-01",
        "2026-08-25",
    )


class FakeGarmin:
    class ActivityDownloadFormat:
        GPX = "gpx"

    def get_activities_by_date(self, start_date, end_date):
        assert (start_date, end_date) == ("2026-07-26", "2026-08-25")
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


def test_run_uploads_only_eligible_valid_tracks():
    with tempfile.TemporaryDirectory() as directory:
        gaia = FakeGaia([{"id": "destination", "tracks": []}], [])
        summary, failures = sync.run(
            FakeGarmin(),
            Path(directory),
            gaia,
            "destination",
            today=date(2026, 8, 24),
        )
        assert failures == 0
        assert summary == [("123", "uploaded")]
        assert [path.name for path in Path(directory).iterdir()] == ["garmin-123.gpx"]


class RejectingGaia(FakeGaia):
    def create_track(self, gpx_bytes, title, folder_id, activity_id):
        self.uploads += 1
        raise sync.GaiaWriteRejected("rate limited")


def test_run_stops_after_persistent_gaia_write_rejection():
    class TwoActivityGarmin(FakeGarmin):
        def get_activities_by_date(self, start_date, end_date):
            return [
                {
                    "activityId": 123,
                    "activityName": "First",
                    "activityType": {"typeKey": "hiking"},
                },
                {
                    "activityId": 124,
                    "activityName": "Second",
                    "activityType": {"typeKey": "hiking"},
                },
            ]

    with tempfile.TemporaryDirectory() as directory:
        gaia = RejectingGaia([{"id": "destination", "tracks": []}], [])
        summary, failures = sync.run(
            TwoActivityGarmin(),
            Path(directory),
            gaia,
            "destination",
            today=date(2026, 8, 24),
        )
    assert failures == 1
    assert summary == [("123", "failed: rate limited")]
    assert gaia.uploads == 1


def _run():
    tests = [value for key, value in sorted(globals().items()) if key.startswith("test_")]
    for test in tests:
        test()
        print(f"  ok  {test.__name__}")
    print(f"\n{len(tests)} passed")


if __name__ == "__main__":
    _run()
