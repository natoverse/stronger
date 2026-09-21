# Stronger

## Auth-free review mode

Append `?mock=1` before the hash route to open the app with deterministic mock
data and no Firebase login:

```text
http://localhost:5173/stronger/?mock=1#/calendar
```

Run `npm run test:screenshots` to capture the representative PR screenshots in
`artifacts/screenshots/`. Pull requests run the same Playwright suite and
embed the screenshots in a reusable PR comment. The HTML report remains
available as a workflow artifact for diagnostics.

A barbell training tracker. Single-page React app with Firebase Authentication and Cloud Firestore, deployed to GitHub Pages.

**This project is opinionated.** It reflects one person's planning style and training preferences. No human code is written — all code is authored by AI agents working from specs and deployed through GitHub Actions.

## How it works

1. Sign in with Google through Firebase Authentication.
2. Set up your exercises and import starter workouts if needed.
3. Pick a workout, execute it, and log results in your user-scoped Firestore data.
4. Optionally connect Google Calendar to synchronize your workout schedule.

## Setup

See **[Firebase Setup](FIREBASE_SETUP.md)** for application and shared-project
configuration. Optional Calendar synchronization uses the separate
**[Google Calendar OAuth Setup](GOOGLE_SETUP.md)**.

## Cycles and default programs

A cycle contains one planned workout per program week. Create separate cycles
for additional weekly workouts. Confirmed exercise completion advances the plan;
missing a calendar date does not skip a week.

Expand **Default program library** on the workout page to copy a repository
program into an editable draft, then save it to your library. Copies get fresh
identities and never overwrite your workouts, progress, or shared exercise weights.
The library remains available even after setup. Starter workouts live in
`lib/workouts.json`; `lib/531.json` supplies four classic four-week 5/3/1 cycles
for squat, bench press, deadlift, and overhead press.

For 5/3/1, set each lift's **Training Max** in its exercise editor. The optional
**Set starting TM from 1RM (90%)** calculator applies the 90% modifier once:
a 200 lb 1RM becomes a 180 lb TM. Each set then uses its percentage of TM,
not another 90% reduction. A blank TM still defaults to top-set weight, which
is not assumed to be 1RM. Warmups are 40% × 5, 50% × 5, and 60% × 3 each week;
the work sets follow the classic 5s, 3s, 5/3/1, and deload progression.
Existing rounding and minimum-weight settings apply, so check the preview,
especially for light warmups and deloads. TM increases remain reviewed after
completing the deload: 10 lb for squat/deadlift and 5 lb for bench/press by default.

Older multi-session week definitions open as successive single-workout weeks
without dropping prescriptions. Already-started iterations and historical
workouts retain their original frozen prescriptions.

## Development model

- **Spec-driven.** Every feature starts as a spec in `specs/`. Completed specs live in `.archive/specs/`.
- **AI-authored.** Agents implement features from specs. The human role is directing, reviewing, and iterating.
- **Push to main.** No PR workflow for most changes.

## Tech stack

React 19 · TypeScript 5.7 · Vite 6 · Vitest · Firebase Authentication · Cloud Firestore · GitHub Pages

## Project docs

| File | Purpose |
|------|---------|
| [MANIFESTO.md](MANIFESTO.md) | Vision, principles, scope |
| [GOOGLE_SETUP.md](GOOGLE_SETUP.md) | Optional Google Calendar OAuth configuration |
| [FIREBASE_SETUP.md](FIREBASE_SETUP.md) | Firebase runtime and administration setup |
| [GARMIN_SYNC_SETUP.md](GARMIN_SYNC_SETUP.md) | Activity data sync from Garmin Connect |
| [AGENTS.md](AGENTS.md) | Operational notes for AI agents |
