# Feature: Overwrite (upsert) mode for the Garmin & Withings syncs

## What

The Garmin activity sync, Garmin wellness sync, and Withings sync currently run
in append-only mode: they read the existing keys already in the sheet
(`activityId` / date / `grpId`) and skip anything that matches, only appending
genuinely new rows. That has two problems:

1. **Partial mid-day rows are never fixed.** If a sync runs mid-day (e.g. a
   manual test) it can write incomplete data for today. The nightly cron then
   sees the day already present and skips it, so it stays partial forever.
2. **Edits to old records are never picked up.** Editing an older Garmin
   activity (or a Withings weigh-in) leaves the sheet stale — the only way to
   refresh it was to delete the whole tab and re-run a full backfill.

This adds an **overwrite (upsert)** mode: instead of skipping rows whose key
already exists, the sync updates those rows in place and appends the rest. Now
the syncs can run as often as we like and always reflect the latest full data.

## Decisions

- **New `--overwrite` flag** on all three scripts. When set, fetched rows whose
  key already exists in the sheet are rewritten in place (via the Sheets
  `values:batchUpdate` endpoint); rows with a new key are appended as before.
  Row order/position is preserved — updates target the existing row number.
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
  wellness sync only fetches dates missing from the sheet; in overwrite mode it
  fetches every date in the window (rolling or backfill) so existing days are
  refreshed from Garmin.
- **Keys unchanged.** Dedup/merge keys stay the same: Garmin activities by
  `activityId` (col B), wellness by `date` (col A), Withings by `grpId` (col B).
  The first row matching a key wins if the sheet already contains duplicates.

## Notes

- The upsert split is factored into a small pure helper (`partition_rows` in the
  Python scripts, `partitionRows` in the Withings script) that takes the fetched
  rows plus an existing `key → rowNumber` map and returns `(updates, appends)`.
  These are covered by the offline test harnesses.
- `values:batchUpdate` sends one range per updated row (`A{n}:{col}{n}`), so a
  single request refreshes the whole window.
