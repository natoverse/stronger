# Stronger

A barbell training tracker. Single-page React app, Google Sheets as the database, deployed to GitHub Pages. No backend.

**This project is opinionated.** It reflects one person's planning style and training preferences. No human code is written — all code is authored by AI agents working from specs and deployed through GitHub Actions.

## How it works

1. Sign in with Google OAuth.
2. Connect (or create) a Google Sheet — the app reads/writes workout data directly to named tabs.
3. Pick a workout, execute it, log results. The sheet is both storage and audit trail.

## Setup

For the current Google Sheets application, see
**[Google OAuth Setup](GOOGLE_SETUP.md)**. For the Firebase backend rollout,
shared project configuration, and one-time migration, see
**[Firebase Setup](FIREBASE_SETUP.md)**.

## Development model

- **Spec-driven.** Every feature starts as a spec in `specs/`. Completed specs live in `.archive/specs/`.
- **AI-authored.** Agents implement features from specs. The human role is directing, reviewing, and iterating.
- **Push to main.** No PR workflow for most changes.

## Tech stack

React 19 · TypeScript 5.7 · Vite 6 · Vitest · Google Sheets API · GitHub Pages

## Project docs

| File | Purpose |
|------|---------|
| [MANIFESTO.md](MANIFESTO.md) | Vision, principles, scope |
| [GOOGLE_SETUP.md](GOOGLE_SETUP.md) | OAuth and Sheets configuration |
| [FIREBASE_SETUP.md](FIREBASE_SETUP.md) | Firebase runtime, administration, and migration setup |
| [GARMIN_SYNC_SETUP.md](GARMIN_SYNC_SETUP.md) | Activity data sync from Garmin Connect |
| [AGENTS.md](AGENTS.md) | Operational notes for AI agents |
