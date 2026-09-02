# Feature: Firestore vs Google Sheets read benchmark

> Measure how long the application's load-time reads take against the migrated
> Firestore data compared with the current Google Sheets backend.

## What

Add a manually dispatched GitHub Action that replicates the reads the app
performs when it loads — exercises, workouts, workout log, day flags, workout
schedule, cardio, Garmin activities, Garmin wellness, Withings, and settings —
against both backends and prints their response times side by side.

The benchmark reads only. It does not change the application, the sheet, or
the migrated Firestore documents.

## Acceptance Criteria

- [x] A `workflow_dispatch` workflow runs the comparison on demand.
- [x] Every dataset the migration writes is read from both backends using the
      same ranges/collections the app and migration use.
- [x] Firestore collection reads follow pagination so large collections are
      fully retrieved.
- [x] The number of timed iterations is configurable and clamped to 1-20.
- [x] A subset of datasets can be selected; unknown names fail fast.
- [x] Output is a markdown table with per-dataset median times, the Sheets/
      Firestore speedup ratio, and the row/document counts retrieved.
- [x] A "full load" row totals every dataset for each backend, approximating a
      cold application start.
- [x] A failed read for one dataset is reported in the table without aborting
      the run.
- [x] The report is written to the GitHub Actions step summary as well as the
      log.
- [x] Mapping, timing, and rendering logic has offline tests run by the
      workflow before the benchmark.

## Out of Scope

- Changing the application to read from Firestore.
- Writing to Firestore or Google Sheets.
- Benchmarking write latency, client-side parsing, or browser SDK behavior.
- Cost analysis of either backend.

## Design Notes

- The script reuses `getAccessToken`, `parseServiceAccount`, and `required`
  from `scripts/firebase-migrate.mjs` so both jobs authenticate identically and
  the dataset definitions stay next to the migration that produced them.
- Both backends are read through their REST APIs with service-account tokens,
  which keeps the comparison symmetric. Token acquisition happens once, before
  timing, so it is excluded from the measurements.
- Sheets and Firestore reads for a dataset run back to back inside an
  iteration, so transient network conditions affect both backends similarly.
- Medians (plus min/max samples) are reported rather than means to reduce the
  effect of a single slow request.
- Firestore paginates at 300 documents per page; the timing covers all pages
  required to read the collection.
