# Feature: Firestore vs Google Sheets read benchmark

> Measure how long the application's load-time reads take against the migrated
> Firestore data compared with the current Google Sheets backend.

## What

Add a manually dispatched GitHub Action that uses the application's shared
`lib/firebase-load-plan.json` to replicate each benchmark route/tab's cold-load
reads against both backends and print their response times side by side.

The benchmark reads only. It does not change the application, the sheet, or
the migrated Firestore documents.

## Acceptance Criteria

- [x] A `workflow_dispatch` workflow runs the comparison on demand.
- [x] Every dataset required by a selected benchmark route is read from both
      backends using the same ranges/collections the app uses.
- [x] Firestore collection reads follow pagination so large collections are
      fully retrieved.
- [x] The number of timed iterations is configurable and clamped to 1-20.
- [x] A subset of benchmark routes/tabs can be selected; unknown names fail
      fast.
- [x] Each selected tab uses exactly the ordered dataset list in the shared
      load plan.
- [x] Firestore cold loads fetch only the current-year document for yearly
      bucket datasets; older years are excluded from cold-load timing.
- [x] Firestore cold loads fetch only the next 60 calendar days for schedule
      and day-flag documents.
- [x] All Sheets reads required by a tab run concurrently in one timed
      `Promise.all` batch, followed by a separately timed concurrent Firestore
      batch containing the identical logical datasets.
- [x] Output is a markdown table with per-dataset median times, the Sheets/
      Firestore speedup ratio, logical record counts, and physical Firestore
      document counts.
- [x] Output includes one comparison row per selected tab with Sheets cold
      load, Firestore cold load, Sheets records, and Firestore documents
      columns; per-dataset detail is retained for diagnosis.
- [x] Dataset metadata identifies ranges that include a header row, and Sheets
      logical record counts exclude those headers.
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
- A tab's required Sheets ranges are read concurrently and timed as one batch.
  The same datasets' Firestore collections are then read concurrently and
  timed as a separate batch. This matches the Firebase UI's priority-load
  semantics while keeping the compared logical workload identical.
- Medians (plus min/max samples) are reported rather than means to reduce the
  effect of a single slow request.
- Firestore paginates at 300 documents per page; the timing covers all pages
  required to read the collection.
- The benchmark understands aggregate documents. It expands
  `entries` for yearly workout, Garmin, Garmin wellness, and Withings buckets,
  and `events` for daily schedule documents. Reports show logical records and
  physical documents separately so reduced round trips remain visible without
  making record counts misleading.
- The shared plan identifies yearly bucket datasets. Their Firestore cold-load
  measurement targets only the current calendar-year document, matching the
  staged UI load; the Sheets baseline retains its existing full-range read.
- The shared plan also identifies date-window datasets and defines a 60-day
  initial window anchored to the first of the current month, with 30-day
  increments. The benchmark times only that initial schedule/day-flag window.
- Route names, labels, dataset ordering, and default benchmark tabs come
  directly from `lib/firebase-load-plan.json`; the benchmark does not maintain
  a second route map.

## Iteration decisions — September 2, 2026

- Benchmark selection changed from individual datasets to user-visible
  routes/tabs because perceived cold-load latency is determined by the slowest
  concurrent request in a route batch, not the sum of serial dataset reads.
- Added `mealItems`, `mealLog`, `favoriteFoods`, and `recentFoods` definitions
  so the Nutrition route can execute the exact shared plan.
- Kept a secondary per-dataset report for diagnosing a slow or missing source,
  while making the per-tab Sheets and Firestore rows the primary output.
- Sheets ranges beginning at row 1 now declare `headerRows: 1`. Reports subtract
  that metadata from returned value rows, including the header-only case, so
  both backend count columns describe logical data records.
- Nutrition is excluded from `benchmarkRoutes` while its Firebase rollout is
  deferred. Its route definition remains in the shared plan for the UI, but the
  benchmark action cannot select or request it.
- The per-tab summary uses one row per tab rather than separate backend rows,
  making direct latency and request-shape comparisons easier to scan.
- Yearly workout, Garmin activity, Garmin wellness, and Withings collections
  now benchmark only the current-year document during cold start. The report
  calls out that Sheets still reads its full range, so record-count differences
  are intentional rather than a schema mismatch.
- Schedule and day flags now use a server-side document-ID range query covering
  today plus the following 59 days. This matches the UI's initial 60-day
  calendar window instead of measuring full-collection reads.
