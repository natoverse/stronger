# Feature: Cloud Firestore data backend (replacing Google Sheets storage)

## What

Stronger currently stores every piece of user data as rows in named tabs of a
Google Spreadsheet (see `AGENTS.md` → "Google Sheets tabs and ranges"). The
sheet is the database: the app reads whole tabs into memory and filters /
aggregates client-side, and external sync scripts append rows via the Sheets
API. This works but has real limits:

- **Whole-tab reads.** Route loads download the entire Log / Garmin / Withings
  tab and slice in JS. Payloads grow unbounded as history accumulates.
- **No server-side aggregation.** The progress "time range" buttons, volume /
  e1RM charts, and rolling wellness windows all recompute from the full dataset
  on every view.
- **No real query or search.** Finding a Garmin activity by name scans a
  client-side array.
- **Stringly-typed cells.** Every value is a string in a fixed column position;
  schema changes mean keeping header constants and A:X ranges in lockstep.

This feature migrates the data layer to **Cloud Firestore**, the free-tier
(Spark plan), Google-Cloud-integrated Firebase data store. Firestore is a NoSQL
document database, so the "relational" intent from the request is realized
through **normalized collections with document-ID references** (foreign-key-like
links), **precomputed rollup documents** for fast aggregate reads, and a
**keyword-array index** for text search. Where a true relational engine would be
required (multi-table joins, SQL `GROUP BY`, substring full-text), this spec
documents the Firestore-native equivalent and its trade-offs.

## Why Firestore (and not Postgres / Data Connect)

The request confirmed a **Firebase-branded, free-at-my-scale, Google-Cloud
integrated** backend. That rules out the Postgres options previously floated:

- **Firebase Data Connect** is relational but runs on **Cloud SQL for
  PostgreSQL**, which requires a paid, always-on instance — not free.
- **Supabase** is not a Firebase/Google-Cloud product.

**Cloud Firestore** is the only option meeting all three constraints. It is
callable entirely from web APIs (the `firebase/firestore` modular SDK over
HTTPS/gRPC-Web), so it works from the static GitHub Pages deployment with no
server. The trade-off — no joins, no SQL aggregation, no native full-text — is
handled by the data-model decisions below.

## Decisions

### Authentication

- **Reintroduce Firebase Auth, but keep the existing GIS OAuth flow.** Firestore
  security rules key off `request.auth.uid`, which requires a Firebase Auth
  session. The app currently authenticates via the Google Identity Services
  (GIS) OAuth2 token client (Firebase auth was previously removed — see
  `.archive/specs/004-google-sheets-auth.spec.md`). We keep GIS for the
  Sheets/Calendar **scopes** and, in addition, exchange the Google credential
  for a Firebase session via `signInWithCredential(GoogleAuthProvider.credential(idToken))`.
  This yields a stable Firebase `uid` for Firestore rules without a second
  interactive sign-in.
- **Reuse the existing `VITE_FIREBASE_*` config.** `deploy.yml` already injects
  `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
  and `VITE_FIREBASE_APP_ID` (leftover from the removed Firebase auth). No new
  client secrets are needed.

### Data model — collections

All user data lives under a per-user document so security rules and the free
tier scale naturally. `{uid}` is the Firebase Auth uid.

```
users/{uid}/
  exercises/{exerciseId}            ← LiftConfig            (was "Stronger - Exercises")
  workouts/{workoutId}             ← Workout definition    (was "Stronger - Workouts")
  logEntries/{entryId}             ← SetResult rows         (was "Stronger - Log")
  dayFlags/{yyyy-mm-dd}            ← DayFlagEntry           (was "Stronger - Schedule")
  workoutSchedule/{yyyy-mm-dd}    ← WorkoutScheduleEntry   (was "Stronger - Workout Schedule")
  cardio/{cardioId}                ← CardioActivity         (was "Stronger - Cardio")
  mealLog/{entryId}                ← MealLogEntry           (was "Stronger - Meal Log")
  mealFavorites/{code}            ← FoodItem               (was "Stronger - Meal Favorites")
  mealRecents/{code}              ← FoodItem               (was "Stronger - Meal Recents")
  garminActivities/{activityId}   ← GarminActivity         (was "Stronger - Garmin")
  garminWellness/{yyyy-mm-dd}     ← GarminWellnessEntry    (was "Stronger - Garmin Wellness")
  withings/{grpId}                 ← WithingsMeasurement    (was "Stronger - Withings")
  strava/{stravaId}                ← StravaActivity (legacy) (was "Stronger - Strava")
  settings/app                     ← AppSettings (single doc)
  rollups/{rollupId}              ← precomputed aggregates (see req 4)
