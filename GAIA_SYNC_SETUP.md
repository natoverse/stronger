# Garmin to Gaia Sync Setup

Stronger can export recent Garmin hiking and mountaineering tracks as GPX after
the Garmin activity sync succeeds. Gaia officially supports manual GPX import,
but it does not publish a write API or OAuth flow.

> **Important:** Automated upload uses unsupported private Gaia web behavior.
> Keep uploads disabled until a manual live-account check confirms that upload,
> folder placement, and a duplicate-free second run all work. Gaia can change
> this behavior or expire the browser session without notice.

## Safe default: GPX artifacts

1. In **Settings → Secrets and variables → Actions → Variables**, set
   `GAIA_SYNC_ENABLED` to `true`.
2. Optionally set `GAIA_SYNC_UTC_HOUR` to the desired UTC hour (`3` by default).
3. Run **Garmin Sync** manually with **gaia_sync** checked, or wait for that UTC
   hour.
4. Download the one-day `gaia-gpx` workflow artifact and import its files at
   [gaiagps.com](https://www.gaiagps.com/).

Only exact Garmin type keys `hiking` and `mountaineering` are exported. GPX
files without a valid track-point latitude and longitude are skipped.

## Live upload spike

Only proceed if you accept the risk of using Gaia's unsupported private API.
The workflow does not automate login, MFA, CAPTCHA, or cookie extraction.

1. Create or choose an existing Gaia folder. Copy its immutable ID from its
   Gaia URL and set the Actions variable `GAIA_FOLDER_ID`.
2. Sign in to Gaia in your browser, inspect the `gaiagps.com` cookies, and copy
   the `sessionid` value into the Actions secret `GAIA_SESSION_ID`. Never store
   it as a variable, file, log, or artifact.
3. Leave `GAIA_LIVE_VERIFIED` unset. Run the script manually with `--upload`
   from a trusted machine, or temporarily set `GAIA_LIVE_VERIFIED=true` and
   manually dispatch the workflow with **gaia_sync** checked.
4. Confirm one track appears in the configured folder with
   `[Garmin activity:<id>]` in its title.
5. Run it again and confirm Gaia contains no duplicate.
6. Only after both checks pass, keep the Actions variable
   `GAIA_LIVE_VERIFIED=true` to allow the nightly job to write to Gaia.

The configured folder must already exist and match exactly one folder ID. The
sync never creates or guesses a destination folder. It checks the Garmin ID
marker globally before uploading, so a track left outside the destination by a
partial failure can be recovered without another upload.

## Recovery

| Failure | Action |
|---------|--------|
| Gaia session expired or rejected | Copy a fresh browser `sessionid` into the `GAIA_SESSION_ID` secret. |
| Missing or ambiguous folder | Correct `GAIA_FOLDER_ID`; the sync does not upload before validating it. |
| Gaia rate limit or rejected upload | Wait and rerun. Successful earlier tracks remain in Gaia. |
| Marker or folder verification failed | Set `GAIA_LIVE_VERIFIED=false`, use the GPX artifact, and investigate before re-enabling writes. |
| Garmin GPX is malformed or empty | Retry later; the per-activity summary exits non-zero without uploading that file. |

The sync examines at most 30 recent activities by default. `GAIA_ACTIVITY_LIMIT`
can change this to a value from 1 through 100. `GAIA_REQUEST_DELAY_SECONDS`
controls pacing between Gaia writes and defaults to two seconds.
