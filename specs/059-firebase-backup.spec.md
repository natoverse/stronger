# Feature: Firebase backup

> Export the configured user's Stronger-owned Firestore data every night as a
> downloadable JSON artifact.

## What

Add a nightly and manually dispatched GitHub Actions workflow that reads the
application data below `/users/{FIREBASE_USER_ID}`, writes one JSON file per
backed-up collection, and uploads the directory as a ZIP artifact.

## Acceptance Criteria

- [ ] The workflow is named **Firebase backup** and runs nightly.
- [ ] The workflow can also be started manually.
- [ ] Authentication uses `FIREBASE_SERVICE_ACCOUNT_KEY`, and the source user is
      selected by `FIREBASE_USER_ID`.
- [ ] The export includes `exercises`, `workouts`, `workoutSessions`,
      `dayFlags`, and `schedule`.
- [ ] Garmin, Withings, cardio, settings, migration records, and administrative
      sync state are not exported.
- [ ] Every collection is written to its own readable JSON file with document
      IDs, document data, and Firestore creation/update timestamps.
- [ ] A manifest records the source user path, export time, collection names,
      and document counts.
- [ ] Pagination exports every document in each collection.
- [ ] GitHub uploads the JSON directory directly so the downloadable workflow
      artifact has a single ZIP layer.
- [ ] Offline tests cover pagination, Firestore value conversion, collection
      scope, and generated files.

## Scope

The backup protects data created by the Stronger application: the exercise and
workout libraries, workout history, workout scheduling, and day flags. Health
data is intentionally excluded because Garmin and Withings can be resynced.

## Iteration Decisions

- The artifact is intentionally not encrypted so its JSON files can be
  downloaded, unzipped, and used immediately during database recovery.
