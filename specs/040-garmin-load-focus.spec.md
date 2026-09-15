# Feature: Garmin Load Focus (training load balance)

## What

Garmin Connect's **Load Focus** breaks recent training into three intensity
buckets — **Low Aerobic**, **High Aerobic**, and **Anaerobic** — reporting each
bucket's monthly (rolling ~28-day) load alongside an **optimal target range**
(min/max) that shifts daily based on recent training. The app now syncs these
data points and renders a chart per bucket: daily load bars with the optimal
range shaded behind them so you can see whether each area is below, within, or
above its target.

## Availability

The data comes from the existing `get_training_status(cdate)` call — no extra
API request. The payload carries:

```
mostRecentTrainingLoadBalance
  └─ metricsTrainingLoadBalanceDTOMap
       └─ <device-id>
            ├─ monthlyLoadAerobicLow / …TargetMin / …TargetMax
            ├─ monthlyLoadAerobicHigh / …TargetMin / …TargetMax
            └─ monthlyLoadAnaerobic / …TargetMin / …TargetMax
```

## Decisions

- **Schema.** Nine optional numeric fields added to Garmin wellness entries
  (value + optimal min + optimal max for each of the three training areas):
  `loadFocusAerobicLow{,Min,Max}`, `loadFocusAerobicHigh{,Min,Max}`,
  `loadFocusAnaerobic{,Min,Max}`. Kept in sync across the direct Firestore
  mapping in `scripts/garmin-wellness-sync.py` and `GarminWellnessEntry` in
  `src/model/types.ts`.
- **Sync.** Extraction lives inside `_fetch_training_status` (via the
  `_extract_load_focus` helper) so it reuses the single training-status fetch.
  Missing balance data yields `null` fields, not an error.
- **Model.** `buildLoadFocusChartData(entries, area, range, aggregation, today)`
  returns per-period `{ value, min, max }` buckets. Load values are **averaged**
  within a period (a load-focus reading is already a rolling total, so summing
  would double-count).
- **Chart.** New `WellnessLoadFocusChart` component: a per-bucket translucent
  band from optimal-min to optimal-max sits behind the daily load bars. Bars are
  colored by position vs. the range — below (yellow), in range (green), above
  (orange) — with a title-popover legend, matching the other wellness charts.
  Three instances render in the Training section (Low Aerobic, High Aerobic,
  Anaerobic), just after the Load Ratio chart.
- **Tests.** Offline sync extraction covered in
  `scripts/test_garmin_wellness_sync.py`; aggregation and chart data are covered
  in `src/model/__tests__/wellness.test.ts`.
- **Iteration (2026-07).** Switched the optimal-range background band in the
  load-focus charts from green to transparent gray so the shaded range is easier
  to distinguish from in-range (green) bars.
- **Iteration (2026-08).** Replaced load-value bars with filled dots for Low
  Aerobic, High Aerobic, and Anaerobic Load. The dynamic optimal-range shading,
  min/max reference lines, axes, dimensions, colors, and tooltips remain
  unchanged.
