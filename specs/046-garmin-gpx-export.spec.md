# Feature: Garmin GPX Export Artifact

> Download every Garmin hiking and mountaineering GPX activity since 2015-01-01 as one GitHub Actions artifact.

## What

A manually dispatched workflow authenticates with the existing `GARMIN_TOKENS`
secret, applies the same activity filtering, date bounds, GPX validation, and
track naming used by the Garmin-to-Gaia sync, and writes valid GPX files locally.
It uploads the output directory so GitHub packages the GPX files directly into
one downloadable ZIP artifact. It never authenticates with or writes to Gaia.

## Acceptance Criteria

- [ ] The workflow can be started manually from GitHub Actions.
- [ ] The export always queries Garmin from 2015-01-01 through the day after the
      run date, matching the Gaia backfill date behavior.
- [ ] Only exact `hiking` and `mountaineering` activity type keys are exported.
- [ ] GPX downloads use the Gaia sync's validation and track-name preparation.
- [ ] Each valid activity is saved as `garmin-<activityId>.gpx`.
- [ ] Invalid IDs, missing titles, malformed exports, and exports without valid
      coordinates are reported without discarding successful downloads.
- [ ] All valid files are uploaded directly as the contents of the downloadable
      `garmin-gpx-export.zip` Actions artifact, without a nested ZIP.
- [ ] The export requires only `GARMIN_TOKENS` and makes no Gaia requests.
- [ ] Offline tests cover full-history bounds, filtering, GPX contents, skipped
      tracks, and partial failures.

## Scope

### In scope

- A manual, full-history export for hiking and mountaineering activities.
- Reuse of the established Garmin-to-Gaia download preparation behavior.
- A single downloadable ZIP artifact.

### Out of scope

- Uploading, syncing, or deduplicating tracks in Gaia.
- Scheduled exports or exporting other Garmin activity types.
- Changes to the Stronger application or Firestore data.

## Iteration decisions

- The export directory is uploaded directly to `actions/upload-artifact`.
  GitHub therefore creates the only ZIP layer, avoiding the nested archive that
  macOS Archive Utility could not recognize after automatic extraction.
- Prepared files preserve GPX's default XML namespace rather than serializing
  elements with an `ns0` prefix, because Gaia's file importer otherwise reports
  that the valid tracks contain no features.
- Parameterized export (2026-09-16): Manual dispatch exposes an `activity_types`
  string, default `hiking,mountaineering`, passed through the environment rather
  than interpolated into shell code. Both export and sync use the same
  `--activity-types` / `GARMIN_ACTIVITY_TYPES` parser and exact-key filter.
  For example, `cycling`, `mountain_biking`, or `cycling,mountain_biking` can be
  exported without any Gaia credentials or changes to the nightly schedules.
- Full-history export owns its 2015-01-01 start boundary and next-day exclusive
  end boundary. It no longer calls the sync's removed `backfill` argument;
  parameterizing export does not reintroduce historical Gaia synchronization.
- Empty-match summaries identify the selected types. The single-layer artifact
  name, GPX namespace, Garmin activity titles, and partial-failure behavior remain
  unchanged. Tests cover custom exports, CLI/environment forwarding, invalid
  configuration before authentication, and full-history date bounds.
