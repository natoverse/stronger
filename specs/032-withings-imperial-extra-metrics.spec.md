# Feature: Withings Imperial Units + Extra Metrics

> Follow-up to [031-withings-sync](031-withings-sync.spec.md). Display body-composition data in imperial units (pounds), add fat-free mass and resting heart rate to the sync, and provide a one-time backfill of history to 2021.

## What

Three refinements after the initial Withings sync landed (#201):

1. **Imperial display.** The Withings API returns only metric (kg); it has no unit parameter. The sheet stays canonical in kg (matching the API, one source of truth), and the app converts masses to pounds at display time — mirroring how the Strava tab stores meters/seconds and shows miles/hours. The user never sees kg. Body fat (%) and heart rate (bpm) are not masses and pass through unchanged.

2. **Two more metrics.** Fat-free/lean mass (meastype 5) and resting heart rate (meastype 11) are cheap additions to the existing `getmeas` call — no new endpoint. They're appended as two new trailing columns so existing synced rows stay column-aligned.

3. **History backfill.** The daily sync uses a rolling 60-day window, which never reaches old data. A `--backfill` flag drops the window and fetches everything since 2021-01-01 (matching the earliest year in the app's year picker) for a one-time import. Dedup by group ID keeps it safe to re-run.

## Acceptance Criteria

- [ ] All mass metrics (weight, fat mass, fat-free mass, muscle mass, bone mass, hydration) display in pounds; body fat in %, heart rate in bpm
- [ ] The sheet continues to store kilograms; conversion happens only in the view layer
- [ ] Per-metric targets are entered and stored in display units (lb), consistent with Strava goals
- [ ] `fatFreeMass` and `heartRate` are synced from the Withings API and stored in two new trailing sheet columns (A:J)
- [ ] The parser tolerates old 8-column rows (new fields parse as null) as well as new 10-column rows
- [ ] `node scripts/withings-sync.mjs --backfill` fetches measurements since 2021-01-01; the default run keeps the 60-day window
- [ ] The Body Composition view lists the two new metrics when data is present

## Scope

### In scope
- kg→lb display conversion (`toDisplayUnit` / `fromDisplayUnit`) for mass metrics
- Fat-free mass + resting heart rate: sync script, sheet header/parse/serialize, type, model metadata
- `--backfill` flag on the sync script
- Test and doc updates

### Out of scope
- A kg/lb toggle (user wants pounds only)
- Activity, sleep, blood-pressure, or SpO2 data (still separate endpoints, deferred)
- Migrating already-synced rows — the two new columns simply start populating on the next sync/backfill

## Notes

- **Conversion factor**: 1 kg = 2.2046226218 lb. Applied to weight, fatMass, fatFreeMass, muscleMass, boneMass, hydration.
- **Column order**: new fields appended (`…hydration, fatFreeMass, heartRate`) rather than inserted, so rows written by the initial release remain valid — the parser reads missing trailing cells as null.
- **Goal units**: goals are stored in the Settings tab in display units (lb), matching the existing Strava goal convention, so no conversion is needed on read/write — only the sheet measurement data is metric.
- **Backfill start**: `Date.UTC(2021, 0, 1)`. Extendable later by lowering that constant.

## Iteration notes

- Added two app-level settings in the Settings sheet to make dip filtering configurable instead of hard-coded:
  - `app.withingsDipThresholdPercent` (default `5`)
  - `app.progressDipThresholdPercent` (default `10`)
- Values are interpreted as percentages (not fractions) and validated to be in `(0, 100]`; invalid values fall back to defaults.
- The thresholds are consumed by the existing "Skip Dips" toggles in Withings and Progress views.
