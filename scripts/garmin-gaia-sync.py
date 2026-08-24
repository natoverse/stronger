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
import random
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ELIGIBLE_TYPES = frozenset({"hiking", "mountaineering"})
ROLLING_DAYS = 30
BACKFILL_START_DATE = "2015-01-01"
MAX_GPX_BYTES = 25 * 1024 * 1024
GAIA_BASE_URL = "https://www.gaiagps.com"
MOVING_SPEED_THRESHOLD = 0.25
GAIA_WRITE_ATTEMPTS = 3
GAIA_RETRY_DELAY_SECONDS = 30.0


class GaiaWriteRejected(RuntimeError):
    """Raised after Gaia repeatedly rejects a write request."""


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
    """Return the durable marker stored in imported track metadata."""
    return f"[Garmin activity:{activity_id}]"


def activity_title(activity):
    """Return the Garmin activity name used for the GPX and Gaia track."""
    name = str(activity.get("activityName") or "").strip()
    if not name:
        raise ValueError("missing Garmin activity name")
    return name


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


def _child_text(element, local_name):
    child = next(
        (
            item
            for item in element
            if item.tag.endswith(f"}}{local_name}") or item.tag == local_name
        ),
        None,
    )
    return child.text if child is not None else None


def _parse_time(value):
    if not value:
        raise ValueError("GPX track point is missing a timestamp")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _iso_utc(value):
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _distance(first, second):
    radius = 6_371_000
    lat1, lat2 = math.radians(first["lat"]), math.radians(second["lat"])
    delta_lat = lat2 - lat1
    delta_lon = math.radians(second["lon"] - first["lon"])
    haversine = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    )
    horizontal = radius * 2 * math.atan2(
        math.sqrt(haversine), math.sqrt(1 - haversine)
    )
    return math.hypot(horizontal, second["elevation"] - first["elevation"])


def gaia_track_payload(gpx_bytes, title, folder_id, activity_id):
    """Convert a prepared Garmin GPX track to Gaia's JSON track shape."""
    root = ET.fromstring(gpx_bytes)
    segments = [
        element
        for element in root.iter()
        if element.tag.endswith("}trkseg") or element.tag == "trkseg"
    ]
    points = []
    for segment in segments:
        for point in segment:
            if not (point.tag.endswith("}trkpt") or point.tag == "trkpt"):
                continue
            if not (
                _valid_coordinate(point.get("lat"), -90, 90)
                and _valid_coordinate(point.get("lon"), -180, 180)
            ):
                continue
            try:
                elevation = float(_child_text(point, "ele") or 0)
            except ValueError as error:
                raise ValueError("GPX track point has invalid elevation") from error
            if not math.isfinite(elevation):
                raise ValueError("GPX track point has invalid elevation")
            points.append(
                {
                    "lat": float(point.get("lat")),
                    "lon": float(point.get("lon")),
                    "elevation": elevation,
                    "time": _parse_time(_child_text(point, "time")),
                }
            )
    if len(points) < 2:
        raise ValueError("Gaia track creation requires at least two timed points")

    distances = []
    moving_time = 0.0
    max_speed = 0.0
    ascent = 0.0
    descent = 0.0
    for first, second in zip(points, points[1:]):
        distance = _distance(first, second)
        elapsed = (second["time"] - first["time"]).total_seconds()
        if elapsed < 0:
            raise ValueError("GPX track point timestamps are out of order")
        distances.append(distance)
        elevation_change = second["elevation"] - first["elevation"]
        ascent += max(elevation_change, 0)
        descent += max(-elevation_change, 0)
        if elapsed > 0:
            speed = distance / elapsed
            max_speed = max(max_speed, speed)
            if speed >= MOVING_SPEED_THRESHOLD:
                moving_time += elapsed

    total_distance = sum(distances)
    total_time = (points[-1]["time"] - points[0]["time"]).total_seconds()
    elevations = [point["elevation"] for point in points]
    latitudes = [point["lat"] for point in points]
    longitudes = [point["lon"] for point in points]
    coordinates = [
        [
            point["lon"],
            point["lat"],
            point["elevation"],
            int(point["time"].timestamp()),
        ]
        for point in points
    ]
    final = points[-1]
    stats = {
        "distance": total_distance,
        "total_time": total_time,
        "moving_time": moving_time,
        "stopped_time": max(total_time - moving_time, 0),
        "max_elevation": max(elevations),
        "min_elevation": min(elevations),
        "ascent": ascent,
        "descent": descent,
        "moving_speed": total_distance / moving_time if moving_time else 0,
        "average_speed": total_distance / total_time if total_time else 0,
        "max_speed": max_speed,
        "max_latitude": max(latitudes),
        "min_latitude": min(latitudes),
        "max_longitude": max(longitudes),
        "min_longitude": min(longitudes),
        "distance_markers_points": [],
        "distance_markers": [],
        "max_smooth_elevation": max(elevations),
        "min_smooth_elevation": min(elevations),
        "segment_count": len(segments),
        "point_count": len(points),
        "current_segment_start_date": int(points[0]["time"].timestamp()),
        "prior_segments_time": 0,
        "final_point": {
            "latitude": final["lat"],
            "longitude": final["lon"],
            "elevation": final["elevation"],
            "time": _iso_utc(final["time"]),
        },
    }
    return {
        "geometry": {"type": "LineString", "coordinates": coordinates},
        "name": title,
        "source": activity_marker(activity_id),
        "stats": stats,
        "imported": True,
        "hex_color": f"#{random.randrange(0x1000000):06X}",
        "create_date": _iso_utc(points[0]["time"]),
        "parent_folder_id": folder_id,
        "activity": None,
    }


