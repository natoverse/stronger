# Feature: Google Calendar schedule push

> Push a weekly workout schedule to a Google Calendar so each training day appears as an event with a deep link to the workout.

## What

The app already knows which workouts exist and (with spec 014) will support deep-linking to them by ID. This feature lets the user define a weekly training schedule — mapping days of the week to workouts — and push that schedule to a specified Google Calendar as a one-time batch of events.

The user picks a target calendar, assigns workouts to days (e.g., Mon → squat-a, Tue → bench-b, Thu → squat-b, Fri → press-a), chooses a date range (e.g., "next 4 weeks"), and hits "Push to Calendar." Each created event contains the workout name as the title and a deep link to the workout in the event description or URL field.

This is a manual, on-demand action — not an ongoing sync. If the user's schedule or weights change, they can push again (existing events are not modified or removed).

## Acceptance Criteria

- [ ] UI allows the user to assign a workout to each day of the week (some days left empty).
- [ ] UI allows the user to choose a date range for the push (e.g., number of weeks).
- [ ] User can select which Google Calendar to target (from their calendar list).
- [ ] Pushing creates one event per scheduled workout-day within the date range.
- [ ] Each event title is the workout name.
- [ ] Each event description or URL contains a deep link to the workout (depends on spec 014).
- [ ] OAuth scope includes Google Calendar write access.
- [ ] Success/failure feedback is shown after the push completes.

## Scope

### In scope
- Schedule configuration UI (day → workout mapping, week count)
- Calendar picker (list user's writable calendars)
- Batch event creation via Google Calendar API
- Requesting Calendar API OAuth authorization separately from Firebase sign-in

### Out of scope
- Editing or deleting previously pushed events
- Ongoing sync / automatic updates when weights change
- Recurring calendar events (individual events are created per date)
- Storing the schedule persistently (it's configured each time, or we revisit in a future spec)

## Notes

- This feature depends on spec 014 (deep-link routing) for the URLs embedded in calendar events.
- The Google Calendar API requires the `https://www.googleapis.com/auth/calendar.events` OAuth scope. Calendar authorization is optional and separate from Firebase Authentication.
- The manifesto says "client-only deployment" — the Calendar API is callable from the browser with an OAuth token, so this stays client-only.
- Event times: workouts don't have a fixed time of day. The simplest approach is to create all-day events, or default to a fixed time (e.g., 6:00 AM). This is an implementation detail left to the implementer.

## Firestore-only iteration (2026-09-15)

- Firebase Authentication owns the application session. Google OAuth remains only for optional, online Google Calendar operations; calendar events and deep links are unchanged.
