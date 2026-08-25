# Feature: Garmin GPX Export Artifact

> Download every Garmin hiking and mountaineering GPX activity since 2015-01-01 as one GitHub Actions artifact.

## What

A manually dispatched workflow authenticates with the existing `GARMIN_TOKENS`
secret, applies the same activity filtering, date bounds, GPX validation, and
track naming used by the Garmin-to-Gaia sync, and writes valid GPX files locally.
It then packages the files into a ZIP archive and uploads that archive as a
workflow artifact. It never authenticates with or writes to Gaia.

## Acceptance Criteria

- [ ] The workflow can be started manually from GitHub Actions.
- [ ] The export always queries Garmin from 2015-01-01 through the day after the
      run date, matching the Gaia backfill date behavior.
- [ ] Only exact `hiking` and `mountaineering` activity type keys are exported.
- [ ] GPX downloads use the Gaia sync's validation and track-name preparation.
- [ ] Each valid activity is saved as `garmin-<activityId>.gpx`.
- [ ] Invalid IDs, missing titles, malformed exports, and exports without valid
      coordinates are reported without discarding successful downloads.
- [ ] All valid files are packaged into `garmin-gpx-export.zip` and uploaded as
      a downloadable Actions artifact.
- [ ] The export requires only `GARMIN_TOKENS` and makes no Gaia requests.
- [ ] Offline tests cover full-history bounds, filtering, ZIP contents, skipped
      tracks, and partial failures.

## Scope

### In scope

- A manual, full-history export for hiking and mountaineering activities.
- Reuse of the established Garmin-to-Gaia download preparation behavior.
- A single downloadable ZIP artifact.

### Out of scope

- Uploading, syncing, or deduplicating tracks in Gaia.
- Scheduled exports or exporting other Garmin activity types.
- Changes to the Stronger application or Google Sheets data.

