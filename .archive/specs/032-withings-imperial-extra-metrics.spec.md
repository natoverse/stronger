# Feature: Withings Imperial Units + Extra Metrics

> Follow-up to [031-withings-sync](031-withings-sync.spec.md). Display body-composition data in imperial units (pounds), add fat-free mass and resting heart rate to the sync, and provide a one-time backfill of history to 2021.

## What

Three refinements after the initial Withings sync landed (#201):

1. **Imperial display.** The Withings API returns only metric (kg); it has no unit parameter. Firestore measurements stay canonical in kg (matching the API), and the app converts masses to pounds at display time — mirroring activity metrics stored in meters/seconds and shown in miles/hours. The user never sees kg. Body fat (%) and heart rate (bpm) pass through unchanged.

2. **Two more metrics.** Fat-free/lean mass (meastype 5) and resting heart rate (meastype 11) are cheap additions to the existing `getmeas` call — no new endpoint. They are optional named fields, so older records remain valid.

3. **History backfill.** The daily sync uses a rolling 60-day window, which never reaches old data. A `--backfill` flag drops the window and fetches everything since 2021-01-01 (matching the earliest year in the app's year picker) for a one-time import. Dedup by group ID keeps it safe to re-run.

## Acceptance Criteria

- [ ] All mass metrics (weight, fat mass, fat-free mass, muscle mass, bone mass, hydration) display in pounds; body fat in %, heart rate in bpm
- [ ] Firestore measurements continue to store kilograms; conversion happens only in the view layer
- [ ] Per-metric targets are entered and stored in display units (lb), consistent with Strava goals
- [ ] `fatFreeMass` and `heartRate` are synced from the Withings API and stored as optional fields
- [ ] The model tolerates older measurements without the new fields, defaulting them to `null`
- [ ] `node scripts/withings-sync.mjs --backfill` fetches measurements since 2021-01-01; the default run keeps the 60-day window
- [ ] The Body Composition view lists the two new metrics when data is present

## Scope

### In scope
- kg→lb display conversion (`toDisplayUnit` / `fromDisplayUnit`) for mass metrics
- Fat-free mass + resting heart rate: sync mapping, Firestore fields, type, model metadata
- `--backfill` flag on the sync script
- Test and doc updates

### Out of scope
- A kg/lb toggle (user wants pounds only)
- Activity, sleep, blood-pressure, or SpO2 data (still separate endpoints, deferred)
- Rewriting all existing records — new fields populate on subsequent sync/backfill

## Notes

- **Conversion factor**: 1 kg = 2.2046226218 lb. Applied to weight, fatMass, fatFreeMass, muscleMass, boneMass, hydration.
- **Backward compatibility**: missing `fatFreeMass` or `heartRate` fields default to `null`; field order is irrelevant.
- **Goal units**: goals are stored in Firestore settings in display units (lb), matching the activity goal convention, so no conversion is needed on read/write — only measurement data is metric.
- **Backfill start**: `Date.UTC(2021, 0, 1)`. Extendable later by lowering that constant.

## Iteration notes

- Added two app-level settings to make dip filtering configurable instead of hard-coded:
  - `app.withingsDipThresholdPercent` (default `5`)
  - `app.progressDipThresholdPercent` (default `10`)
- Values are interpreted as percentages (not fractions) and validated to be in `(0, 100]`; invalid values fall back to defaults.
- The thresholds are consumed by the existing "Skip Dips" toggles in Withings and Progress views.

- Hardened body-composition chart rendering for predictable output across time-range / aggregation selections:
  - **Chronological, year-qualified buckets.** The Withings view now builds its own bucket slots (`buildBucketSlots` in `src/model/withings.ts`) instead of reusing the Strava bucketer. Week and month keys are year-qualified (`YYYY-Www`, `YYYY-MM`) and walked forward from the range start, so a rolling "Year" window that begins mid-year is ordered chronologically (e.g. Jun→…→Jun) rather than snapping to a fixed Jan→Dec layout, and measurements from the same week/month number in different years no longer collide into one averaged bucket.
  - **Deterministic aggregation.** Measurements are sorted by date (ties broken by `grpId`) before bucketing so results are independent of stored entry order.
  - **Bezier overshoot clamping.** `buildSmoothPath` clamps each Catmull-Rom control point's vertical position to the band spanned by its two anchor points, preventing the trend line from bulging above/below every real data point when consecutive values change sharply.

- Added **visceral fat** to the Withings pipeline and charts as the optional `visceralFat` field. The sync reads Withings meastype `170`, stores the raw unitless score, and surfaces it in the Body Composition charts without lb conversion.

- Lean mass, bone mass, and hydration display their measured values in pounds. Their 65–66%, 3–5%, and 50–65% optimal ranges are respectively converted to pounds from each measurement's weight, so the shaded band moves with daily weight changes. The Withings visceral-fat score remains a unitless score and uses its unmodified chart scale.

- Optimal ranges render as bounded translucent gray bands, matching the Garmin Load Focus charts rather than using the green series color.
- The visceral-fat chart uses a fixed 1–6 y-axis with whole-number labels and shades 1–5 as the goal range.
- Weight-derived optimal-range bands use a centered three-bucket moving average to reduce short-term visual noise while preserving missing buckets. Fixed ranges, including visceral fat, remain unchanged.
- Visceral fat values display to one decimal place so subtle changes remain visible.
- Goal-range refinement (2026-08): weight-derived bounds now use aggregation-aware
  centered averages (7 daily, 5 weekly, or 3 monthly buckets). The charts render
  each range as one continuous translucent gray band with dashed upper and lower
  boundaries, matching Garmin Load Focus instead of drawing adjacent rectangles.
- Goal-range refinement (2026-08): weight-derived bounds now always use the
  corresponding ISO week's average body weight from the full dataset, keeping
  bounds stable across time-range and aggregation selections. Lean mass uses a
  78–89% body-weight range. Dynamic chart axes target six ticks instead of four.
