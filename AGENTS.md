# Agent Notes — Stronger

Operational reminders for AI agents working on this project. Read this before starting any task.

## Project overview

Stronger is a barbell training tracker built as a single-page React app. It uses Firebase Authentication and Cloud Firestore for user-scoped application data. Separate GitHub Actions workflows import Garmin and Withings data directly into Firestore. Google Calendar synchronization uses optional, separate Google OAuth authorization. The app is deployed to GitHub Pages.

## Tech stack

- **React 19** + **TypeScript 5.7**, bundled with **Vite 6**
- **Vitest 4** for unit tests (`npm test`)
- **lucide-react** for icons
- No component library, no CSS framework — all styles in `src/App.css` using CSS custom properties
- Hosted on **GitHub Pages** at `/stronger/` (see `vite.config.ts` `base`)
- Firebase SDK for Authentication and Firestore
- Google Calendar API via `gapi.client.calendar` loaded at runtime

## Development workflow

- **Spec-driven development.** Every feature starts with a spec in `specs/`. Completed specs live in `.archive/specs/`. Always read the relevant spec before implementing.
- **Push to main.** The user does not use PRs for most work — commit and push directly.
- **Tests matter.** Run `npx vitest run` before pushing. The test suite is expected to pass cleanly.
- **Update specs after iteration.** If you make decisions beyond what the spec says, append a summary to the spec (even if archived).

## Architecture

### Data model (`src/model/types.ts`)

Core types, each building on the previous:

1. **LiftConfig** — per-lift settings (weights, increments, gear). Stored in `exercises`.
2. **SetTemplate / ExerciseTemplate** — the structure of a workout (set types, percentages, rep ranges, roles). Stored in `workouts`.
3. **ComputedSet / ComputedExercise** — concrete workout instances with calculated weights. Computed at runtime, never stored.
4. **Workout** — a named collection of computed exercises with a `favorite` flag.
5. **PreviousSetData** — previous-session weight/reps for comparison. Ephemeral.
6. **SetResult** — execution-time tracking of what the user actually did. Logged to `workoutSessions`.
7. **DayFlags** — boolean flags for calendar days (`home`, `elsewhere`, `travel`, `visitors`, `alcohol`, `blocked`).
8. **DayFlagEntry** — date + DayFlags. Stored in `dayFlags`.
9. **WorkoutScheduleEntry** — date→workoutId mapping with calendar sync fields (`calendarEventId`, `strongerId`). Stored in `schedule`.
10. **CardioActivity** — simple `{id, name}` for cardio activities. Stored in `cardioActivities`.
11. **StravaActivity** — legacy name of the shared activity model used for Garmin data (timestamp, type, duration, distance, elevation, HR, etc.). Stored in `garminActivities`.
12. **ProgressionProposal** — post-workout weight-change suggestions. Ephemeral, never stored.

### Firestore storage (`src/firebase/store.ts`)

Application collections live below `/users/{uid}`. Security rules require the
authenticated UID to match that path.

| Collection | Document structure |
|---|---|
| `exercises` | One document per exercise ID |
| `workouts` | One document per workout ID with nested exercises and sets |
| `workoutSessions` | Stable session documents; existing yearly buckets remain readable |
| `dayFlags` | One document per date |
| `schedule` | One document per date with an ordered `events` array |
| `cardioActivities` | One document per activity ID |
| `garminActivities` | Yearly `{ period, count, entries, updatedAt }` buckets |
| `garminWellness` | Yearly buckets of daily wellness entries |
| `withingsMeasurements` | Yearly buckets of measurements |
| `settings/app` | Application preferences, goals, and verified Calendar selection |

Keep named fields consistent across the domain types, Firestore adapter, and
administrative sync writers. Python bucketing takes an explicit `date_field`:
activities use `timestamp`, while wellness uses `date`.

### Offline behavior

Firestore uses persistent multi-tab caching. Route-priority reads follow
`lib/firebase-load-plan.json`, then background warming fetches every dataset.
Writes use Firestore's durable queue plus a user-scoped pending-mutation tracker
in `src/firebase/offline.ts`. Calendar operations remain online-only.

### Routing (`src/hooks/useHashRouter.ts`)

Hash-based SPA router. Routes:
- `#/` — workout list (home)
- `#/workout/<id>` — workout execution
- `#/calendar` — calendar view
- `#/edit/<id>` or `#/edit/new` — workout editor
- `#/exercises` — exercise library
- `#/exercise/<id>` or `#/exercise/new` — exercise editor
- `#/progress` — progress charts
- `#/settings` — settings and sign out

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
- `SettingsView` — workout preferences and sign out
- `GoogleAuth` — Firebase sign-in, synchronization status, nav bar
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

Default data loaded from JSON files in `lib/`. Users explicitly confirm importing
starter workouts; missing workout definitions do not silently overwrite or seed
workouts. Firestore remains the source of truth.

- `lib/exercises.json` — default lift configurations
- `lib/workouts.json` — default workout definitions
- `lib/cardio.json` — cardio activity definitions
- `lib/quotes.json` — motivational quotes

### Garmin sync (`scripts/garmin-sync.py`)

An hourly Python workflow authenticates to Garmin Connect using `garminconnect`
and a saved `GARMIN_TOKENS` bundle, then writes activities directly to Firestore.
`garmin-wellness-sync.py` imports daily wellness and goals. Both use
`FIREBASE_SERVICE_ACCOUNT_KEY` and `FIREBASE_USER_ID`, with optimistic concurrency
to preserve unrelated entries. See [GARMIN_SYNC_SETUP.md](GARMIN_SYNC_SETUP.md).
Dependencies are in `scripts/requirements.txt`; offline tests are in
`scripts/test_garmin_sync.py` and `scripts/test_garmin_wellness_sync.py`.

### Withings sync (`scripts/withings-sync.mjs`)

A daily workflow writes measurements directly to Firestore. The rotating refresh
token is stored in the administrator-only `/syncState/{uid}` document, outside
the browser-readable user tree. See [WITHINGS_SYNC_SETUP.md](WITHINGS_SYNC_SETUP.md).

### GitHub Actions (`.github/workflows/`)

- `deploy.yml` — builds and deploys to GitHub Pages on push to main
- `garmin-sync.yml` — hourly Garmin activities → Firestore sync
- `garmin-wellness-sync.yml` — hourly Garmin wellness → Firestore sync
- `withings-sync.yml` — daily Withings → Firestore body-composition sync
- `garmin-gaia-sync.yml` — nightly Garmin-to-Gaia activity sync
- `garmin-gpx-export.yml` — manual Garmin GPX export
- `auto-spec-issues.yml` — creates GitHub issues from new spec files
- `auto-archive-specs.yml` — moves spec files to `.archive/specs/` when their issue is closed

## Common pitfalls

- **Firestore permissions** — browser access uses Firebase rules; administrative workflows use IAM and bypass those rules.
- **Partial reads** — schedule changes must preserve dates outside the loaded window; history loading must include older years.
- **Calendar authorization** — Calendar token expiry must never clear a Firebase application session or retry Firestore writes through Google OAuth.
- **Service-account credentials** — never place administrative keys in browser configuration or committed source.
