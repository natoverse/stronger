# Feature: Garmin activity charts

> Visualize Garmin-synced activity data with aggregate bar charts and cumulative line charts, with optional annual goal tracking.

## What

Spec 027 established the original activity pipeline through Strava; direct Garmin synchronization now supplies Firestore activity history. This spec adds a UI view to chart that data — giving a visual answer to questions like "how much am I running this month?" and "am I on track for my annual mileage goal?"

The view shows three metrics — **distance** (miles), **elevation gain** (feet), and **duration** (hours) — each in its own chart. Each metric is optional per activity row (some activities may have distance but no elevation, etc.), and a chart is only shown when there is data for it.

### Chart design

Each chart is a **dual-axis** visualization:

1. **Bar chart (left axis)** — Shows aggregated metric values per time bucket. Bars are neon cyan (`--color-primary`). The bucket size depends on the selected time range:
   - **Week** (7 days): one bar per day
   - **Month / Quarter / Year**: one bar per week
   - **All time**: one bar per month

   Each bar represents the sum of that metric across all activities in the bucket.

2. **Cumulative line chart (right axis)** — A running total of the metric across the selected time range, plotted as a neon pink (`--color-accent`) line overlaying the bars. This shows trajectory at a glance.

3. **Goal line (right axis, optional)** — If the user has set an annual goal for the metric, a dashed faded grey line shows the linear target trajectory from 0 to the goal value (prorated to the selected time range). The cumulative line crossing above the goal line means the user is ahead of pace.

### Activity type filtering

A filter control lets the user select which activity types to include. By default all types are included. The filter applies to all metric charts simultaneously. Activity types are derived from the data — only types present in the activity history are shown as filter options.

### Goal setting

Goals are **annual** and **per-metric**, persisted in the user's Firestore settings document. A goal represents a target cumulative value for the year (e.g., "run 1000 miles this year" or "gain 200,000 ft of elevation this year"). When viewing shorter time ranges, the goal line is prorated (e.g., a 1000-mile annual goal shows as ~83 miles on a month chart).

Goals are set inline — tapping a "Set goal" icon near the chart opens a simple input. Goals are optional; if not set, no goal line appears.

## Acceptance Criteria

- [ ] A "Garmin" view is accessible from the app's navigation (route: `#/garmin`)
- [ ] The view reads activity data from the user's Firestore Garmin activity buckets
- [ ] Three metric charts are displayed: distance (miles), elevation gain (feet), duration (hours)
- [ ] Charts with no data for a metric are hidden
- [ ] A time range selector offers: Week, Month, Quarter, Year, All
- [ ] Bar chart shows aggregated values per time bucket (daily for week, weekly for month/quarter/year, monthly for all)
- [ ] Bars are neon cyan (`--color-primary`)
- [ ] A cumulative line is plotted on the right y-axis in neon pink (`--color-accent`)
- [ ] Activity type filter lets the user include/exclude specific types
- [ ] Annual goals can be set per metric via inline input
- [ ] Goals are stored in the user's Firestore settings document
- [ ] When an annual goal is set, a dashed faded grey goal-pace line appears on the right axis, prorated to the selected time range
- [ ] The cumulative line's position relative to the goal line shows whether the user is ahead or behind pace
- [ ] The view follows the existing neon visual style
- [ ] Charts are readable and usable on a phone screen

## Scope

### In scope
- Garmin charts view with route and navigation entry
- Bar charts aggregated by time bucket
- Cumulative line overlay on second y-axis
- Activity type filtering
- Time range selector (week, month, quarter, year, all)
- Annual goal persistence in Firestore settings
- Goal-pace line (prorated) on the cumulative axis
- Reading data from existing Garmin activity buckets
- SVG-based charts (consistent with existing progress charts)

### Out of scope
- Editing or deleting Garmin activity rows (the sync pipeline owns that data)
- Heart rate or calorie charts (could be added later)
- Drill-down into individual activities
- Goal notifications or alerts
- Comparing across time periods (e.g., this month vs. last month)
- Per-activity-type goals (goals apply to the filtered total)
- Non-annual goals (weekly, monthly, etc.)

## Data model

### Garmin activity history

Yearly documents in `/users/{uid}/garminActivities/{year}` expose shared activity objects. The source activity ID retains the shared model's `stravaId` name; it is now a Garmin identifier.

This spec consumes the activity date from `timestamp`, plus `activityType`, `duration` (seconds), `distance` (meters), and `elevationGain` (meters). Other fields are not required for these charts.

> **Note**: The charting code must degrade gracefully when optional metric fields are missing.

### Settings document

A general-purpose settings map in `/users/{uid}/settings/app`, including goals.

| Field | Description |
|--------|-------------|
| `key` | Setting identifier (e.g. `goal.distance`, `goal.elevationGain`, `goal.duration`) |
| `value` | Setting value as a string |

Goal entries use a `goal.` prefix on the key (e.g. `goal.distance = 1000`). Additional non-goal settings can be added without changing a positional schema.

