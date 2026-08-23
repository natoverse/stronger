# Feature: New user setup page

> Give first-time users a single screen to enter their working weights for the four barbell lifts before anything is written to the sheet, replacing the current silent-defaults behavior.

## What

When a user connects a fresh spreadsheet (empty config zone), the app currently writes hard-coded default lift configs without any user input. Those defaults are unlikely to match anyone's actual working weights, so the user has to go find and fix them later.

This spec adds a setup page that appears once — after sheet connection but before the normal app flow — showing the four default barbell lifts (squat, bench, press, deadlift) with editable weight fields. Each lift is pre-filled with reasonable defaults so a user can confirm and go with zero typing if they happen to match. The user's primary task is adjusting the top-set weight for each lift; the backoff weight auto-derives from it (≈85%). Advanced parameters (increment, minimum weight, rounding factor) use sensible per-lift defaults and don't need to appear on this page.

On confirmation, the app writes the final lift configs to the sheet and proceeds to the workout list as it does today. The setup page is never shown again — it only appears when the config zone is empty.

## Acceptance Criteria

- [ ] When a connected sheet has an empty config zone, the app shows the setup page instead of proceeding directly to the workout list.
- [ ] The setup page displays all four barbell lifts (squat, bench, press, deadlift) with their human-readable names.
- [ ] Each lift shows an editable field for top-set weight, pre-filled with the existing defaults from `defaultLiftConfigs`.
- [ ] Backoff weight is auto-calculated from the top-set weight (≈85%, rounded to the lift's rounding factor) and not shown as a separate input.
- [ ] Advanced parameters (increment, minimum weight, rounding factor) use the existing per-lift defaults and are not exposed on this page.
- [ ] A confirmation action writes the resulting `LiftConfig` values to the sheet via the existing `writeConfigValues()` path.
- [ ] After confirmation, the app navigates to the normal workout list — the setup page does not appear again.
- [ ] The page is usable on a phone screen (thumb-friendly inputs, readable at arm's length).
- [ ] The silent default-writing behavior in the current connection flow is removed; the setup page is the only path for initial config creation.

## Scope

### In scope
- New setup page component shown on first-time connection (empty config zone)
- Editable top-set weight per lift with pre-filled defaults
- Auto-derived backoff weight
- Writing final configs to sheet on confirmation
- Routing change to support showing the setup page at the right moment

### Out of scope
- Editing lift configs after initial setup (future spec)
- Adding, removing, or reordering lifts on this page
- Exposing advanced parameters (increment, minimum weight, rounding factor) to the user
- Account management, user profiles, or onboarding beyond this single page

## Notes

- The setup page sits between sheet connection and the normal app flow. The simplest approach may be a state check (config zone empty → show setup) rather than a new hash route, but that's an implementation decision.
- Backoff weight derivation (≈85%) matches the relationship in the current defaults. The exact ratio and rounding logic should use the same calculation the rest of the app uses.
- Pre-filling with defaults means a user who happens to match them can just tap confirm and go — zero typing required.
- This aligns with the manifesto's "phone-first UI" principle: the setup screen should be fast and minimal, not a long form.

## Iteration log

- The setup page and seed workouts use the canonical exercise IDs from `lib/exercises.json`, including `bench-press`, `overhead-press`, and `skull-crusher`. Seed-data tests enforce that workout and cross-reference IDs resolve to configured exercises.
