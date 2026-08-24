#!/usr/bin/env python3
"""Sync recent Garmin hiking tracks to Gaia GPS.

Gaia has no supported write API. This script uses its private web behavior to
upload validated GPX files into an existing folder.

Required environment variables:
  GARMIN_TOKENS    Saved garminconnect token bundle.
  GAIA_SESSION_ID  Browser-extracted Gaia session cookie.
  GAIA_FOLDER_ID   Existing destination folder ID.
"""

from __future__ import annotations

import argparse
import math
import os
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from datetime import date, timedelta
from pathlib import Path

ELIGIBLE_TYPES = frozenset({"hiking", "mountaineering"})
ROLLING_DAYS = 4
BACKFILL_START_DATE = "2015-01-01"
MAX_GPX_BYTES = 25 * 1024 * 1024
GAIA_BASE_URL = "https://www.gaiagps.com"


def encode_upload(path, csrf_token):
    """Build the multipart body expected by Gaia's legacy upload endpoint."""
    import requests

    with path.open("rb") as gpx_file:
        request = requests.Request(
            "POST",
            f"{GAIA_BASE_URL}/upload/",
            files={"files": gpx_file},
            data={
                "name": path.name,
                "csrfmiddlewaretoken": csrf_token,
            },
        ).prepare()
    return request.body, request.headers["Content-Type"]


def login_from_tokens(token_bundle):
    """Return an authenticated Garmin client from a saved token bundle."""
    from garminconnect import Garmin

    token_dir = tempfile.mkdtemp(prefix="garmin-tokens-")
    (Path(token_dir) / "garmin_tokens.json").write_text(token_bundle)
    garmin = Garmin()
    garmin.login(token_dir)
    return garmin


def eligible_activity(activity):
    """Return whether an activity has an exact Gaia-sync type key."""
    activity_type = activity.get("activityType")
    return (
        isinstance(activity_type, dict)
        and activity_type.get("typeKey") in ELIGIBLE_TYPES
    )


def activity_marker(activity_id):
    """Return the durable marker embedded in every imported track title."""
    return f"[Garmin activity:{activity_id}]"


def activity_title(activity):
    """Return a deterministic Gaia track title containing the Garmin ID."""
    activity_id = str(activity.get("activityId") or "")
    name = str(activity.get("activityName") or "").strip()
    marker = activity_marker(activity_id)
    return f"{marker} - {name}" if name else marker


def _valid_coordinate(value, minimum, maximum):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return False
    return math.isfinite(number) and minimum <= number <= maximum


def prepare_gpx(gpx_bytes, title):
    """Validate GPX track coordinates and apply deterministic track names.

    Returns serialized GPX bytes, or ``None`` for well-formed GPX without a
    valid latitude/longitude pair. Malformed or empty XML raises ``ValueError``.
    """
    if not gpx_bytes:
        raise ValueError("empty GPX export")
    if len(gpx_bytes) > MAX_GPX_BYTES:
        raise ValueError("GPX export exceeds 25 MiB")
    try:
        root = ET.fromstring(gpx_bytes)
    except ET.ParseError as error:
        raise ValueError(f"malformed GPX: {error}") from error

    tracks = [element for element in root.iter() if element.tag.endswith("}trk")]
    if not tracks:
        tracks = [element for element in root.iter() if element.tag == "trk"]

    has_coordinates = any(
        point.tag.endswith("}trkpt") or point.tag == "trkpt"
        for point in root.iter()
        if _valid_coordinate(point.get("lat"), -90, 90)
        and _valid_coordinate(point.get("lon"), -180, 180)
    )
    if not has_coordinates:
        return None

    for index, track in enumerate(tracks):
        name = next(
            (
                child
                for child in track
                if child.tag.endswith("}name") or child.tag == "name"
            ),
            None,
        )
        if name is None:
            namespace = track.tag.partition("}")[0] + "}" if "}" in track.tag else ""
            name = ET.Element(f"{namespace}name")
            track.insert(0, name)
        name.text = title if index == 0 else f"{title} ({index + 1})"

    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


