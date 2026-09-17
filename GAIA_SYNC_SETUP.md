# Garmin to Gaia Sync Setup

Stronger can sync recent Garmin tracks into separate Gaia folders by activity
type using GitHub Actions workflows. Gaia does not publish a write API or OAuth
flow, so this automation uses unsupported private Gaia web behavior.

> **Important:** Automated upload uses unsupported private Gaia web behavior.
> Gaia can change this behavior or expire the browser session without notice.
> The sync uses browser-impersonated requests because Gaia rejects ordinary
> Python HTTP clients from GitHub-hosted runners.

## Configuration

1. Create or choose an existing Gaia folder for each sync. Copy each immutable
   folder ID from its Gaia URL into the corresponding Actions secret below.
   Keep folder IDs in secrets, not workflow inputs or committed files.
2. Sign in to Gaia in your browser, inspect the `gaiagps.com` cookies, and copy
   the `sessionid` value into the Actions secret `GAIA_SESSION_ID`. Never store
   it as a variable, file, log, or artifact.
3. Reuse the existing `GARMIN_TOKENS` Actions secret for all workflows.
4. Open each workflow under **Actions** and use **Run workflow** to verify its
   configuration after setting its folder secret.

| Workflow | Exact Garmin type keys | Folder secret | Nightly (UTC) |
|----------|------------------------|---------------|---------------|
| Garmin to Gaia Sync | `hiking,mountaineering` | `GAIA_FOLDER_ID` | 03:00 |
| Garmin to Gaia Sync - Cycling | `cycling` | `GAIA_CYCLING_FOLDER_ID` | 04:00 |
| Garmin to Gaia Sync - Mountain Biking | `mountain_biking` | `GAIA_MOUNTAIN_BIKING_FOLDER_ID` | 05:00 |

The existing hiking configuration is unchanged. Set the two new folder secrets
before their first runs; a missing secret fails explicitly and never falls back
to the hiking folder. Disable any unconfigured workflow from its Actions page.
All three share `GAIA_SESSION_ID`.

To change a schedule, edit the cron expression in that caller's workflow file.
Disable or enable each schedule independently from its Actions page. The shared
job uses a repository-wide concurrency group to prevent overlapping Gaia writes;
it does not cancel a running sync. `queue: max` keeps additional configurations
pending instead of replacing an older pending run.

The configured folder must already exist and match exactly one folder ID. The
sync never creates or guesses a destination folder. Gaia track names use only
the Garmin activity name. The sync stores the Garmin ID marker in Gaia's source
metadata and checks it globally before uploading, so a track left outside the
destination by a partial failure can be recovered without another upload.
Legacy tracks with the marker in their name remain recognized.

The sync converts each Garmin GPX export to the same JSON track representation
used by Gaia's web map and creates it directly in the configured folder.

Every run queries the last 72 hours as four calendar days (today plus the prior
three days), matching the date-based lookback convention used by the Garmin
wellness sync.
Only the caller's exact Garmin type keys are eligible. For example, `cycling`
does not include `mountain_biking`, `indoor_cycling`, or other subtypes. GPX files
without a valid track-point latitude and longitude are skipped.

Scheduled and manual runs always check Garmin activity ID markers before upload,
so rerunning the sync does not duplicate a GPX in Gaia.

## Add another nightly configuration

Copy `.github/workflows/garmin-gaia-sync-cycling.yml`, give it a distinct workflow
name and schedule, and change these two settings in its `sync` job:

```yaml
with:
  activity_types: cycling,mountain_biking
secrets:
  GARMIN_TOKENS: ${{ secrets.GARMIN_TOKENS }}
  GAIA_SESSION_ID: ${{ secrets.GAIA_SESSION_ID }}
  GAIA_FOLDER_ID: ${{ secrets.GAIA_ANOTHER_FOLDER_ID }}
```

Create the named folder secret in repository **Settings → Secrets and variables
→ Actions**. The caller uses `garmin-gaia-sync-reusable.yml`, which owns dependency
installation and script execution; no script copy is needed. Pass secrets
explicitly rather than inheriting all repository credentials.

Activity selection is a comma-separated list of exact `activityType.typeKey`
values, not display labels. Whitespace is trimmed and duplicate keys collapse.
Blank entries, uppercase/display names, and wildcards fail before authentication.
Well-formed keys are not checked against a remote catalog; a typo can match no
activities, so inspect the selected types and per-activity summary in the run.

The scripts share `--activity-types` and its `GARMIN_ACTIVITY_TYPES` environment
default; an explicit argument takes precedence. Without either, they retain
`hiking,mountaineering`. The destination remains the `GAIA_FOLDER_ID` environment
parameter, supplied by the caller's chosen secret.

Prefer disjoint type lists and separate folders. If configurations intentionally
overlap, the existing global marker check reuses a track and assigns it to the
requested folder rather than uploading a second copy. Changing a configuration
does not migrate historical tracks: nightly sync remains recent-only.

For historical GPX downloads by activity type, use the independent
[Garmin GPX Export](GARMIN_GPX_EXPORT.md) workflow.

## Recovery

| Failure | Action |
|---------|--------|
| Gaia session expired or rejected | Copy a fresh browser `sessionid` into the `GAIA_SESSION_ID` secret. The sync validates it against Gaia's protected folder API before contacting Garmin. |
| Missing or ambiguous folder | Correct the folder secret for the failing workflow; the sync validates it before contacting Garmin and never selects another destination. |
| Invalid activity types | Use comma-separated exact type keys, with no empty entries or wildcards. |
| Gaia write rejected or rate limited | The sync retries rate-limited reads and writes. It honors numeric and HTTP-date `Retry-After` values; otherwise it waits 30 and 60 seconds. Failures report the status, safe rate-limit headers, and short response body, then stop the run to avoid extending an IP-based throttle. Rerun later; successful earlier tracks remain in Gaia. |
| Marker or folder verification failed | Correct the Gaia destination state, then rerun; the activity marker prevents another upload after a partial import. |
| Garmin GPX is malformed or empty | Retry later; the per-activity summary exits non-zero without uploading that file. |

`GAIA_REQUEST_DELAY_SECONDS` controls pacing between Gaia writes and defaults to
two seconds. If runs frequently receive 403 or 429 responses, try increasing the
delay to 5 or 10 seconds. Compare the reported `Retry-After`,
`RateLimit-Remaining`, and reset headers between runs before changing the default.
