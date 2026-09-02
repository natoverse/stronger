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
- [ ] Workout schedule rows are collapsed into one document per date with an
      ordered `events` array.
- [ ] Workout definitions preserve all weight-basis variants, comments, roles,
      and favorite state.
- [ ] Workout-log rows are collapsed into one document per workout session,
      with ordered exercise and set arrays.
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
- `garminActivities`
- `garminWellness`
- `withingsMeasurements`
- `settings/app`
- `migrations/{migrationId}`

## Iteration Decisions

- The operator guide now explicitly requires a Standard Firestore
  **`(default)`** database in production mode. Migration service-account
  requests are authorized by IAM and do not require permissive Firestore
  security rules.
- A custom migration service account needs Cloud Datastore User for document
  access and Firebase Authentication Viewer to validate the destination UID.
- The guide distinguishes temporary validation UIDs from the final
  Google-authenticated user UID because Firestore data is scoped to the exact
  `/users/{uid}` path and is not automatically transferred between users.
- The existing Google Sheets UI exposes an Authentication-only bootstrap in
  Settings so users can create and copy their final Firebase UID before any
  Firestore migration or application-backend switch.
- Historical Day Flags and Garmin Wellness tabs can contain repeated dates.
  Migration collapses those one-document-per-day collections by keeping the
  last valid row and emitting a warning; duplicate IDs remain fatal for other
  collections. Workout Schedule entries remain distinct by `strongerId` or by
  their date, workout, and label, so multiple workouts on one day are retained.
- Workout history follows the same nested-document approach as workout
  definitions. Rows sharing `(date, workoutId, startTime)` are collapsed into
  one `workoutSessions` document containing ordered exercise and set arrays.
  Repeated exercise blocks remain distinct when the lift/name changes or set
  numbering resets.
- Workout schedule entries are grouped into `schedule/{date}` documents with
  ordered `events` arrays. Event objects retain `workoutId`, `label`,
  `calendarEventId`, and `strongerId`; the date is stored once at the document
  level.
- Only Exercises and Workouts are required. Missing logs, schedules, cardio,
  nutrition, Garmin, Garmin Wellness, Withings, or settings tabs produce
  warnings and are excluded from writes and replacement deletion.
- The deprecated Strava sheet is not read or migrated. Runtime activity views
  consume Garmin data; legacy `StravaActivity` names remain only as shared
  model and chart terminology.
- Operators must explicitly enable Cloud Firestore and Identity Toolkit APIs
  in the Firebase destination project and Google Sheets API in the source
  service account's project. `SERVICE_DISABLED` errors are distinguished from
  IAM permission errors in the setup guide.
- `FIREBASE_SETUP.md` is the canonical project and runtime setup guide. The
  migration is documented there as a final manual, one-time special case
  rather than as the primary Firebase setup path.
- Public OSS forks inherit no shared-project secrets. The maintainer manually
  provisions only approved friends-and-family forks with the shared Firebase
  configuration and service-account key. Those fork owners are trusted
  administrators with project-wide access; per-user UIDs prevent accidental
  targeting but are not an IAM boundary.
