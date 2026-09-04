# Feature: Blocker as a standalone schedule item

## What

The calendar already showed a red day number when the `blocked` day flag was
set, but there was no way to see *why* a day was blocked, or to plan around a
specific commitment without cluttering the flag toggles. This adds
**Blocker** as a first-class, plannable schedule item — much like the
existing **Rest** item — that can be added to any day from the per-day picker
or the weekly planner, and given a custom label (e.g. "Dentist appointment").

- Closes natoverse/stronger#421

## Decisions

- **New `BLOCKER_ID = 'blocker'` sentinel** (`src/model/types.ts`, exported
  from `src/model/index.ts`), used as the `workoutId` for a scheduled Blocker
  entry. Stored in the "Workout Schedule" tab like any other entry — no
  schema change needed.
- **Per-day picker (`CalendarView`).** Added a `Blocker` button above `Rest`
  in the assign-workout picker.
- **Weekly planner (`CalendarPush`).** Added a standalone `Blocker` option
  alongside `Rest`.
- **Sort order.** Blocker entries sort first in both the detailed day list
  and the month-view tags (`scheduledWorkoutRank` returns `-1` for Blocker,
  ahead of cardio at `0`, strength at `1`, and rest at `2`).
- **Customizable label.** Unlike Rest, a Blocker entry can be labeled (pencil
  button) just like a strength or cardio entry, since the whole point is to
  give Stronger context about the specific commitment (e.g. "Dentist
  appointment" instead of the generic "Blocker").
- **Visual treatment.** Blocker renders with a `Ban` icon and red styling
  (`--color-danger`) in both the day list and the month-view tag
  (`calendar-month-tag-blocker`). Because red is now used for Blocker, the
  strength tag color moved from pink (`--color-accent`) to green
  (`--color-work`) to keep the two visually distinct.
- **Never synced to Google Calendar.** Blocker entries are a local-only
  planning aid — the user already has the commitment on their personal
  calendar, so `syncScheduleWithCalendar` classifies Blocker entries as
  "inactive" (alongside empty/orphan rows) and passes them through untouched:
  they are never created, updated, pulled, or deleted as Google Calendar
  events.
