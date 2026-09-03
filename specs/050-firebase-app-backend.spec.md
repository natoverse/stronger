# Feature: Firebase application backend

> Replace Google Sheets as Stronger's application database with user-scoped
> Cloud Firestore data while retaining Google authorization only for Calendar
> sync.

## What

Stronger currently uses a short-lived Google OAuth access token for both
application login and every data operation. The app will instead authenticate
with Firebase Authentication and store each user's data below their Firebase
UID in Cloud Firestore. Google API authorization becomes an optional,
task-specific connection used only by Calendar sync.

The application remains a client-side React app hosted on GitHub Pages.

## Acceptance Criteria

- [ ] Firebase Authentication is the application login and persists sessions
  across reloads and browser restarts without a fixed one-hour limit.
- [ ] Firestore is the source of truth for exercises, workout definitions,
  workout logs, schedule data, nutrition data, settings, and imported health
  data.
- [ ] Every document is stored below `/users/{uid}` and security rules prevent
  access to another user's records.
- [ ] A new account can seed the existing default exercises, workouts, and
  cardio activities without a spreadsheet.
- [ ] The web app contains no Google Sheets migration controls.
- [ ] Google Calendar authorization is requested only from a calendar sync
  panel and an expired Calendar token does not sign the user out of Stronger.
- [ ] One Sync button restores or requests Calendar authorization, selects a
  valid writable calendar, and runs synchronization without a connect-then-sync
  click sequence.
- [ ] Existing two-way Calendar synchronization and `strongerId` matching are
  preserved.
- [ ] Garmin activities and Garmin wellness scheduled syncs mirror their
  completed sheet updates into the corresponding Firestore collections.
- [ ] Firebase configuration is supplied through public `VITE_FIREBASE_*`
  environment variables; no service-account credential is shipped to the app.
- [ ] Firestore rules and repository behavior have automated tests.
- [ ] Initial data loading prioritizes only the collections required by the
      active route, then prefetches every remaining collection concurrently.
- [ ] Priority reads for yearly bucket collections fetch only the current
      calendar year; all other years load in the immediate background batch.
- [ ] Schedule and day-flag cold loads fetch 60 days beginning on the first of
      the current month.
- [ ] Both future-calendar expansion controls fetch the next 30-day window;
      loading previous days fetches the preceding 30-day window.

## Firestore Schema

All collections are nested below `/users/{uid}`:

- `exercises/{exerciseId}`
- `workouts/{workoutId}`
- `workoutSessions/{year}`
- `dayFlags/{date}`
- `schedule/{date}`
- `cardioActivities/{activityId}`
- `mealItems/{itemId}`
- `mealLog/{entryId}`
- `favoriteFoods/{barcode}`
- `recentFoods/{barcode}`
- `garminActivities/{year}`
- `garminWellness/{year}`
- `withingsMeasurements/{year}`
- `settings/app`

The user document stores `schemaVersion`, setup state, and timestamps. Source
identifiers are retained as document IDs. Each workout session is one document
with ordered `exercises` and nested `sets` arrays, matching the collapsed
structure used for workout templates. The Firebase adapter flattens these
documents into the existing `ParsedLogRow[]` interface until the application
model adopts the nested session type directly.

Each schedule document represents one date and contains an ordered `events`
array. The Firebase adapter flattens those documents into the existing
`WorkoutScheduleEntry[]` interface for calendar and planning code.

Workout sessions, Garmin activities, Garmin wellness, and Withings
measurements use yearly `{ period, count, entries }` bucket documents. The
Firebase adapter flattens these buckets for the existing application models;
workout session mutations update only the affected year.

## Security and Quotas

Firestore rules require an authenticated UID matching the path UID. Normal
views query only required collections or date ranges; they do not attach
whole-history real-time listeners. Firebase's public web configuration is not a
secret. Administrative sync credentials remain restricted to GitHub Actions.

## Rollout

