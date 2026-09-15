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
