# Agent Notes — Stronger

Operational reminders for AI agents working on this project. Read this before starting any task.

## Project overview

Stronger is a barbell training tracker built as a single-page React app. It uses Google Sheets as its database — there is no backend. The app authenticates via Google OAuth, reads/writes lift configs, workout definitions, log entries, schedule data, and cardio activities directly to named tabs in the user's spreadsheet. A separate GitHub Actions workflow syncs Strava activity data into another sheet tab. The app is deployed to GitHub Pages.

## Tech stack

- **React 19** + **TypeScript 5.7**, bundled with **Vite 6**
- **Vitest 4** for unit tests (`npm test`)
- **lucide-react** for icons
- No component library, no CSS framework — all styles in `src/App.css` using CSS custom properties
- Hosted on **GitHub Pages** at `/stronger/` (see `vite.config.ts` `base`)
- Google Sheets API via `gapi.client.sheets` loaded at runtime (no npm package)

## Development workflow

- **Spec-driven development.** Every feature starts with a spec in `specs/`. Completed specs live in `.archive/specs/`. Always read the relevant spec before implementing.
- **Push to main.** The user does not use PRs for most work — commit and push directly.
- **Tests matter.** Run `npx vitest run` before pushing. The 4 storage tests fail due to missing `document` in the test environment — that is pre-existing and expected.
- **Update specs after iteration.** If you make decisions beyond what the spec says, append a summary to the spec (even if archived).

## Architecture

### Data model (`src/model/types.ts`)

Core types, each building on the previous:

1. **LiftConfig** — per-lift settings (weights, increments, gear). 9 fields. Stored in the "Exercises" sheet tab.
2. **SetTemplate / ExerciseTemplate** — the structure of a workout (set types, percentages, rep ranges, roles). Stored in the "Workouts" sheet tab.
3. **ComputedSet / ComputedExercise** — concrete workout instances with calculated weights. Computed at runtime, never stored.
4. **Workout** — a named collection of computed exercises with a `favorite` flag.
5. **PreviousSetData** — previous-session weight/reps for comparison. Ephemeral.
6. **SetResult** — execution-time tracking of what the user actually did. Logged to the "Log" sheet tab.
7. **DayFlags** — boolean flags for calendar days (`home`, `elsewhere`, `travel`, `visitors`, `alcohol`, `blocked`).
8. **DayFlagEntry** — date + DayFlags. Stored in the "Schedule" sheet tab (flags only).
9. **WorkoutScheduleEntry** — date→workoutId mapping with calendar sync fields (`calendarEventId`, `strongerId`). Stored in the "Workout Schedule" sheet tab.
9. **CardioActivity** — simple `{id, name}` for cardio activities. Stored in the "Cardio" sheet tab.
10. **StravaActivity** — synced Strava activity data (date, type, duration, distance, elevation, HR, etc.). Stored in the "Strava" sheet tab.
11. **ProgressionProposal** — post-workout weight-change suggestions. Ephemeral, never stored.

### Google Sheets tabs and ranges (`src/google/sheets.ts`, `src/google/config.ts`)

The app uses seven tabs in the user's spreadsheet. Each tab has a header constant, a range constant, and serialization/deserialization functions.

| Tab name                | Range constant(s)     | Header columns | Column span |
|-------------------------|-----------------------|----------------|-------------|
| `Stronger - Exercises`  | `CONFIG_RANGE = A:I`  | 9 (`id` → `gear`) | A–I |
| `Stronger - Workouts`   | `WORKOUT_DEFS_RANGE = A:M` | 13 (`workoutId` → `favorite`) | A–M |
| `Stronger - Log`        | `LOG_READ_RANGE = A2:M`, `LOG_HEADER_RANGE = A1:M1`, `LOG_APPEND_RANGE = A2:M2` | 13 (`date` → `completed`) | A–M |
| `Stronger - Schedule`   | `SCHEDULE_READ_RANGE = A2:G10000`, `SCHEDULE_FULL_RANGE = A1:G10000` | 7 (`date`, `home`, `elsewhere`, `travel`, `visitors`, `alcohol`, `blocked`) | A–G |
| `Stronger - Workout Schedule` | `WORKOUT_SCHEDULE_READ_RANGE = A2:D10000`, `WORKOUT_SCHEDULE_FULL_RANGE = A1:D10000` | 4 (`date`, `workoutId`, `calendarEventId`, `strongerId`) | A–D |
| `Stronger - Cardio`     | `CARDIO_RANGE = A:B`  | 2 (`id`, `name`) | A–B |
| `Stronger - Strava`     | `STRAVA_SYNC_RANGE = A:J`, `STRAVA_HEADER_RANGE = A1:J1`, `STRAVA_READ_RANGE = A2:J` | 10 (`date` → `maxHR`) | A–J |
| `Stronger - Garmin`     | Written by `scripts/garmin-sync.py` (`HEADER`, `A:S`); read by the app via `readGarminActivities` (`GARMIN_READ_RANGE = A2:S`) | 19 (`date` → `vo2Max`) | A–S |

### Critical rule: keep ranges in sync with the data model

**When you add or remove a column from any header constant, you must update the corresponding range constants to match.** The letter in the range (e.g., `M` in `A2:M`) must cover all columns in the header array. If the header has 13 entries, the range must end at column M (the 13th column). If you add a 14th column, update every range for that tab to end at N.

The header arrays also serve as the human-readable column names in the actual spreadsheet. Use clear, descriptive field names — these are visible to the user when they open the sheet.

Use the formula: column letter = `String.fromCharCode(64 + columnCount)` (A=1, B=2, ... Z=26).

