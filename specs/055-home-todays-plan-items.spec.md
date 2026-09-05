# Feature: Cardio, rest and blockers in today's plan

## What

The home page already surfaced the strength workouts scheduled for today so
the landing screen doubles as "the day's plan". Cardio activities, Rest and
Blocker entries were invisible there — the user had to open the calendar to
see the full picture. This shows all scheduled items for today on the home
page, in the same order the calendar uses.

## Decisions

- **Shared ordering.** `scheduledWorkoutRank` is now exported from
  `CalendarView` and reused by the home page, so blockers sort first, then
  cardio, then strength, then rest. Ties keep schedule order (stable sort).
- **Non-strength items are not clickable.** Cardio, Rest and Blocker render
  as plain `div` cards (`PlanInfoCard`) — no navigation, no edit/remove/label
  controls. Scheduling and editing remain calendar-only concerns.
- **Icons and labels mirror the calendar.** `HeartPulse` for cardio, `Moon`
  for rest, `Ban` for blockers. Custom entry labels override the default
  cardio/blocker name; cardio falls back to the activity name from the Cardio
  tab, then to the raw id suffix. Rest always displays "Rest".
- **Pure builder for testability.** `buildTodaysPlan` in `WorkoutSelect.tsx`
  maps schedule entries to display items and computes strength completion
  from today's log rows. Strength entries whose workout definition is missing
  are still skipped, and blank `workoutId` rows are ignored.
- **Styling.** New `.plan-info-card-*` rules reuse the existing workout card
  shell; blockers use `--color-danger`, rest uses muted text, cardio uses the
  primary neon cyan.