class GaiaClient:
    """Minimal client for Gaia's unsupported private upload behavior."""

    def __init__(
        self,
        session_id,
        request_delay=2.0,
        session=None,
        write_attempts=GAIA_WRITE_ATTEMPTS,
        retry_delay=GAIA_RETRY_DELAY_SECONDS,
        sleep=time.sleep,
    ):
        if session is None:
            from curl_cffi import requests

            session = requests.Session(impersonate="chrome")
        self.session = session
        self.session.cookies.set(
            "sessionid", session_id, domain="www.gaiagps.com"
        )
        self.request_delay = request_delay
        self.write_attempts = write_attempts
        self.retry_delay = retry_delay
        self.sleep = sleep

    def _request(self, method, path, **kwargs):
        attempts = self.write_attempts if method in {"POST", "PUT", "DELETE"} else 1
        for attempt in range(1, attempts + 1):
            response = self.session.request(
                method, f"{GAIA_BASE_URL}{path}", **kwargs
            )
            write_rejected = (
                method in {"POST", "PUT", "DELETE"}
                and response.status_code in (403, 429)
            )
            if write_rejected and attempt < attempts:
                retry_after = response.headers.get("Retry-After")
                try:
                    delay = float(retry_after)
                except (TypeError, ValueError):
                    delay = self.retry_delay * (2 ** (attempt - 1))
                self.sleep(max(delay, 0))
                continue
            if write_rejected:
                raise GaiaWriteRejected(
                    f"Gaia rejected {method} {path} after {attempts} attempts; "
                    "the runner may be temporarily rate limited"
                )
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

    def create_track(self, gpx_bytes, title, folder_id, activity_id):
        self.sleep(self.request_delay)
        self._request("GET", "/map/")
        csrf_token = self.session.cookies.get("csrftoken")
        if not csrf_token:
            raise RuntimeError("Gaia map page did not provide a CSRF token")
        self._request(
            "POST",
            "/api/v3/tracks/",
            json=[gaia_track_payload(gpx_bytes, title, folder_id, activity_id)],
            headers={
                "Origin": GAIA_BASE_URL,
                "Referer": f"{GAIA_BASE_URL}/map/",
                "X-CSRFToken": csrf_token,
            },
        )

    def put_folder(self, folder):
        self.sleep(self.request_delay)
        self._request(
            "PUT", f"/api/objects/folder/{folder['id']}/", json=folder
        )
        return True

    def delete_folder(self, folder_id):
        self.sleep(self.request_delay)
        self._request("DELETE", f"/api/objects/folder/{folder_id}/")


def _one_by_id(objects, object_id, object_name):
    matches = [item for item in objects if str(item.get("id")) == str(object_id)]
    if len(matches) != 1:
        raise RuntimeError(
            f"Configured Gaia {object_name} ID matched {len(matches)} objects"
        )
    return matches[0]