The migration action in spec 049 runs before this backend switch. Existing
Sheets remain the ingestion ledger and backup during stabilization. Garmin and
Garmin Wellness workflows mirror only their own completed collections into
Firestore after each successful sync.

## Iteration Decisions

- The deprecated Strava collection and write helper were removed. Activity
  views read Garmin data; the remaining `StravaActivity` type name is legacy
  shared chart terminology rather than a Strava data dependency.
- Workout history is stored atomically as one nested document per session
  instead of carrying the legacy Google Sheets row boundary into Firestore.
  Session edits and deletes therefore require one document operation.
- Scheduled workouts are stored as one document per day with an ordered events
  array, rather than one document per legacy sheet row.
- Authentication no longer blocks on exercises, workouts, and cardio reads.
  The active route selects a priority collection batch from
  `lib/firebase-load-plan.json`; only after that batch completes does one
  `Promise.all` prefetch every remaining collection and update the user
  metadata document. This guarantees, for example, that a direct Garmin
  activities load requests `garminActivities` before unrelated collections.
  The active view retains its loading state until that priority batch finishes,
  avoiding a false empty-state flash while background prefetch continues.
- The benchmark consumes the same route load plan. Sheets retains its
  full-range baseline while Firestore cold-load timing reads only the current
  year for yearly datasets.
- Yearly bucket datasets are split by load scope. Active-route cold start reads
  only the current-year document for workout sessions, Garmin activities,
  Garmin wellness, and Withings measurements. The immediate deferred batch
  reads every other year while unrelated datasets prefetch concurrently.
- Schedule and day flags use document-ID range queries instead of full
  collection reads. The initial window is 60 days beginning on the first of
  the current month so the default month view includes past schedule and flag
  data. "Show next month" and "Load more days" share one action that expands
  both calendar presentations and fetches the next 30 days; previous-day
  loading fetches 30 days backward.
- Schedule and day-flag mutations write only affected date documents. This
  prevents partially loaded client state from deleting dates outside the
  loaded windows.
- Calendar mutations are serialized and hydrate their affected Firestore date
  range before applying changes. Bulk planning, clearing, and Calendar sync
  therefore preserve entries that were not part of the cold-start window.
- Every yearly bucket dataset loads historical years in the immediate deferred
  batch, regardless of the entry route. Navigating after startup therefore
  cannot leave history-backed views permanently limited to the current year.
- Initial signed-out authentication preserves deep links and workout drafts.
  Full state reset runs only after an authenticated user disconnects.
- The monthly calendar initially renders only the current month. Its 60-day
  data window therefore covers every visible day; each forward control loads
  30 more days before appending another complete month.
- Clearing scheduled workouts requests Calendar authorization before deleting
  linked and orphaned Stronger events, and reports authorization failures
  instead of silently leaving events behind.
- Scheduled Withings mirroring is deferred to separate workflow migration
  work. The one-time migration still imports existing Withings measurements,
  and the Firebase UI continues to read the migrated yearly buckets.
- Firebase Authentication initializes with IndexedDB, local-storage, and
  session-storage persistence fallbacks. Firebase rotates its one-hour ID token
  automatically through the long-lived refresh token; the application session
  remains until explicit sign-out, revocation, account changes, or browser
  storage removal rather than using a custom 30-day timeout.
- Google Calendar authorization is a separate, incremental OAuth flow. Opening
  the Calendar view prepares the Google SDK without requesting authorization;
  pressing the single Sync button restores an unexpired Calendar token or
  requests a new one, validates the saved calendar against the current account,
  and performs the sync in the same action.
- Calendar OAuth tokens and account hints are cleared whenever the Firebase
  user signs out, changes, or reaches the app without a persisted Firebase
  session, preventing one Stronger user from inheriting another user's Google
  Calendar destination.
- Calendar access requests only event read/write and calendar-list read scopes;
  Firebase startup requests no Calendar or Sheets API scopes.
