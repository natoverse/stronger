# Feature: Auth-free Playwright PR screenshots

> Give every pull request deterministic screenshots of representative Stronger
> views without requiring Firebase, Google, Garmin, or Withings credentials.

## What

Add an explicit `?mock=1` browser mode that bypasses Firebase authentication
and initializes the application from a small, type-safe fixture covering every
startup data source. Add Playwright coverage that opens representative routes
and captures screenshots, plus a pull-request workflow that publishes those
screenshots as a downloadable artifact.

Mock mode is a review and development facility, not an alternate persistence
backend. It performs no authentication, network reads, or remote writes.

## Acceptance Criteria

- [ ] `?mock=1` bypasses Firebase authentication and startup data loading.
- [ ] Mock mode is visually identified and does not expose real user data.
- [ ] Mock data covers exercises, workout definitions, computed workouts,
      workout logs, workout schedule, day flags, cardio activities, Garmin
      activities, Garmin wellness, Withings measurements, goals, and settings.
- [ ] Fixture dates are generated relative to the browser's current date so
      home, calendar, freshness, and chart views remain populated over time.
- [ ] Normal URLs retain the existing Firebase authentication and persistence
      behavior.
- [ ] Playwright captures desktop screenshots for the home, calendar,
      exercises, progress/body-composition, Garmin wellness, Garmin activities,
      and settings routes.
- [ ] Screenshot tests fail if a route remains on authentication/loading UI or
      reaches the application error boundary.
- [ ] Pull requests run the screenshot suite without repository secrets and
      publish the screenshots and Playwright report as workflow artifacts, and
      embed the screenshots in a reusable pull-request comment.
- [ ] Mock-mode parsing and fixture integrity have unit tests.

## Design Decisions (2026-09-06)

- The public URL switch is the explicit query parameter `mock=1`; hash routes
  remain unchanged, for example `/stronger/?mock=1#/calendar`.
- Mock mode is read-only by construction: `spreadsheetId` remains `null`, so
  existing persistence callbacks cannot target a Firebase user.
- Firebase receives a local placeholder configuration only when build-time
  configuration is absent. Normal unauthenticated URLs still stop at the
  existing configuration error before making Firebase requests.
- Screenshot generation checks out and runs the PR code with read-only
  permissions so it captures the proposed visual changes. A separate
  `workflow_run` workflow, loaded from the default branch, publishes validated
  PNGs to the `pr-screenshot-assets` branch and embeds them in a
  marker-delimited pull-request comment. The privileged publisher never checks
  out or executes pull-request code.
- The workflow deliberately avoids `pull_request_target`. GitHub requires
  approval for workflows on Copilot coding agent PRs by default, independently
  of whether the repository owner is a first-time contributor. Repository
  administrators can opt out under **Settings → Copilot → cloud agent → Actions
  workflow approval** by disabling **Require approval for workflow runs**.
- Screenshots use a fixed desktop viewport and disabled animations for stable,
  reviewer-friendly output. They are generated rather than committed as visual
  regression baselines, so intentional UI changes do not fail merely because
  pixels changed.
