# Feature: Firebase migration action

> Copy the current Stronger Google Sheet into a user-scoped Firestore document
> tree without changing the application's existing Google Sheets UI.

## What

Add a manually dispatched GitHub Action that reads every recognized
`Stronger - *` tab with service-account credentials, converts the rows to the
current application data model, and writes deterministic documents below a
configured `/users/{uid}` Firestore path.

This is intentionally separate from the Firebase application migration. It
allows the Firestore schema and imported data to be inspected before the UI,
authentication, and scheduled sync jobs switch backends.

## Acceptance Criteria

- [ ] The workflow is manual-only and defaults to a dry run.
- [ ] Google Sheets and Firestore authenticate only through repository secrets.
- [ ] Dry runs read and validate all recognized tabs, print collection counts,
      and make no Firestore writes.
- [ ] Real runs require a destination Firebase UID.
- [ ] Existing destination data blocks the migration unless replacement is
      explicitly enabled.
- [ ] Replacement writes the new snapshot before removing stale documents, so
      a failed write cannot first empty the destination.
- [ ] Documents use deterministic IDs so rerunning the same migration does not
      create duplicates.
- [ ] Migration status, counts, warnings, source spreadsheet ID, and timestamps
      are recorded below `/users/{uid}/migrations`.
- [ ] Exercise documents include `warmupRoundingFactor`, including the legacy
      default of `5` when the sheet column is absent.
- [ ] Workout schedule documents preserve the current optional custom `label`.
- [ ] Workout definitions preserve all weight-basis variants, comments, roles,
      and favorite state.
- [ ] Missing optional tabs produce warnings rather than aborting the run.
- [ ] Missing or empty required exercise/workout tabs abort before any write.
- [ ] The destination UID must already exist in Firebase Authentication.
- [ ] Concurrent workflow runs cannot interleave.
- [ ] Parser and document-ID behavior has offline automated tests.

## Secrets

- `GOOGLE_SERVICE_ACCOUNT_KEY`: JSON key with read access to the source sheet.
- `FIREBASE_SERVICE_ACCOUNT_KEY`: JSON key with Firestore write access.
- `SPREADSHEET_ID`: source Google spreadsheet ID.
- `FIREBASE_USER_ID`: destination UID used in `/users/{uid}`.

## Collections

- `exercises`
- `workouts`
- `workoutSessions`
- `dayFlags`
- `schedule`
- `cardioActivities`
- `mealItems`
- `mealLog`
- `favoriteFoods`
- `recentFoods`
- `stravaActivities`
- `garminActivities`
- `garminWellness`
- `withingsMeasurements`
- `settings/app`
- `migrations/{migrationId}`
