# Feature: Mocked pull-request screenshots

> Render every primary application view with representative local data so pull
> requests can produce reviewable screenshots without Firebase credentials.

## What

Add an explicit URL-controlled mock mode and a Playwright screenshot workflow.
Mock mode bypasses authentication and remote reads, then initializes the app
with a compact, date-relative fixture covering every Firestore dataset.

## Acceptance Criteria

- [ ] `?mock=true` bypasses Firebase authentication without requiring runtime
      configuration or credentials.
- [ ] Mock mode loads exercises, workouts, cardio activities, schedule entries,
      day flags, workout sessions, settings, Garmin activities, Garmin wellness,
      and Withings measurements.
- [ ] Normal URLs retain the existing authentication and Firestore behavior.
- [ ] Playwright captures the primary application routes using mock mode.
- [ ] Every pull request runs the screenshot job and publishes the images as a
      downloadable workflow artifact.
- [ ] The mock flag and local screenshot command are documented.

## Out of Scope

- Persisting edits made while using mock mode.
- Visual-regression baselines or pixel-difference gating.
- Publishing screenshots to a public hosting service.
