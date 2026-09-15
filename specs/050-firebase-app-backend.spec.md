# Feature: Firebase application backend

> Store Stronger's application data in user-scoped Cloud Firestore while
> retaining separate Google authorization only for Calendar sync.

## What

Stronger authenticates with Firebase Authentication and stores each user's data
below their Firebase UID in Cloud Firestore. Google API authorization is an
optional, task-specific connection used only by Calendar sync.

The application remains a client-side React app hosted on GitHub Pages.

## Acceptance Criteria

- [ ] Firebase Authentication is the application login and persists sessions
  across reloads and browser restarts without a fixed one-hour limit.
- [ ] Firestore is the source of truth for exercises, workout definitions,
  workout logs, schedule data, settings, and imported health
  data.
- [ ] Every document is stored below `/users/{uid}` and security rules prevent
  access to another user's records.
- [ ] A new account can seed the existing default exercises, workouts, and
  cardio activities in Firestore.
- [ ] The web app exposes only the Firestore application backend.
- [ ] Google Calendar authorization is requested only from a calendar sync
  panel and an expired Calendar token does not sign the user out of Stronger.
- [ ] Calendar authorization loads writable calendars without synchronizing;
  the user explicitly selects a calendar before the first sync.
- [ ] The verified calendar selection is stored in Firebase and reused on
  later sessions.
- [ ] Selecting the wrong calendar cannot delete Firestore schedule entries.
- [ ] Existing two-way Calendar synchronization and `strongerId` matching are
  preserved.
- [ ] Garmin activities, Garmin wellness, and Withings scheduled syncs write
  directly into the corresponding Firestore collections.
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

## Persistence

Firestore is the sole application and health-ingestion data store. Administrative
syncs write directly to their own collections, preserving records outside each
fetch window. Browser access and Calendar authorization remain independent.

## Iteration Decisions

- The deprecated Strava collection and write helper were removed. Activity
  views read Garmin data; the remaining `StravaActivity` type name is legacy
  shared chart terminology rather than a Strava data dependency.
- Workout history is stored atomically as one nested document per session
  rather than treating individual sets as independent persistence boundaries.
  Session edits and deletes therefore require one document operation.
- Scheduled workouts are stored as one document per day with an ordered events
  array, rather than one document per event.
- Authentication no longer blocks on exercises, workouts, and cardio reads.
  The active route selects a priority collection batch from
  `lib/firebase-load-plan.json`; only after that batch completes does one
  `Promise.all` prefetch every remaining collection and update the user
  metadata document. This guarantees, for example, that a direct Garmin
  activities load requests `garminActivities` before unrelated collections.
  The active view retains its loading state until that priority batch finishes,
  avoiding a false empty-state flash while background prefetch continues.
- Firestore cold-load reads use the shared route load plan and read only the
  current year for yearly datasets.
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
- Scheduled Withings ingestion writes directly to yearly Firestore buckets,
  which the Firebase UI reads alongside Garmin data.
- Firebase Authentication initializes with IndexedDB, local-storage, and
  session-storage persistence fallbacks. Firebase rotates its one-hour ID token
  automatically through the long-lived refresh token; the application session
  remains until explicit sign-out, revocation, account changes, or browser
  storage removal rather than using a custom 30-day timeout.
- Google Calendar authorization is a separate, incremental OAuth flow. Opening
  the Calendar view prepares the Google SDK without requesting authorization.
  Connecting restores or requests Calendar access and loads the writable
  calendar list, but never starts synchronization. The user selects a calendar
  and starts sync separately.
- Calendar OAuth tokens and account hints are cleared whenever the Firebase
  user signs out, changes, or reaches the app without a persisted Firebase
  session, preventing one Stronger user from inheriting another user's Google
  Calendar destination.
- Calendar access requests only event read/write and calendar-list read scopes;
  Firebase startup requests no Calendar API scopes.
- The selected calendar is persisted as `calendar.syncCalendarId` in the
  Firebase settings document after the first verified sync. An unverified
  browser cookie cannot preselect a calendar.
- A first sync against legacy linked entries must match at least one existing
  event before the calendar is trusted. Missing event IDs are treated as
  deletions only on subsequent syncs against that verified calendar, preventing
  an accidental primary-calendar selection from erasing the Firebase schedule.
- Calendar discovery covers a recovery window even when the Firebase schedule
  is empty. Unmatched events carrying a Stronger ID are pulled back into
  Firestore, using the workout ID embedded in their deep link when the event
  title is a custom label.
- Default workout import for the Firebase backend assigns fresh generated IDs
  to starter workouts and adds them without deleting or replacing existing
  workout documents. Target IDs are checked transactionally before writing.
- Duplicating a workout opens an unsaved editor draft. The copied template is
  not added to Firestore unless the user clicks Save.

## Startup Reliability Iteration (2026-09-05)

- Authentication restoration and route-priority Firestore loading expose
  distinct status messages so a stalled phase can be identified.
- Firebase authentication restoration has a bounded deadline and observes
  explicit SDK errors. Popup sign-in also returns to a retryable state if its
  promise never settles.
- The authentication observer remains mounted while priority data loads,
  avoiding a second persistence restoration cycle between sign-in and app
  rendering.
- Every startup dataset load has a bounded deadline. Priority failures show the
  existing retry screen; deferred failures are logged, evicted from the
  request cache, and do not replace an already-rendered route.
- Route load queues are keyed by user and route, with a generation guard so an
  obsolete queue cannot clear or fail the current route's loading state.
- Default cardio activities populate local state immediately and persist in
  the background rather than placing a Firestore write in the startup barrier.

## Offline Mode Iteration (2026-09-08)

- Firestore uses persistent IndexedDB caching with multi-tab coordination.
  Route-priority data is read from cache first and rendered before a bounded
  server refresh starts in the background.
- The application shell is precached by a generated, versioned service worker.
  A previously visited deployment therefore starts without network access.
- Browser writes use Firestore's durable local queue and a user-scoped IndexedDB
  outbox tracks pending entities for status, coalescing, and reconnect retries.
- Workout sessions are written as stable per-session documents. Existing yearly
  bucket documents remain readable during migration, while new session writes
  no longer depend on online-only transactions.
- Authentication restoration relies on Firebase's persisted local user.
  Network unavailability is an offline state, not a sign-out condition.
- Offline, syncing, pending-write, last-synced, and reauthentication states are
  non-blocking toolbar status. Calendar operations remain online-only.

## Firestore-only Cleanup (2026-09-15)

- Retire the former persistence client, connection helpers, API configuration,
  migration tooling, comparison workflows, and their storage-specific tests.
  Existing Firestore documents are not rewritten or deleted by this cleanup.
- Move shared log models, previous-workout lookup, settings, and goal conversion
  helpers into the application domain layer so Firestore and views do not depend
  on an obsolete backend module.
- Use Firebase user identity and connection terminology throughout the app.
  Firestore operations must not trigger Calendar authorization or its token
  retries; Calendar synchronization retains its separate authorization flow.
- Preserve shared helper coverage, offline queued writes, user-scoped security
  rules, and direct Garmin/Withings synchronization. Administrative authentication
  and Firestore serialization remain available independently of retired tools.
- Update setup instructions, operational notes, and feature specs to describe
  the current architecture; remove specs dedicated solely to retired tooling.
