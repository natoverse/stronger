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
