# Feature: Direct Firestore health synchronization

> Make Firestore the only persistence target for scheduled health-data
> workflows after the Firebase application backend is enabled.

## What

Replace the Google Sheets write-and-mirror pipeline used by Garmin activities,
Garmin wellness, and Withings with direct writes to the Firestore schema used
by the migration action and Firebase UI.

The one-time migration and comparison benchmark continue to read the legacy
spreadsheet. They are migration tools, not ongoing ingestion paths.

## Acceptance Criteria

- [ ] Garmin activities write directly to
      `/users/{uid}/garminActivities/{year}`.
- [ ] Garmin wellness writes directly to
      `/users/{uid}/garminWellness/{year}` and merges Garmin goal values into
      `/users/{uid}/settings/app`.
- [ ] Withings writes directly to
      `/users/{uid}/withingsMeasurements/{year}`.
- [ ] Every health bucket uses `{ period, count, entries, updatedAt }`, matching
      the migration and Firebase UI adapters.
- [ ] Incremental runs preserve entries outside the fetched window.
- [ ] Append-only runs skip existing source identifiers; overwrite runs replace
      matching source identifiers and retain all unrelated entries.
- [ ] Bucket updates use optimistic concurrency so overlapping writes retry
      instead of losing data.
- [ ] Withings refresh-token rotation is persisted immediately in an
      administrator-only `/syncState/{uid}` document before measurements are
      fetched.
- [ ] Transient Firestore failures are retried, and the Withings workflow
      retries the complete sync within the provider's old-token grace window.
- [ ] Scheduled health workflows require `FIREBASE_SERVICE_ACCOUNT_KEY` and
      `FIREBASE_USER_ID`, not Sheets credentials.
- [ ] The obsolete Google Sheet backup workflow is removed.
- [ ] The manual migration and benchmark workflows retain their Sheets
      credentials because they intentionally read the legacy source.
- [ ] Pure schema, bucketing, merge, and mapping behavior has offline tests.

## Schema Decisions

- Health histories remain yearly rather than monthly. This matches spec 049,
  spec 050, `lib/firebase-load-plan.json`, and the UI's current-year cold-load
  behavior.
- Garmin activity documents store the shared activity model consumed by the UI,
  not every field from the former Garmin sheet row. The source activity ID is
  retained as `stravaId` for compatibility with the existing shared model.
- Garmin wellness entries retain all 40 migrated fields. Numeric blanks become
  `null`; status blanks remain empty strings.
- Withings entries retain `grpId` as the deduplication key and use `null` for
  unavailable optional metrics.
- `/syncState/{uid}` is outside `/users/{uid}` so browser security rules deny
  access to rotating provider credentials while administrative workflows can
  still maintain them through IAM.
