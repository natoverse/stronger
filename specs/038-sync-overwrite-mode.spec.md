# Feature: Overwrite (upsert) mode for the Garmin & Withings syncs

## What

The Garmin activity sync, Garmin wellness sync, and Withings sync originally
ran in append-only mode: they checked stored identifiers and skipped anything
that matched, adding only genuinely new records. That had two problems:

1. **Partial mid-day rows are never fixed.** If a sync runs mid-day (e.g. a
   manual test) it can write incomplete data for today. The nightly cron then
   sees the day already present and skips it, so it stays partial forever.
2. **Edits to old records are never picked up.** Editing an older Garmin
   activity (or a Withings weigh-in) left stored history stale — refreshing it
   required discarding existing data and rerunning a full backfill.

This adds an **overwrite (upsert)** mode: instead of skipping entries whose key
already exists, the sync updates those entries and appends the rest. Now
the syncs can run as often as we like and always reflect the latest full data.

## Decisions

- **New `--overwrite` flag** on all three scripts. When set, fetched entries
  replace matching stored identifiers in Firestore yearly buckets; new IDs are
  added. Entries outside the fetched window remain intact.
- **`--backfill` implies `--overwrite`.** A full-history backfill now refreshes
  existing rows too, so "re-run full sync" is enough to pull in edits to old
  activities (previously backfill also skipped existing keys).
- **Scheduled (cron) runs overwrite the rolling window.** The nightly workflow
  runs pass `--overwrite`, so the recent-window rows (last 30 Garmin activities /
  14 wellness days / 60 Withings days) are always refreshed. This is what fixes
  the partial-mid-day-row case without any manual intervention.
- **`overwrite` workflow_dispatch input.** Manual runs can opt in explicitly
  (independent of `backfill`).
- **Wellness re-fetches the whole window in overwrite mode.** In append mode the
  wellness sync only fetches dates missing from stored history; in overwrite mode it
  fetches every date in the window (rolling or backfill) so existing days are
  refreshed from Garmin.
- **Stable source keys.** Garmin uses the provider `activityId` (retained as
  `stravaId` in the shared activity model), wellness uses `date`, and Withings
  uses `grpId`.

## Notes

- Pure bucket merge helpers match fetched entries to stored source identifiers.
  Offline tests cover append, overwrite, date ordering, and preservation of
  unrelated entries.
- Firestore bucket writes use optimistic concurrency and retry conflicts rather
  than replacing a concurrently updated snapshot.

## Post-merge iteration (2026-07)

- **`overwrite` workflow_dispatch input now defaults to `true`.** Since upsert is
  idempotent (keyed by `activityId` / `date` / `grpId`, so it can't create
  duplicates) and append-only manual runs can leave stale partial rows, manual
  runs of all three sync workflows now overwrite by default. Unchecking the box
  still allows a pure append. Scheduled runs already passed `--overwrite`
  unconditionally, so this only affects `workflow_dispatch` runs.

## Firestore-only iteration (2026-09-15)

- Upserts operate on named entries inside yearly buckets, not positional records. Activity bucketing uses `timestamp`; wellness and Withings use `date`. Existing append, overwrite, and backfill controls are unchanged.