### Units and display

| Metric | Storage unit | Display unit |
|--------|-------------|--------------|
| Duration | seconds | hours (bar labels) |
| Distance | meters | miles (bar labels) |
| Elevation gain | meters | feet (bar labels) |

Conversions are display-only — storage remains in metric (matching Strava API output). The cumulative line and goal line use the same display units. Goal values are stored in display units (hours, miles, feet) since they are user-entered.

### Colors

| Element | Color |
|---------|-------|
| Bars | `--color-primary` (neon cyan, `#00e5ff`) |
| Cumulative line | `--color-accent` (neon pink, `#ff2d7b`) |
| Goal pace line | faded grey (e.g., `rgba(255, 255, 255, 0.25)`), dashed |

## Notes

- **SVG charts**: The existing progress charts use hand-rolled SVG. These charts are more complex (dual axis, bars + line + goal line) but the same approach should work. No charting library needed.
- **Goal proration**: An annual goal of 1000 miles shows as: ~19.2 miles on a week chart, ~83.3 miles on a month chart, ~250 miles on a quarter chart, 1000 miles on a year chart. For "all time," the goal line is not shown (it's only meaningful for bounded periods within a year).
- **Time range anchoring**: "Month" means the calendar month containing today. "Week" means the current ISO week. "Quarter" and "Year" similarly anchor to the current calendar period.
- **Empty buckets**: Time buckets with no activities show as zero-height bars (no gap in the x-axis). This makes the cumulative line's flat segments visible and meaningful.
- **Goal editing UX**: Keep it minimal. Tapping a small "Set goal" or pencil icon near the chart shows an inline number input. Pressing enter saves. No modal, no separate settings page.
- **Route**: `#/garmin` added to the hash router. Navigation icon: `Activity` or `Mountain` from lucide-react (or similar — whatever fits the neon aesthetic).
- **Depends on**: Direct Garmin synchronization (spec 031). Without synced activity history, the component renders an empty state ("No Garmin data yet. Set up sync to see activity charts.").

## Implementation notes (added during development)

- **Mock data first**: Initial implementation used `src/data/mock-garmin.ts`, generating ~6 months of synthetic activities (Run, Ride, Hike, Trail Run) using a deterministic PRNG. Goals used mock defaults (1500 mi, 200k ft, 500 hrs), pending real activity integration.
- **Nav icon**: Uses `Activity` from lucide-react. Title shows "Activities" since the view shows all synced activities, not just Garmin-branded ones.
- **Goal storage**: Initially in-memory only (state reset on reload); persistence was deferred until real data integration.
- **Goal persistence (implemented)**: Goals now persist in the general-purpose Firestore settings document, using `goal.<metric>` keys (e.g. `goal.distance`). `goalsFromSettings()` / `goalsToSettings()` in `src/model/settings.ts` handle conversion and are exported through `src/model/index.ts`.
- **Model/view split**: Chart logic is in `src/model/garmin.ts` (pure functions, 31 unit tests). Component is in `src/components/GarminView.tsx`. This mirrors the existing `progress.ts` / `ProgressView.tsx` pattern.
- **SVG approach**: Hand-rolled SVG with viewBox for responsiveness, matching the existing progress charts style. niceTicksFor helper is duplicated (same algorithm as ProgressView) — could be extracted later.
- **Filter UX**: Collapsible chip-based filter for activity types. "All" toggle for convenience. Filter only appears when more than one activity type exists.

## Iteration: aggregate chart summaries

- Activity chart headers show the aggregate for the selected range first. In weekly
  and monthly aggregation, they append the most recently recorded individual activity
  as `Last …`;
  daily aggregation keeps its single current value.

## Iteration: goal-relative bar scaling

- When an annual goal applies to the selected range, the bar axis is fixed at three
  times the evenly allocated per-bucket goal so unusually large days or periods do not
  compress the normal bars.
- Bars above that limit stop at the top of the plot and use a crosshatch fill to show
  that their actual value continues beyond the visible axis. Tooltips retain the full
  uncapped value.

## Iteration: compact date selector

- Date range controls show buttons for Month, rolling Year, and the latest three
  calendar years.
- A More dropdown replaces the fourth calendar-year button and offers every older
  year through 2015.

## Iteration: selected-range header totals

- Distance, elevation, and duration chart headers always lead with the total for
  the selected Month, rolling Year, or calendar year, regardless of the chart's
  daily, weekly, or monthly bar aggregation.

## Iteration: activity log period behavior

- Without a search query, the activity log follows the chart's selected date range.
- While a search query is present, matching activities are shown across all dates;
  clearing the query restores the selected-range list.
- Inactive date-range controls use the opaque app background so scrolling content
  does not show through them.

## Iteration: sticky chart control spacing

- The gap between the sticky app header and chart controls is reduced from 0.5rem to
  0.25rem.
- The header extends its opaque app background across that gap so scrolling content
  cannot show behind it.
