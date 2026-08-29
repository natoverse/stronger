# Feature: Firebase backend and Google Sheets migration

> Replace Google Sheets as Stronger's application database with user-scoped
> Cloud Firestore data while retaining Google authorization only for Calendar
> sync and one-time imports.

## What

Stronger currently uses a short-lived Google OAuth access token for both
application login and every data operation. The app will instead authenticate
with Firebase Authentication and store each user's data below their Firebase
UID in Cloud Firestore. Google API authorization becomes an optional,
task-specific connection used by Calendar sync and by a migration action that
copies an existing Stronger spreadsheet.

The application remains a client-side React app hosted on GitHub Pages.

## Acceptance Criteria

- [ ] Firebase Authentication is the application login and persists sessions
  across reloads.
- [ ] Firestore is the source of truth for exercises, workout definitions,
  workout logs, schedule data, nutrition data, settings, and imported health
  data.
- [ ] Every document is stored below `/users/{uid}` and security rules prevent
  access to another user's records.
- [ ] A new account can seed the existing default exercises, workouts, and
  cardio activities without a spreadsheet.
- [ ] Settings includes an action that accepts a Stronger Google Sheet URL,
  previews recognized records, and imports them into the signed-in user's
  Firestore collections.
- [ ] Imports use deterministic identifiers and can be retried without creating
  duplicate records.
- [ ] Import progress and validation warnings are recorded in Firestore.
- [ ] Google Sheets authorization is requested only when importing.
- [ ] Google Calendar authorization is requested only from a calendar sync
  panel and an expired Calendar token does not sign the user out of Stronger.
- [ ] Existing two-way Calendar synchronization and `strongerId` matching are
  preserved.
- [ ] Firebase configuration is supplied through public `VITE_FIREBASE_*`
  environment variables; no service-account credential is shipped to the app.
- [ ] Firestore rules and migration/repository behavior have automated tests.

## Firestore Schema

All collections are nested below `/users/{uid}`:

- `exercises/{exerciseId}`
- `workouts/{workoutId}`
- `workoutSessions/{sessionSetId}`
- `dayFlags/{date}`
- `schedule/{entryId}`
- `cardioActivities/{activityId}`
- `mealItems/{itemId}`
- `mealLog/{entryId}`
- `favoriteFoods/{barcode}`
- `recentFoods/{barcode}`
- `stravaActivities/{activityId}`
- `garminActivities/{activityId}`
- `garminWellness/{date}`
- `withingsMeasurements/{groupId}`
- `settings/app`
- `migrations/{migrationId}`

The user document stores `schemaVersion`, setup state, and timestamps. Source
identifiers are retained as document IDs. Legacy set-level log rows use a
deterministic document ID derived from session start time, lift, and set number.

## Migration

The import reads all recognized `Stronger - *` tabs with the existing,
backward-compatible row parsers. It shows counts and warnings before writing.
The destination must be empty unless the user explicitly chooses replacement.
Writes are chunked below Firestore batch limits. A migration document records
the source spreadsheet ID, status, collection counts, warnings, checkpoints,
and completion time. Retrying the same source uses the same migration and
record identifiers.

## Security and Quotas

Firestore rules require an authenticated UID matching the path UID. Normal
views query only required collections or date ranges; they do not attach
whole-history real-time listeners. Firebase's public web configuration is not a
secret. Administrative sync credentials remain restricted to GitHub Actions.

## Rollout

The Sheets reader remains temporarily available only for migration. Existing
Sheets are retained as backups through the stabilization period. External
Garmin, Garmin Wellness, and Withings workflows move to deterministic Firestore
writes before their corresponding sheet readers are retired.

