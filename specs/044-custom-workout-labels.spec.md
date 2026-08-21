# Feature: Custom workout labels

> Let a scheduled workout/cardio entry carry a custom display label, e.g. naming the specific hike planned for a "Cardio" day.

- Closes natoverse/stronger#350

## Acceptance Criteria

- [x] Each Workout Schedule row can store an optional `label` alongside `date`, `workoutId`, `calendarEventId`, and `strongerId`.
- [x] On the calendar's detailed day list, a strength or cardio entry with a custom label shows the label instead of the workout/activity name.
- [x] A pencil button next to a scheduled strength or cardio entry opens an inline text field to set or edit its label; saving (Enter or the check button) persists it, Escape/X cancels.
- [x] The label is purely a display override — `workoutId` still determines what opens/logs when the entry is tapped, and removing the schedule entry clears its label with it.
- [x] Rest days are not labelable (there's nothing to distinguish).

## Notes

- The Workout Schedule sheet tab range grew from `A:D` to `A:E` to hold the new `label` column. Existing rows without a label continue to parse fine (label is omitted when blank).
- Labels are keyed by `(date, workoutId)`, matching how `onRemove` already targets the first matching schedule row for that pair.