### Routing (`src/hooks/useHashRouter.ts`)

Hash-based SPA router. Routes:
- `#/` — workout list (home)
- `#/workout/<id>` — workout execution
- `#/calendar` — calendar view
- `#/edit/<id>` or `#/edit/new` — workout editor
- `#/exercises` — exercise library
- `#/exercise/<id>` or `#/exercise/new` — exercise editor
- `#/progress` — progress charts
- `#/settings` — settings (Hevy import, disconnect)

When adding a new view, add its route type to the `Route` union, update `parseHash`, and update `routeToHash`.

### Component structure (`src/components/`)

- `WorkoutSelect` — home screen, workout list with favorites
- `WorkoutView` — workout execution (sets, reps, checkboxes)
- `WorkoutEditor` — create/edit workout definitions
- `CalendarView` — schedule workouts to dates, history mode, day flags
- `CalendarPush` — weekly planner + push scheduled workouts to Google Calendar
- `ProgressView` — SVG line charts for progress metrics (volume, heaviest, e1RM)
- `ProgressionReview` — post-workout weight increase proposals
- `ExerciseLibrary` — browse and manage exercises
- `ExerciseEditor` — create/edit individual exercise configs
- `SettingsView` — Hevy CSV import, disconnect sheet
- `GoogleAuth` — OAuth sign-in, sheet connection, nav bar
- `SetupPage` — first-time setup wizard
- `MotivationalQuote` — random quotes display
- `Banner` / `Logo` / `LiftBadge` — branding and visual elements

### App orchestration (`src/App.tsx`)

`App.tsx` is the top-level component. It owns all state (workouts, configs, definitions, schedule, active workout) and passes callbacks down.

### Styling (`src/App.css`)

Neon design language using CSS custom properties:
- `--color-primary: #00e5ff` (neon cyan)
- `--color-accent: #ff2d7b` (neon pink)
- `--color-bg: #000` (black background)
- `--color-surface: #0a0a0a` (card backgrounds)
- Role-based set colors: `--color-warmup`, `--color-work`, `--color-backoff`, `--color-joker`

### Seed data (`lib/`)

Default data loaded from JSON files in `lib/` and used as seed data when a user connects a fresh spreadsheet. After first connect, the sheet is the source of truth.

- `lib/exercises.json` — default lift configurations
- `lib/workouts.json` — default workout definitions
- `lib/cardio.json` — cardio activity definitions
- `lib/quotes.json` — motivational quotes

### Garmin sync (`scripts/garmin-sync.py`)

A Python script run by the `garmin-sync.yml` GitHub Actions workflow on a daily cron (also runnable on any machine with `python`). It authenticates to Garmin Connect using `python-garminconnect` (the maintained client GarminDB now uses) resuming from a saved token bundle (`GARMIN_TOKENS` secret, minted once via a headless local login), fetches recent activities, then appends new rows to a dedicated "Stronger - Garmin" sheet tab via a Google service account. Garmin exposes richer metrics than Strava did (moving duration, elevation loss, speeds, steps, training effect, VO2 max), so the tab uses a Garmin-native schema rather than reusing the Strava columns. The legacy "Stronger - Strava" tab is deprecated gradually; the app now exposes a dedicated Garmin activities view (`#/garmin`, a toolbar tab next to Activities) that reads this tab so the two sources can be compared. See [GARMIN_SYNC_SETUP.md](GARMIN_SYNC_SETUP.md) and `specs/031-garmin-direct-sync.spec.md` for details. Deps in `scripts/requirements.txt`; offline mapping tests in `scripts/test_garmin_sync.py`.

### Sheet backup (`scripts/sheet-backup.py`)

A Python script run by the `sheet-backup.yml` GitHub Actions workflow on a daily cron (also runnable on any machine with `python`). It authenticates with a Google service account and copies every tab's values from the source spreadsheet (`SOURCE_SPREADSHEET_ID`, mapped from the `SPREADSHEET_ID` secret) into a separate backup spreadsheet (`BACKUP_SPREADSHEET_ID` secret): missing tabs are created, matching tabs are cleared and rewritten. This replaces the old in-app "backup after each workout save" logic (removed `src/google/backup.ts` and `runBackup` in `App.tsx`). See [SHEET_BACKUP_SETUP.md](SHEET_BACKUP_SETUP.md) and `specs/034-sheet-backup-action.spec.md`. Offline tests in `scripts/test_sheet_backup.py`.

### GitHub Actions (`.github/workflows/`)

- `deploy.yml` — builds and deploys to GitHub Pages on push to main
- `garmin-sync.yml` — daily Garmin Connect → Google Sheets sync
- `withings-sync.yml` — daily Withings → Google Sheets body-composition sync
- `sheet-backup.yml` — daily copy of the source spreadsheet to a backup spreadsheet
- `auto-spec-issues.yml` — creates GitHub issues from new spec files
- `auto-archive-specs.yml` — moves spec files to `.archive/specs/` when their issue is closed

## Common pitfalls

- **Sheet API 400 errors** usually mean a range doesn't cover enough columns for the data being written. Check that the range letter matches the header length.
- **Open-ended ranges** (e.g., `A:I`) are preferred for reading — they don't silently truncate if more rows exist than expected. The schedule tab is an exception and uses a row limit.
- **Old log rows** — rows written before schema changes may have fewer columns. Parse functions should handle missing columns gracefully with defaults.
- **Strava sync 404** — usually means the `SPREADSHEET_ID` repo secret is missing or wrong. The service account also needs Editor access to the spreadsheet.
