# Feature: Rest as a standalone workout-planner option

## What

The workout planner (calendar) lets you schedule strength workouts and cardio
activities onto dates. There was no way to plan a **Rest** day intentionally.
The weekly planner already had a "— Rest —" entry, but it was misleadingly
named: selecting it *cleared* whatever was scheduled on that day rather than
placing a visible, deliberate rest marker.

This adds **Rest** as a first-class, plannable schedule item that is neither
strength nor cardio. A scheduled Rest day shows up on the calendar (with a moon
icon) just like a workout, can be removed, and round-trips through Google
Calendar sync.

## Decisions

- **New `REST_ID = 'rest'` sentinel** (`src/model/types.ts`, exported from
  `src/model/index.ts`) used as the `workoutId` for a scheduled rest day. It is
  stored in the "Workout Schedule" sheet tab like any other entry — no schema
  change is needed since it reuses the existing `workoutId` column.
- **Weekly planner (`CalendarPush`).** Added a standalone `Rest` option. The
  pre-existing clear behavior (sentinel `__rest__`, which blanks a day's
  workouts) was preserved but relabeled from "— Rest —" to "— Clear —" to
  remove the naming clash.
- **Per-day picker (`CalendarView`).** Added a `Rest` button at the top of the
  assign-workout picker so a rest day can be dropped onto any single date.
- **Calendar rendering.** Scheduled Rest entries render with a `Moon` icon and a
  muted "Rest" label. They are not clickable (there is no workout to open) but
  can be removed like any scheduled item.
- **Name resolution.** `workoutId` `rest` resolves to the display name "Rest"
  in both directions (`resolveWorkoutName` / `resolveWorkoutId` in `App.tsx`),
  so Google Calendar sync creates/pulls "Rest" all-day events.
- **No deep link for Rest.** Like cardio, rest events carry no `#/workout/...`
  deep link in their calendar description (`hasNoDeepLink` helper in
  `src/google/calendar.ts`).
