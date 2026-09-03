# Feature: Two-way Google Calendar sync

> Sync the schedule between the Google Sheet (source of truth) and Google Calendar, picking up date changes made on either side via a manual refresh.

## What

Spec 015 defined a one-way push from the app to Google Calendar. This spec replaces that model with two-way sync. The Google Sheet remains the authoritative source of truth for the schedule, but if the user moves an event to a different day in Google Calendar, that change is pulled back into the sheet on the next sync.

The sync is triggered manually via a "Sync with Calendar" button in the calendar view (spec 016). When pressed, the app: (1) pushes any new or updated schedule entries from the sheet to Google Calendar, and (2) reads back events from Google Calendar to detect date changes, updating the sheet accordingly. To make this work, each schedule row in the sheet stores a Google Calendar event ID alongside the date and workout ID — this is the key that links the two sides.

If an event is deleted from Google Calendar, the corresponding entry is removed from the sheet. If an entry is deleted from the sheet, the corresponding calendar event is deleted. Conflicts (e.g., both sides changed) are resolved in favor of the most recent change, or the Google Calendar side if ambiguous — since the user is more likely to make quick date moves there.

## Acceptance Criteria

- [ ] A "Sync with Calendar" button is available in the calendar view.
- [ ] Pressing sync pushes new schedule entries to Google Calendar as events (with workout name and deep link).
- [ ] Pressing sync pulls date changes from Google Calendar back into the sheet.
- [ ] Each schedule row in the sheet includes a Google Calendar event ID column.
- [ ] Moving an event to a different day in Google Calendar updates the date in the sheet on next sync.
- [ ] Deleting an event from Google Calendar removes the entry from the sheet on next sync.
- [ ] Removing an entry from the sheet deletes the corresponding Google Calendar event on next sync.
- [ ] The user can select which Google Calendar to sync with.
- [ ] Success/failure feedback is shown after sync completes.

## Scope

### In scope
- Two-way sync logic (sheet ↔ Google Calendar)
- Event ID storage in the sheet's schedule zone
- Manual sync trigger from the calendar view UI
- Calendar picker (target calendar selection)
- Create, update, and delete operations on both sides

### Out of scope
- Automatic/background sync (always manual)
- Conflict resolution UI (automatic resolution is sufficient)
- Syncing non-strength activity types (future spec adds those to the schedule first)
- Time-of-day for events (all-day events or a sensible default)

## Notes

- This spec supersedes spec 015's one-way push model. Spec 015's acceptance criteria around the mapping UI are no longer needed — the schedule comes from the sheet (spec 016). The Calendar API scope and auth changes from spec 015 still apply.
- Depends on spec 014 (deep-link router) for URLs in calendar events and spec 016 (in-app calendar view) for the schedule data and UI surface.
- The sheet's schedule zone needs an additional column for the event ID (e.g., `[date, workoutId, calendarEventId]`). Rows without an event ID are new and need to be pushed; rows with an ID are checked against the calendar for changes.
- The Google Calendar Events API supports `list` with `updatedMin` filtering, which can make incremental sync efficient. But a simple full-read approach is fine for the initial implementation given the small data volume.

## Implementation Decisions

- Schedule tab expanded from 7 columns (A:G) to 8 columns (A:H) with `calendarEventId` at column H.
- The sync function queries a ±30 day window around the schedule date range to catch events moved outside the original range.
- Old schedule rows (pre-dating this change) have no `calendarEventId` and are treated as new entries on first sync — they get pushed to Google Calendar and receive an event ID.
- Flag-only rows (no workoutId) are excluded from sync entirely since they have no corresponding calendar event.
- The CalendarSync UI is a separate component from CalendarPush, shown via a "Sync" toolbar button. Both panels collapse each other when opened (mutual exclusion).
- The existing one-way push functionality (CalendarPush) is preserved alongside the new two-way sync.

## Iteration: verified Firebase calendar binding

- Calendar authorization and calendar selection complete before synchronization begins.
- The selected calendar is persisted in the Firebase settings document and reused across devices and sessions.
- Missing event IDs are accepted as remote deletions only when syncing against the previously verified calendar.
- A first sync with legacy event links must find at least one linked event before binding the selected calendar.
- Stronger-tagged Calendar events can rebuild an empty Firebase schedule, including custom-titled strength events whose descriptions retain their workout deep links.
