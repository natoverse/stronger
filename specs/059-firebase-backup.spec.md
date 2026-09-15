# Feature: Firebase backup

> Export the configured user's Stronger-owned Firestore data every night as a
> downloadable JSON artifact.

## What

Add a nightly and manually dispatched GitHub Actions workflow that reads the
application data below `/users/{FIREBASE_USER_ID}`, writes one JSON file per
backed-up collection, encrypts the JSON directory, and uploads it as a ZIP
artifact.

## Acceptance Criteria

- [ ] The workflow is named **Firebase backup** and runs nightly.
- [ ] The workflow can also be started manually.
- [ ] Authentication uses `FIREBASE_SERVICE_ACCOUNT_KEY`, and the source user is
      selected by `FIREBASE_USER_ID`.
- [ ] The backup is encrypted with `FIREBASE_BACKUP_PASSPHRASE` before upload so
      personal workout data is not exposed through a public-repository artifact.
- [ ] The export includes `exercises`, `workouts`, `workoutSessions`,
      `dayFlags`, and `schedule`.
- [ ] Garmin, Withings, cardio, settings, migration records, and administrative
      sync state are not exported.
- [ ] Every collection is written to its own readable JSON file with document
      IDs, document data, and Firestore creation/update timestamps.
- [ ] A manifest records the source user path, export time, collection names,
      and document counts.
- [ ] Pagination exports every document in each collection.
- [ ] The downloadable GitHub artifact contains only the encrypted backup
      archive, never plaintext JSON.
- [ ] Offline tests cover pagination, Firestore value conversion, collection
      scope, and generated files.

## Scope

The backup protects data created by the Stronger application: the exercise and
workout libraries, workout history, workout scheduling, and day flags. Health
data is intentionally excluded because Garmin and Withings can be resynced.