class GaiaClient:
    """Minimal client for Gaia's unsupported private upload behavior."""

    def __init__(self, session_id, request_delay=2.0, session=None):
        if session is None:
            from curl_cffi import requests

            session = requests.Session(impersonate="chrome")
        self.session = session
        self.session.cookies.set(
            "sessionid", session_id, domain="www.gaiagps.com"
        )
        self.request_delay = request_delay

    def _request(self, method, path, **kwargs):
        response = self.session.request(method, f"{GAIA_BASE_URL}{path}", **kwargs)
        if response.status_code in (401, 403) or "login" in response.url:
            raise RuntimeError("Gaia session expired or was rejected")
        if response.status_code == 429:
            raise RuntimeError("Gaia rate limit reached")
        if not response.ok:
            raise RuntimeError(
                f"Gaia request failed ({response.status_code}) at {path}"
            )
        return response

    def verify_auth(self):
        self._request(
            "GET",
            "/api/objects/folder/",
            params={"count": "1", "page": "1"},
        )

    def list_objects(self, object_type):
        response = self._request(
            "GET",
            f"/api/objects/{object_type}/",
            params={
                "count": "5000",
                "page": "1",
                "routepoints": "false",
                "show_archived": "true",
                "show_filed": "true",
            },
        )
        return response.json()

    def upload_file(self, path):
        time.sleep(self.request_delay)
        self._request("GET", "/upload/")
        csrf_token = self.session.cookies.get("csrftoken")
        if not csrf_token:
            raise RuntimeError("Gaia upload page did not provide a CSRF token")
        body, content_type = encode_upload(path, csrf_token)
        response = self._request(
            "POST",
            "/upload/",
            data=body,
            allow_redirects=True,
            headers={
                "Content-Type": content_type,
                "Origin": GAIA_BASE_URL,
                "Referer": f"{GAIA_BASE_URL}/upload/",
                "X-CSRFToken": csrf_token,
            },
        )
        if b"File uploaded to queue" in response.content:
            raise RuntimeError("Gaia queued the upload; folder assignment is unknown")
        folder_prefix = f"{GAIA_BASE_URL}/datasummary/folder/"
        if not response.url.startswith(folder_prefix):
            raise RuntimeError("Gaia rejected the GPX upload")
        return response.url.removeprefix(folder_prefix).strip("/")

    def put_folder(self, folder):
        time.sleep(self.request_delay)
        self._request(
            "PUT", f"/api/objects/folder/{folder['id']}/", json=folder
        )
        return True

    def delete_folder(self, folder_id):
        time.sleep(self.request_delay)
        self._request("DELETE", f"/api/objects/folder/{folder_id}/")


def _one_by_id(objects, object_id, object_name):
    matches = [item for item in objects if str(item.get("id")) == str(object_id)]
    if len(matches) != 1:
        raise RuntimeError(
            f"Configured Gaia {object_name} ID matched {len(matches)} objects"
        )
    return matches[0]


def sync_gpx_to_gaia(client, gpx_path, folder_id, activity_id):
    """Upload or recover one activity and assign all its tracks to a folder."""
    folders = client.list_objects("folder")
    destination = _one_by_id(folders, folder_id, "folder")
    marker = activity_marker(activity_id)
    tracks = client.list_objects("track")
    matching_tracks = [
        track for track in tracks if marker in str(track.get("title") or "")
    ]
    matching_ids = [str(track["id"]) for track in matching_tracks]
    destination_ids = [str(track_id) for track_id in destination.get("tracks", [])]

    if matching_ids and all(track_id in destination_ids for track_id in matching_ids):
        return "duplicate"

    temporary_folder_id = None
    if not matching_ids:
        temporary_folder_id = client.upload_file(gpx_path)
        folders = client.list_objects("folder")
        temporary = _one_by_id(folders, temporary_folder_id, "upload folder")
        matching_ids = [str(track_id) for track_id in temporary.get("tracks", [])]
        if not matching_ids:
            raise RuntimeError("Gaia import produced no tracks")
        tracks_by_id = {
            str(track.get("id")): track for track in client.list_objects("track")
        }
        if any(
            marker not in str(tracks_by_id.get(track_id, {}).get("title") or "")
            for track_id in matching_ids
        ):
            raise RuntimeError("Garmin activity marker did not survive Gaia import")

    destination["tracks"] = list(
        dict.fromkeys([*destination.get("tracks", []), *matching_ids])
    )
    if not client.put_folder(destination):
        raise RuntimeError("Gaia rejected destination folder assignment")

    refreshed = _one_by_id(client.list_objects("folder"), folder_id, "folder")
    refreshed_ids = [str(track_id) for track_id in refreshed.get("tracks", [])]
    if any(track_id not in refreshed_ids for track_id in matching_ids):
        raise RuntimeError("Gaia did not retain destination folder assignment")

    if temporary_folder_id:
        client.delete_folder(temporary_folder_id)
    return "uploaded" if temporary_folder_id else "recovered"