```

- **Document IDs are the natural keys.** Using the existing dedup keys as
  document IDs (`activityId`, `grpId`, `date`, food `code`) makes the sync
  scripts' upsert a plain `set(..., {merge:true})` — no read-then-partition
  needed, which replaces the `--overwrite`/`partition_rows` machinery from
  spec 038. Idempotent by construction.
- **Typed fields.** Numbers stay numbers, booleans stay booleans, `null` is
  representable — no more stringly-typed cells or column-range bookkeeping.
  The `src/model/*` TypeScript interfaces become the document shapes directly.

### Relational improvements (request item 3, applied pragmatically)

Firestore has no joins, so "more relational" means normalized references by
document ID plus targeted denormalization for read paths:

- **ID references (FK-like).** `logEntries.exerciseId` → `exercises/{id}`;
  `workoutSchedule.workoutId` → `workouts/{id}`; `workouts.exercises[].liftId`
  → `exercises/{id}`. Referential intent is documented; Firestore does not
  enforce it, so the app and migration validate on write.
- **Workout template stays a single document.** The per-exercise/per-set
  template (`ExerciseTemplate` / `SetTemplate`) is embedded as a nested array
  in the workout document rather than split into a subcollection — it is always
  read as a unit, so embedding is the correct Firestore modeling choice (avoids
  N reads). This is the NoSQL counterpart to the header→exercises normalization
  a SQL design would use.
- **Deduped food identity.** `mealFavorites` and `mealRecents` are keyed by Open
  Food Facts `code`, so the same food is one document per list rather than
  duplicated rows.
- **Denormalize where it speeds reads.** Log entries carry a denormalized
  `exerciseName` alongside `exerciseId` so the history/progress views render
  without a second lookup.

### Fast route loading via queries + rollups (request item 4)

Replace "download the whole tab, aggregate in JS" with scoped queries and
precomputed aggregates:

- **Range-scoped queries.** Calendar, history, and dashboards query only the
  visible window (`where('date', '>=', from)` / `<=', to)`), not the whole
  collection. Composite indexes on `(date)` and `(exerciseId, date)` back these.
- **Native aggregation queries.** Firestore's `count()` / `sum()` / `average()`
  aggregation queries cover simple totals (e.g. weekly volume, drink counts)
  without shipping rows to the client.
- **Precomputed rollup documents** for chart series that native aggregation
  can't express (e1RM, per-exercise progression, rolling wellness windows).
  `users/{uid}/rollups/progress_{exerciseId}` holds a compact time series;
  `rollups/weekly_{yyyy-Www}` holds weekly training/wellness summaries. Rollups
  are (a) rebuilt by the migration script for historical data and (b) updated
  incrementally by the client on each log write / by the sync scripts on each
  activity write. The progress "time range" buttons then read a small rollup
  slice instead of the full log.

### Text search for Garmin activity names (request item 5)

Firestore has no native full-text search. For a **free** solution:

- **Keyword-array field.** Each `garminActivities` document gets a `keywords`
  array — the activity `name` lowercased and tokenized (whole words + optional
  prefix fragments). Search uses `array-contains-any`, backed automatically by
  Firestore's single-field array index. This gives fast whole-word / prefix
  matching with no extra service.
- **Client substring fallback.** For substring matches within an
  already-loaded window, keep the current in-memory filter.
- **Escalation path (documented, not built):** if true typo-tolerant substring
  search is needed later, mirror activity names into **Typesense** or **Algolia**
  — noted here so the option is on record; not part of this feature to keep it
  free.

Optional keyword arrays on exercise, workout, and food names follow the same
pattern if we later want searchable pickers.

### Security rules

- `users/{uid}/{document=**}`: `allow read, write: if request.auth != null &&
  request.auth.uid == uid;` — a user can only touch their own subtree.
- Sync scripts write via the **Firebase Admin SDK** (service account), which
  bypasses rules, so they are unaffected.
- Rules live in `firestore.rules`; indexes in `firestore.indexes.json`.

## Migration script (request item 2)

`scripts/sheets-to-firestore.py`, runnable locally and from a new
`.github/workflows/sheets-to-firestore.yml` (`workflow_dispatch`), mirroring the
service-account pattern already used by `scripts/sheet-backup.py`.

- **Inputs (secrets / env):**
  - `SOURCE_SPREADSHEET_ID` — the spreadsheet to copy from.
  - `GOOGLE_SERVICE_ACCOUNT_KEY` — Sheets read access (same as backup).
  - `FIREBASE_SERVICE_ACCOUNT_KEY` + `FIREBASE_PROJECT_ID` — Firestore write
    access via `firebase-admin`. (These are "whatever connection variables the
    Firebase db needs.")
  - `TARGET_UID` — the Firebase uid whose `users/{uid}/…` subtree receives the
    data (a single-user migration; the workflow takes it as an input).
- **Behavior:** reads every known tab via the Sheets values API, maps each row
  through pure helpers that parallel the column orderings in
  `src/google/sheets.ts` header constants, and upserts into the matching
  Firestore collection using the natural key as the document ID
  (`set(..., merge=True)` → idempotent, re-runnable). Rebuilds the `rollups/*`
  documents after loading raw data.
- **Flags:** `--dry-run` (parse + report counts, no writes) and per-collection
  selectors (e.g. `--only logEntries,garminActivities`).
- **Tests:** `scripts/test_sheets_to_firestore.py` — offline harness covering
  the row→document mapping helpers and the keyword tokenizer, following the
  `test_sheet_backup.py` / `test_garmin_sync.py` convention (pure functions, no
  network). Deps added to `scripts/requirements.txt` (`firebase-admin`).

## App integration

- **New `src/db/` module** exposing the same function surface the app already
  imports from `src/google/index.ts` (`readWorkoutDefs`, `readLogZone`,
  `appendLogRows`, `writeSettings`, `readGarminActivities`, …) but backed by
  Firestore. `App.tsx` swaps the import source based on a feature flag; the
  `src/model/*` types and all components are unchanged because documents
  deserialize into the same interfaces.
- **Feature flag `app.useFirestoreBackend`** (Settings, default `false`) so
  `main` stays deployable throughout: the app keeps reading Sheets until the
  Firestore path is proven, then the flag flips.
- Add `firebase` (already a transitive concept via the config) as a client
  dependency; run the advisory-DB check before adding it.

## Phased rollout (each phase ships to `main` behind the flag)

1. **Spec + scaffolding** (this document): add `src/db/` skeleton, `firebase`
   dep, `firestore.rules`, `firestore.indexes.json`, feature flag plumbing.
2. **Migration script + workflow + offline tests** — populate Firestore from the
   live sheet; validate with `--dry-run`.
3. **Read path** — `src/db/` read functions; app reads from Firestore when the
   flag is on; parity-check against Sheets.
4. **Write path** — log/settings/schedule writes go to Firestore; keep Sheets
   in sync during transition if desired.
5. **Rollups + scoped queries** (req 4) — route-driven fetches and precomputed
   aggregates for progress/calendar/wellness.
6. **Search** (req 5) — keyword arrays on Garmin activities + indexed search.
7. **Cutover** — point sync scripts (`garmin-sync.py`, `garmin-wellness-sync.py`,
   `withings-sync.mjs`) at Firestore (Admin SDK upsert), retire
   `sheet-backup.py` (Firestore has managed backups / export), default the flag
   on, and deprecate `src/google/sheets.ts` read/write. Update `AGENTS.md`,
   `README.md`, add a `FIRESTORE_SETUP.md`, and append post-implementation
   decisions back here per repo convention.

## Notes

- **Free-tier fit.** Firestore Spark: 1 GiB storage, 50k reads / 20k writes /
  20k deletes per day. Scoped queries + rollups keep daily reads far under that
  for a single user; the natural-key upsert keeps writes minimal.
- **Trade-offs vs. a relational engine.** No joins (resolved by ID references +
  denormalization), no SQL `GROUP BY` (resolved by aggregation queries +
  rollups), no substring full-text (resolved by keyword arrays; Typesense/Algolia
  noted as the escalation path). These are inherent to Firestore, not gaps in
  the design.
- **Keeps Google Calendar.** The GIS OAuth flow and Calendar scope are retained;
  only the storage layer changes.
