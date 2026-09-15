# Feature: Direct Firestore health synchronization

> Make Firestore the only persistence target for scheduled health-data
> workflows after the Firebase application backend is enabled.

## What

Garmin activities, Garmin wellness, and Withings write directly to the
Firestore schema consumed by the Firebase UI. Firestore is the sole
persistence target; no intermediary datastore, mirror, or alternate backend
is required.

## Acceptance Criteria

- [ ] Garmin activities write directly to
      `/users/{uid}/garminActivities/{year}`.
- [ ] Garmin wellness writes directly to
      `/users/{uid}/garminWellness/{year}` and merges Garmin goal values into
      `/users/{uid}/settings/app`.
- [ ] Withings writes directly to
      `/users/{uid}/withingsMeasurements/{year}`.
- [ ] Every health bucket uses `{ period, count, entries, updatedAt }`, matching
      the Firebase UI adapters.
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
      `FIREBASE_USER_ID` for persistence.
- [ ] Obsolete datastore backup, import, and cross-backend benchmark tooling is
      removed.
- [ ] Pure schema, bucketing, merge, and mapping behavior has offline tests.

## Schema Decisions

- Health histories remain yearly rather than monthly. This matches spec 050,
  `lib/firebase-load-plan.json`, and the UI's current-year cold-load
  behavior.
- Garmin activity documents store the shared activity model consumed by the UI,
  not every metric exposed by the provider. The source activity ID is
  retained as `stravaId` for compatibility with the existing shared model.
- Garmin wellness entries retain all 40 domain fields. Numeric blanks become
  `null`; status blanks remain empty strings.
- Withings entries retain `grpId` as the deduplication key and use `null` for
  unavailable optional metrics.
- `/syncState/{uid}` is outside `/users/{uid}` so browser security rules deny
  access to rotating provider credentials while administrative workflows can
  still maintain them through IAM.

## Iteration Decisions

- On 2026-09-05, Withings OAuth token requests were updated to the provider's
  signed-request protocol. Both authorization-code exchanges and scheduled
  refreshes now request a one-time nonce and sign the request with HMAC-SHA256;
  the client secret is no longer transmitted as a form parameter.
- A local `scripts/withings-authorize.mjs` helper owns the short-lived
  authorization-code exchange so setup documentation does not require users to
  manually construct signatures.
- Reconnection documentation distinguishes a stale repository seed from the
  live rotating token in Firestore `syncState`. Reauthorization is an explicit
  provider-recovery action, not part of normal scheduled refresh.
- On 2026-09-15, the Garmin activity sync failed for every record with
  `Invalid entry date: None`: activity entries carry `timestamp` (an ISO
  date-time), but the shared Python year-bucket writer read `date`. Year
  bucketing and sorting now take an explicit `date_field` argument instead of
  guessing between the two field names — activities pass `timestamp`, wellness
  passes `date`. Activity documents use `timestamp` only; pre-existing
  `date`-keyed activity entries are re-indexed rather than read through a
  compatibility fallback.
- The Garmin sync also prints each invalid provider record (index, reasons, and
  a truncated payload preview), skips it, and reports a
  fetched/valid/skipped/added/updated/status summary to stdout,
  `GITHUB_STEP_SUMMARY`, and `GITHUB_OUTPUT`. The workflow's final `if: always()`
  step echoes those step outputs so the totals survive a failing sync step.
- **Firestore-only cleanup (2026-09-15):** Remove positional row schemas,
  intermediary storage adapters, and retired administrative workflows. Provider
  responses map directly to named Firestore fields; yearly bucket structure,
  optimistic concurrency, incremental preservation, signed Withings requests,
  immediate token persistence, and all overwrite/backfill controls remain
  unchanged.
- Node service-account authentication and Firestore value serialization live
  in `scripts/firestore-admin.mjs`, independent of retired import tooling, with
  offline authentication and serialization tests. The shared load plan retains
  runtime metadata only, without comparison-specific route or label metadata.
- Garmin activities use `activity_to_entry`; wellness uses `build_entry` and
  `wellness_to_entry`. These helpers map provider data directly to named
  Firestore fields without intermediate positional records.
- On 2026-09-15, the Withings workflow display name was shortened to
  `Withings Sync`; the Firestore destination remains an implementation detail.
