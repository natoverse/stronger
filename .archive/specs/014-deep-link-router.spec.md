# Feature: Deep-link routing to workouts

> Add client-side routing so users can navigate directly to a workout via URL (e.g. `/workout/squat-a`), enabling bookmarks and shared links.

## What

Currently the app is a single-screen SPA — selecting a workout is driven entirely by in-memory state. If you reload the page, you're back at the workout list. There's no way to bookmark "today's workout" or jump straight to it from a home-screen shortcut.

This spec adds a lightweight client-side router so the URL reflects the current view. Navigating to `/workout/:workoutId` loads that workout directly (after auth). The workout list lives at the root path `/`. Browser back/forward buttons work as expected.

## Acceptance Criteria

- [ ] Root path (`/`) shows the workout-select screen (current behavior).
- [ ] `/workout/:workoutId` selects the matching workout and opens the workout view.
- [ ] If the `workoutId` in the URL doesn't match any loaded workout, the user is redirected to `/` (or shown a clear message).
- [ ] Selecting a workout from the list updates the URL to `/workout/:workoutId` without a full page reload.
- [ ] Pressing the browser back button from a workout view returns to the workout list.
- [ ] Finishing or backing out of a workout navigates back to `/`.
- [ ] GitHub Pages deployment continues to work (hash routing or SPA 404 fallback).

## Scope

### In scope
- Client-side routing between workout list and workout view
- URL update on workout selection and on back/finish
- Handling of invalid workout IDs in the URL

### Out of scope
- Routes for progression review, settings, or any other future screens
- Server-side rendering or preloading workout data from the URL alone (auth is still required first)
- Choosing a specific router library (implementer's call — could be `react-router`, hash-based, or manual `popstate`)

## Notes

- Since the app is hosted on GitHub Pages (static files), hash-based routing (`/#/workout/squat-a`) is the simplest path — no need for a custom 404.html redirect trick. But either approach is fine.
- Auth must complete before the workout can be resolved from the URL. The router should defer workout resolution until after `sheetConnected` is true.
- Workout IDs already exist and are stable (e.g. `squat-a`, `bench-b`), so they're suitable for use in URLs as-is.

## Post-merge decisions

- **Settings-dependent routes on refresh (2026-08-15):** Route visibility checks now wait for persisted app settings to load. This prevents enabled Garmin, Garmin Activities, and Nutrition pages from being redirected home during refresh while the app still holds default visibility settings.
