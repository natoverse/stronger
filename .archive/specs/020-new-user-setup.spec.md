# Feature: New user setup page

> Give first-time users a single screen to enter their working weights for the four barbell lifts before exercise configuration is persisted, replacing silent defaults.

## What

The original setup silently wrote default lift configs for a new user. Those defaults were unlikely to match anyone's actual working weights, so the user had to go find and fix them later.

This spec adds a setup page that appears once — after Firebase sign-in and a successful empty exercise load, but before the normal app flow — showing the four default barbell lifts (squat, bench, press, deadlift) with editable weight fields. Each lift is pre-filled with reasonable defaults so a user can confirm and go with zero typing if they happen to match. The user's primary task is adjusting the top-set weight for each lift; the backoff weight auto-derives from it (≈85%). Advanced parameters (increment, minimum weight, rounding factor) use sensible per-lift defaults and don't need to appear on this page.

On confirmation, the app writes the final lift configs to Firestore and proceeds to the workout list. The setup page only appears when the user's exercise configuration is empty.

## Acceptance Criteria

- [ ] When the current user's exercise collection is confirmed empty, the app shows setup instead of proceeding directly to the workout list.
- [ ] The setup page displays all four barbell lifts (squat, bench, press, deadlift) with their human-readable names.
- [ ] Each lift shows an editable field for top-set weight, pre-filled with the existing defaults from `defaultLiftConfigs`.
- [ ] Backoff weight is auto-calculated from the top-set weight (≈85%, rounded to the lift's rounding factor) and not shown as a separate input.
- [ ] Advanced parameters (increment, minimum weight, rounding factor) use the existing per-lift defaults and are not exposed on this page.
- [ ] A confirmation action persists the resulting `LiftConfig` values through the Firestore configuration-write path.
- [ ] After confirmation, the app navigates to the normal workout list — the setup page does not appear again.
- [ ] The page is usable on a phone screen (thumb-friendly inputs, readable at arm's length).
- [ ] The silent default-writing behavior in the current connection flow is removed; the setup page is the only path for initial config creation.

## Scope

### In scope
- New setup page component shown for first-time users with empty configuration
- Editable top-set weight per lift with pre-filled defaults
- Auto-derived backoff weight
- Writing final configs to Firestore on confirmation
- Routing change to support showing the setup page at the right moment

### Out of scope
- Editing lift configs after initial setup (future spec)
- Adding, removing, or reordering lifts on this page
- Exposing advanced parameters (increment, minimum weight, rounding factor) to the user
- Account management, user profiles, or onboarding beyond this single page

## Notes

- The setup page sits between Firebase sign-in/data loading and the normal app flow. An empty-configuration state check can show setup without a new hash route; failed loads must not be mistaken for empty data.
- Backoff weight derivation (≈85%) matches the relationship in the current defaults. The exact ratio and rounding logic should use the same calculation the rest of the app uses.
- Pre-filling with defaults means a user who happens to match them can just tap confirm and go — zero typing required.
- This aligns with the manifesto's "phone-first UI" principle: the setup screen should be fast and minimal, not a long form.

## Iteration log

- The setup page and seed workouts use the canonical exercise IDs from `lib/exercises.json`, including `bench-press`, `overhead-press`, and `skull-crusher`. Seed-data tests enforce that workout and cross-reference IDs resolve to configured exercises.
- **Firestore-only (2026-09-15):** Initial configuration is scoped to the authenticated UID. Setup retains explicit weight confirmation and never treats a failed read as permission to overwrite user data.
