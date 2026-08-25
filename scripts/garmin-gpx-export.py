#!/usr/bin/env python3
"""Export Garmin hiking and mountaineering GPX files to a ZIP archive."""

from __future__ import annotations

import argparse
import importlib.util
import os
import shutil
import sys
from pathlib import Path


def _load_gaia_sync():
    """Load the Garmin-to-Gaia script so export behavior stays identical."""
    path = Path(__file__).with_name("garmin-gaia-sync.py")
    spec = importlib.util.spec_from_file_location("garmin_gaia_sync", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load shared Garmin GPX logic from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


gaia_sync = _load_gaia_sync()


def summary_entry(activity_id, title, gpx_name, result):
    """Return a stable per-activity export summary."""
    return {
        "activity_id": activity_id,
        "title": title,
        "gpx_name": gpx_name,
        "result": result,
    }


def export_activities(garmin, output_dir, today=None):
    """Export all eligible Garmin activities since the Gaia backfill boundary."""
    output_dir.mkdir(parents=True, exist_ok=True)
    start_date, end_date = gaia_sync.activity_date_range(backfill=True, today=today)
    activities = garmin.get_activities_by_date(start_date, end_date) or []
    summary = []
    failures = 0

    for activity in activities:
        if not gaia_sync.eligible_activity(activity):
            continue
        activity_id = str(activity.get("activityId") or "")
        try:
            title = gaia_sync.activity_title(activity)
            title_error = None
        except ValueError as error:
            title = "(unnamed)"
            title_error = error
        gpx_name = (
            f"garmin-{activity_id}.gpx" if activity_id.isdigit() else "(not written)"
        )
        if not activity_id.isdigit():
            failures += 1
            summary.append(
                summary_entry(
                    "unknown",
                    title,
                    gpx_name,
                    "failed: invalid Garmin activity ID",
                )
            )
            continue
        if title_error:
            failures += 1
            summary.append(
                summary_entry(
                    activity_id,
                    title,
                    gpx_name,
                    f"failed: {title_error}",
                )
            )
            continue
        try:
            raw_gpx = garmin.download_activity(
                activity_id, garmin.ActivityDownloadFormat.GPX
            )
            prepared = gaia_sync.prepare_gpx(raw_gpx, title)
            if prepared is None:
                summary.append(
                    summary_entry(
                        activity_id,
                        title,
                        gpx_name,
                        "skipped: no valid track coordinates",
                    )
                )
                continue
            (output_dir / gpx_name).write_bytes(prepared)
            summary.append(summary_entry(activity_id, title, gpx_name, "exported"))
        except Exception as error:  # noqa: BLE001 - report each activity and continue
            failures += 1
            summary.append(
                summary_entry(activity_id, title, gpx_name, f"failed: {error}")
            )

    return summary, failures


def create_archive(output_dir, archive_path):
    """Create a ZIP containing the exported GPX files."""
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    created = shutil.make_archive(
        str(archive_path.with_suffix("")),
        "zip",
        root_dir=output_dir,
    )
    return Path(created)


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="garmin-gpx")
    parser.add_argument("--archive", default="garmin-gpx-export.zip")
    args = parser.parse_args(argv)

    garmin_tokens = os.environ.get("GARMIN_TOKENS")
    if not garmin_tokens:
        raise SystemExit("Missing GARMIN_TOKENS environment variable")

    print("Loading Garmin tokens...")
    garmin = gaia_sync.login_from_tokens(garmin_tokens)
    output_dir = Path(args.output_dir)
    summary, failures = export_activities(garmin, output_dir)
    archive = create_archive(output_dir, Path(args.archive))

    print("Garmin GPX export summary:")
    if not summary:
        print("  No eligible hiking or mountaineering activities found.")
    for entry in summary:
        print(
            "  "
            f"{entry['activity_id']} "
            f"({entry['title']} / {entry['gpx_name']}): "
            f"{entry['result']}"
        )
    print(f"Created {archive} with {len(list(output_dir.glob('*.gpx')))} GPX files.")
    if failures:
        raise SystemExit(f"{failures} eligible activities failed")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - concise top-level CI error
        print(f"Garmin GPX export failed: {error}", file=sys.stderr)
        sys.exit(1)

