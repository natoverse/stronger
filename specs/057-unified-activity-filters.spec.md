# Feature: Unified activity filters

## What

Make the Activities page search, activity-type selection, and time range a single set of filters for both charts and activity cards. Keep strength training out of the type selector because it has its own chart. Add an explicit all-time range to the shared range selector so Activities and Progress can show their complete histories.

## Acceptance Criteria

- [ ] Activity search and type controls appear above the activity charts.
- [ ] The selected time range, activity types, and search query jointly filter cardio charts and activity cards.
- [ ] Search also filters the dedicated strength-training chart, while the cardio type selector does not control it.
- [ ] Weight Training is not shown in the activity-type selector or activity cards.
- [ ] The More range menu contains an All option.
- [ ] All shows the complete available history on both Activities and Progress.
- [ ] All-time activity charts use distinct buckets across calendar years.

## Decisions

- Activity search matches activity names and types case-insensitively.
- Strength training remains a dedicated duration chart and is not included in the general activity card/type-filter flow.
- All-time chart buckets begin with the earliest matching activity rather than a fixed historical date.
- Activity cards sort newest first by their parsed ISO 8601 timestamp. Garmin sync stores that single timestamp rather than separate date and time fields.

## Iteration: Activity list averages

- Always show average distance, time, elevation gain, and elevation loss beneath the charts, between the Activity Log heading/count and the activity cards.
- Compute per-activity arithmetic means from the exact displayed list, so search, type selection, and time range all affect the summary; chart aggregation does not.
- Use the activity cards' units and precision: miles, hours:minutes, and feet. Keep the four metrics readable on narrow screens.
- Include recorded zeroes in averages. Exclude missing, non-finite, or negative values separately for each metric, rather than treating unknown measurements (especially optional elevation loss) as zero.
- Show an em dash when no displayed activity has a valid value for a metric, including an empty result set. Show explicit zero values when recorded averages are zero.
