# Feature: Progress charts

> Visualize training progress over time with per-lift line charts for volume, heaviest weight, and estimated 1RM.

## What

The app logs every set to the sheet but provides no way to see trends. This spec adds a "Progress" view that charts training data over time, giving a quick visual answer to "am I getting stronger?"

The page shows a single timeline line chart at a time. The user picks a lift (any exercise from their log history) and a metric — total volume, heaviest weight, or estimated 1RM — and the chart plots one data point per session. A time-range selector (1 month, 3 months, 12 months, or all) filters the visible window.

Warmup sets are excluded from all calculations. Only completed, non-warmup sets (work, backoff, joker) contribute to the metrics:

- **Total volume**: sum of (weight × reps) across all qualifying sets in a session.
- **Heaviest weight**: the maximum weight used in any qualifying set in a session.
- **Estimated 1RM**: Epley formula — weight × (1 + reps / 30) — applied to each qualifying set, taking the highest result per session.

## Acceptance Criteria

- [ ] A "Progress" view is accessible from the app's navigation
- [ ] The user can select any lift that has logged data
- [ ] The user can select a metric: total volume, heaviest weight, or estimated 1RM
- [ ] The user can select a time range: 1 month, 3 months, 12 months, or all
- [ ] A line chart displays one data point per session for the selected lift + metric + range
- [ ] The x-axis represents dates; the y-axis represents the selected metric's value
- [ ] Warmup sets are excluded from all metric calculations
- [ ] Only completed sets contribute to calculations
- [ ] The chart is readable and usable on a phone screen
- [ ] The view follows the existing neon visual style

## Scope

### In scope
- Progress view with lift selector, metric selector, and time-range selector
- Line chart rendering for a single lift at a time
- Three metric calculations (volume, heaviest weight, estimated 1RM)
- Four time-range filters
- Reading log data from the existing sheet log tab
- Route and navigation entry point

### Out of scope
- Comparing multiple lifts on one chart
- Body-weight or cardio-specific progress charts
- Data export or sharing
- Numerical summary tables alongside the chart
- Custom date-range picker (only the four preset ranges)

## Notes

- Log data comes from `readLogZone()` in `src/google/sheets.ts`, which returns `ParsedLogRow[]`. Each row has `setType`, `actualWeight`, `actualReps`, `completed`, `exerciseName`, `liftId`, and `date` — everything needed for the calculations.
- The app has no charting library today. The implementer will need to add one; the choice is left to implementation.
- Route should be `#/progress`, added to the hash router's route union type in `src/hooks/useHashRouter.ts`.
- The Epley formula breaks down for single-rep sets (reps = 1 yields 1RM = weight itself), which is correct and expected.

## Implementation notes (iteration updates)

- Strength chart metric/goal summaries were moved into each chart card header (next to the lift title) to match the Garmin/activities chart pattern.
- The selected-lift strength card now renders the same shared header structure as big-4 cards so final chart cards keep consistent heights.
- Est. 1RM charts now also express strength relative to body weight. When Withings body-weight data is loaded, each e1RM chart header appends the peak e1RM as a body-weight multiple (e.g. `1.53×BW`), and the per-point tooltip appends the ratio for that session. The ratio uses the Withings weight measurement closest in time to the session date, converted to pounds via `toDisplayUnit('weight', ...)` so both sides of the ratio share units. Helpers `bodyWeightForDate` and `bodyWeightRatio` live in `src/model/progress.ts`. Ratios are only shown for the `e1rm` metric (not volume or heaviest).
