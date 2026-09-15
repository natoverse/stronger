# Feature: Two-way Google Calendar sync

> Sync the schedule between Firestore (source of truth) and Google Calendar, picking up date changes made on either side via a manual refresh.

## What

Spec 015 defined a one-way push from the app to Google Calendar. This spec replaces that model with two-way sync. Firestore remains the authoritative source of truth for the schedule, but if the user moves an event to a different day in Google Calendar, that change is pulled back into Firestore on the next sync.

The sync is triggered manually via a "Sync with Calendar" button in the calendar view (spec 016). When pressed, the app: (1) pushes any new or updated schedule entries from Firestore to Google Calendar, and (2) reads back events from Google Calendar to detect date changes, updating Firestore accordingly. Each schedule event stores a Google Calendar event ID alongside its workout ID — this is the key that links the two sides.

If an event is deleted from the verified Google Calendar, the corresponding entry is removed from Firestore. If an entry is deleted from Firestore, the corresponding calendar event is deleted. Conflicts (e.g., both sides changed) are resolved in favor of the most recent change, or the Google Calendar side if ambiguous — since the user is more likely to make quick date moves there.

## Acceptance Criteria

- [ ] A "Sync with Calendar" button is available in the calendar view.
- [ ] Pressing sync pushes new schedule entries to Google Calendar as events (with workout name and deep link).
- [ ] Pressing sync pulls date changes from Google Calendar back into Firestore.
- [ ] Each linked schedule event includes a Google Calendar event ID field.
- [ ] Moving an event to a different day in Google Calendar updates its Firestore schedule date on next sync.
- [ ] Deleting an event from the verified Google Calendar removes the Firestore entry on next sync.
- [ ] Removing an entry from Firestore deletes the corresponding Google Calendar event on next sync.
- [ ] The user can select which Google Calendar to sync with.
- [ ] Success/failure feedback is shown after sync completes.

## Scope

### In scope
- Two-way sync logic (Firestore ↔ Google Calendar)
- Event ID storage in Firestore schedule events
- Manual sync trigger from the calendar view UI
- Calendar picker (target calendar selection)
- Create, update, and delete operations on both sides

### Out of scope
- Automatic/background sync (always manual)
- Conflict resolution UI (automatic resolution is sufficient)
- Syncing non-strength activity types (future spec adds those to the schedule first)
- Time-of-day for events (all-day events or a sensible default)

## Notes

- This spec supersedes spec 015's one-way push model. Spec 015's acceptance criteria around the mapping UI are no longer needed — the schedule comes from Firestore (spec 016). The Calendar API scope and auth changes from spec 015 still apply.
- Depends on spec 014 (deep-link router) for URLs in calendar events and spec 016 (in-app calendar view) for the schedule data and UI surface.
- Schedule events retain `workoutId`, `calendarEventId`, `strongerId`, and optional `label` in the day's `events` array. Events without an event ID are new and need to be pushed; linked events are checked against the calendar for changes.
- The Google Calendar Events API supports `list` with `updatedMin` filtering, which can make incremental sync efficient. But a simple full-read approach is fine for the initial implementation given the small data volume.

## Implementation Decisions

- Schedule entries gained a `calendarEventId` field to link planned workouts to remote events.
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

## Firestore-only iteration (2026-09-15)

- Schedule and calendar-binding settings persist in Firestore. The existing Google Calendar OAuth integration remains online-only and separate from Firebase Authentication; verified-calendar deletion safeguards still apply.
