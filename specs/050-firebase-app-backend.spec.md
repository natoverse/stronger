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
  across reloads.
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
- [ ] Existing two-way Calendar synchronization and `strongerId` matching are
  preserved.
- [ ] Garmin activities, Garmin wellness, and Withings scheduled syncs mirror
  their completed sheet updates into the corresponding Firestore collections.
- [ ] Firebase configuration is supplied through public `VITE_FIREBASE_*`
  environment variables; no service-account credential is shipped to the app.
- [ ] Firestore rules and repository behavior have automated tests.

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

The user document stores `schemaVersion`, setup state, and timestamps. Source
identifiers are retained as document IDs. Migrated workout-log rows retain
their source-row discriminator, while new rows use a per-session sequence, so
repeated instances of the same exercise do not collide.

## Security and Quotas

Firestore rules require an authenticated UID matching the path UID. Normal
views query only required collections or date ranges; they do not attach
whole-history real-time listeners. Firebase's public web configuration is not a
secret. Administrative sync credentials remain restricted to GitHub Actions.

## Rollout

The migration action in spec 049 runs before this backend switch. Existing
Sheets remain the ingestion ledger and backup during stabilization. Garmin,
Garmin Wellness, and Withings workflows mirror only their own completed
collections into Firestore after each successful sync.