def activity_date_range(backfill=False, today=None):
    """Return Garmin's inclusive start and exclusive end date bounds."""
    today = today or date.today()
    start_date = (
        BACKFILL_START_DATE
        if backfill
        else (today - timedelta(days=ROLLING_DAYS - 1)).isoformat()
    )
    return start_date, (today + timedelta(days=1)).isoformat()


def run(garmin, output_dir, gaia, folder_id, backfill=False, today=None):
    """Process activities in the selected window and return a summary."""
    output_dir.mkdir(parents=True, exist_ok=True)
    start_date, end_date = activity_date_range(backfill, today)
    activities = garmin.get_activities_by_date(start_date, end_date) or []
    summary = []
    failures = 0

    for activity in activities:
        if not eligible_activity(activity):
            continue
        activity_id = str(activity.get("activityId") or "")
        if not activity_id.isdigit():
            failures += 1
            summary.append(("unknown", "failed: invalid Garmin activity ID"))
            continue
        try:
            raw_gpx = garmin.download_activity(
                activity_id, garmin.ActivityDownloadFormat.GPX
            )
            prepared = prepare_gpx(raw_gpx, activity_title(activity))
            if prepared is None:
                summary.append((activity_id, "skipped: no valid track coordinates"))
                continue
            path = output_dir / f"garmin-{activity_id}.gpx"
            path.write_bytes(prepared)
            result = sync_gpx_to_gaia(gaia, path, folder_id, activity_id)
            summary.append((activity_id, result))
        except Exception as error:  # noqa: BLE001 - report each activity and continue
            failures += 1
            summary.append((activity_id, f"failed: {error}"))

    return summary, failures


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--backfill", action="store_true")
    parser.add_argument("--output-dir", default="gaia-gpx")
    args = parser.parse_args(argv)

    garmin_tokens = os.environ.get("GARMIN_TOKENS")
    if not garmin_tokens:
        raise SystemExit("Missing GARMIN_TOKENS environment variable")
    session_id = os.environ.get("GAIA_SESSION_ID")
    folder_id = os.environ.get("GAIA_FOLDER_ID")
    if not session_id:
        raise SystemExit("Missing GAIA_SESSION_ID environment variable")
    if not folder_id:
        raise SystemExit("Missing GAIA_FOLDER_ID environment variable")
    try:
        delay = float(os.environ.get("GAIA_REQUEST_DELAY_SECONDS", "2"))
    except ValueError as error:
        raise SystemExit("GAIA_REQUEST_DELAY_SECONDS must be numeric") from error
    if delay < 0:
        raise SystemExit("GAIA_REQUEST_DELAY_SECONDS must not be negative")
    gaia = GaiaClient(session_id, delay)
    gaia.verify_auth()

    print("Loading Garmin tokens...")
    garmin = login_from_tokens(garmin_tokens)
    summary, failures = run(
        garmin,
        Path(args.output_dir),
        gaia=gaia,
        folder_id=folder_id,
        backfill=args.backfill,
    )
    print("Garmin-to-Gaia summary:")
    if not summary:
        print("  No eligible hiking or mountaineering activities found.")
    for activity_id, result in summary:
        print(f"  {activity_id}: {result}")
    if failures:
        raise SystemExit(f"{failures} eligible activities failed")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - concise top-level CI error
        print(f"Garmin-to-Gaia sync failed: {error}", file=sys.stderr)
        sys.exit(1)