def sync_gpx_to_gaia(
    client,
    gpx_bytes,
    title,
    folder_id,
    activity_id,
    allow_duplicates=False,
):
    """Upload or recover one activity and assign all its tracks to a folder."""
    folders = client.list_objects("folder")
    destination = _one_by_id(folders, folder_id, "folder")
    marker = activity_marker(activity_id)
    tracks = client.list_objects("track")
    matching_tracks = [
        track
        for track in tracks
        if any(
            marker in str(track.get(field) or "")
            for field in ("source", "title", "name")
        )
    ]
    matching_ids = [str(track["id"]) for track in matching_tracks]
    destination_ids = [str(track_id) for track_id in destination.get("tracks", [])]

    if allow_duplicates:
        existing_ids = set(matching_ids)
        client.create_track(gpx_bytes, title, folder_id, activity_id)
        tracks = client.list_objects("track")
        new_matching_ids = [
            str(track["id"])
            for track in tracks
            if str(track["id"]) not in existing_ids
            and any(
                marker in str(track.get(field) or "")
                for field in ("source", "title", "name")
            )
        ]
        if not new_matching_ids:
            raise RuntimeError("Gaia import produced no new tracks")
        refreshed = _one_by_id(client.list_objects("folder"), folder_id, "folder")
        refreshed_ids = [str(track_id) for track_id in refreshed.get("tracks", [])]
        if any(track_id not in refreshed_ids for track_id in new_matching_ids):
            raise RuntimeError("Gaia did not retain destination folder assignment")
        return "uploaded"

    if matching_ids and all(track_id in destination_ids for track_id in matching_ids):
        return "duplicate"

    if not matching_ids:
        client.create_track(gpx_bytes, title, folder_id, activity_id)
        tracks = client.list_objects("track")
        matching_ids = [
            str(track["id"])
            for track in tracks
            if any(
                marker in str(track.get(field) or "")
                for field in ("source", "title", "name")
            )
        ]
        if not matching_ids:
            raise RuntimeError("Gaia import produced no tracks")
        refreshed = _one_by_id(client.list_objects("folder"), folder_id, "folder")
        refreshed_ids = [str(track_id) for track_id in refreshed.get("tracks", [])]
        if any(track_id not in refreshed_ids for track_id in matching_ids):
            raise RuntimeError("Gaia did not retain destination folder assignment")
        return "uploaded"

    destination["tracks"] = list(
        dict.fromkeys([*destination.get("tracks", []), *matching_ids])
    )
    if not client.put_folder(destination):
        raise RuntimeError("Gaia rejected destination folder assignment")

    refreshed = _one_by_id(client.list_objects("folder"), folder_id, "folder")
    refreshed_ids = [str(track_id) for track_id in refreshed.get("tracks", [])]
    if any(track_id not in refreshed_ids for track_id in matching_ids):
        raise RuntimeError("Gaia did not retain destination folder assignment")

    return "recovered"


def activity_date_range(backfill=False, today=None):
    """Return Garmin's inclusive start and exclusive end date bounds."""
    today = today or date.today()
    start_date = (
        BACKFILL_START_DATE
        if backfill
        else (today - timedelta(days=ROLLING_DAYS - 1)).isoformat()
    )
    return start_date, (today + timedelta(days=1)).isoformat()


def run(
    garmin,
    output_dir,
    gaia,
    folder_id,
    backfill=False,
    today=None,
    allow_duplicates=False,
):
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
            result = sync_gpx_to_gaia(
                gaia,
                prepared,
                activity_title(activity),
                folder_id,
                activity_id,
                allow_duplicates=allow_duplicates,
            )
            summary.append((activity_id, result))
        except GaiaWriteRejected as error:
            failures += 1
            summary.append((activity_id, f"failed: {error}"))
            break
        except Exception as error:  # noqa: BLE001 - report each activity and continue
            failures += 1
            summary.append((activity_id, f"failed: {error}"))

    return summary, failures


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--backfill", action="store_true")
    parser.add_argument("--allow-duplicates", action="store_true")
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
        allow_duplicates=args.allow_duplicates,
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
