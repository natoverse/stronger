# Garmin to Gaia Sync Setup

Stronger can sync recent Garmin hiking and mountaineering tracks to Gaia in a
standalone GitHub Actions workflow. Gaia does not publish a write API or OAuth
flow, so this automation uses unsupported private Gaia web behavior.

> **Important:** Automated upload uses unsupported private Gaia web behavior.
> Gaia can change this behavior or expire the browser session without notice.
> The sync uses browser-impersonated requests because Gaia rejects ordinary
> Python HTTP clients from GitHub-hosted runners.

## Configuration

1. Create or choose an existing Gaia folder. Copy its immutable ID from its
   Gaia URL and set the Actions secret `GAIA_FOLDER_ID`.
2. Sign in to Gaia in your browser, inspect the `gaiagps.com` cookies, and copy
   the `sessionid` value into the Actions secret `GAIA_SESSION_ID`. Never store
   it as a variable, file, log, or artifact.
3. Open **Actions → Garmin to Gaia Sync**, enable the workflow, and run it
   manually to verify the configuration.

The workflow runs nightly at 03:00 UTC. To change the schedule, edit the cron
expression in `.github/workflows/garmin-gaia-sync.yml`. Disable or enable
scheduled runs from the workflow's Actions page.

The configured folder must already exist and match exactly one folder ID. The
sync never creates or guesses a destination folder. It checks the Garmin ID
marker globally before uploading, so a track left outside the destination by a
partial failure can be recovered without another upload.

Normal runs query the last 72 hours (today plus the prior three calendar days).
Only exact Garmin type keys `hiking` and `mountaineering` are eligible. GPX files
without a valid track-point latitude and longitude are skipped.

## Backfilling older tracks

After verifying normal manual runs, manually run **Garmin to Gaia Sync** with
**backfill** checked. This queries every Garmin activity since **2015-01-01**.
Existing activity markers prevent duplicate Gaia imports, so interrupted
backfills can be rerun safely.

## Recovery

| Failure | Action |
|---------|--------|
| Gaia session expired or rejected | Copy a fresh browser `sessionid` into the `GAIA_SESSION_ID` secret. The sync validates it against Gaia's protected folder API before contacting Garmin. |
| Missing or ambiguous folder | Correct `GAIA_FOLDER_ID`; the sync does not upload before validating it. |
| Gaia rate limit or rejected upload | Wait and rerun. Successful earlier tracks remain in Gaia. |
| Marker or folder verification failed | Correct the Gaia destination state, then rerun; the activity marker prevents another upload after a partial import. |
| Garmin GPX is malformed or empty | Retry later; the per-activity summary exits non-zero without uploading that file. |

`GAIA_REQUEST_DELAY_SECONDS` controls pacing between Gaia writes and defaults to
two seconds.
