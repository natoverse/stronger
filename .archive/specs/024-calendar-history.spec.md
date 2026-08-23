# Feature: Workout history on calendar

> Browse past workouts on the calendar page, see what was completed, and edit logged data.

## What

The calendar view currently only looks forward — it shows the next 28 days of scheduled workouts with no way to see what happened in the past. This spec adds a history mode to the calendar that lets the user scroll backward through prior days.

When the user taps a "History" button on the calendar page, the view scrolls up to reveal past days above the current position. Days that have logged workout data in the sheet show a green indicator bar, giving an at-a-glance picture of training consistency. Days with scheduled workouts that were never logged show the workout name but no green bar.

Tapping a completed workout on a past day opens a read/edit view of that session's logged data — the same fields as the workout execution page, pre-filled with the actual values from the log. The user can update weight, reps, or set type and save changes back to the sheet. This covers the common case of fixing a typo or adding a forgotten set after the fact.

## Acceptance Criteria

- [ ] A "History" button appears on the calendar view (e.g., at the top of the day list or in the nav area).
- [ ] Tapping History scrolls the calendar upward to show past days, loading them in reverse-chronological order.
- [ ] The user can scroll/browse backward through prior days without a hard cutoff (lazy-load older days as the user scrolls up).
- [ ] Days with completed workout log entries display a green indicator bar alongside the workout name.
- [ ] Days with a scheduled workout but no log entry show the workout name without a green bar.
- [ ] Unscheduled days that have log entries still appear with the green bar and workout name (handles workouts logged without being scheduled first).
- [ ] Tapping a completed workout on a past day opens a detail view showing the logged sets with actual weight, reps, set type, and completed status.
- [ ] The detail view is editable — the user can change actual weight, reps, or set type for any logged set.
- [ ] Saving edits writes the updated values back to the log tab in the sheet.
- [ ] Cardio log entries in history show the four cardio fields (duration, distance, elevation, weight) and are also editable.
- [ ] The calendar page defaults to its current forward-looking view; history is opt-in via the button.

## Scope

### In scope
- History browsing mode on the existing calendar page
- Green completion indicator on past days
- Merging schedule data and log data to build the history view
- Read/edit view for a single past workout session
- Saving edits back to the log tab
- Lazy-loading older days as the user scrolls up

### Out of scope
- Trend charts, progress graphs, or aggregate statistics
- Deleting log entries (edit only)
- Adding entirely new log entries from the calendar (use the normal workout flow for that)
- Filtering or searching history by exercise, workout name, or date range
- Reordering or drag-and-drop of past entries

## Notes

- **Data source for history**: The log tab (`Stronger - Log`) is the source of truth for what was completed. The schedule tab tells us what was *planned*. The history view merges both: iterate backward from today, showing each day's scheduled workouts and any log entries, with the green bar driven by log presence.
- **Green bar logic**: A day gets a green indicator bar next to a workout if there is at least one log row with that `workoutId` and `date`. Partial completion (some sets not marked complete) still shows green — the bar means "session exists," not "every set was finished."
- **Identifying log rows to edit**: Each log row has `date`, `workoutId`, `liftId`, and `setNumber`. When the user edits a past session, the app finds the matching rows by `(date, workoutId)` and updates them in place. This requires row-level update capability — not just append. The sheets API `spreadsheets.values.update` can target individual cells by range.
- **Scrolling UX**: The history mode should feel like a natural extension of the existing day list. One approach: the current 28-day forward list stays as-is; tapping History prepends past days above it and scrolls the viewport up. Loading chunks of 14–28 days at a time keeps API calls reasonable.
- **Row updates vs. rewrite**: For editing, prefer updating individual cells in the log tab rather than rewriting the entire log. The log can grow large; targeted updates are safer and faster.
- **Depends on**: spec 016 (calendar view), existing log read infrastructure (`readLogZone`, `parseLogRow`).

## Iteration: load previous days

- History is no longer a mode toggled from the fixed calendar toolbar.
- A persistent “Load previous days” control appears at the top of the detailed schedule card list, mirroring “Show more days” at the bottom.
- Each activation prepends the preceding seven days while preserving the existing schedule and log history behavior.
