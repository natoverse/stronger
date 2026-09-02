# Garmin sync setup

Stronger imports Garmin activities and daily wellness data through scheduled
GitHub Actions and writes directly to the Firebase user's Firestore tree.

## Required secrets

| Secret | Purpose |
|---|---|
| `GARMIN_TOKENS` | Saved `garminconnect` token bundle |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Firebase administrative service-account JSON |
| `FIREBASE_USER_ID` | Destination UID below `/users/{uid}` |

The service account needs **Cloud Datastore User** access. The UID must match
the account that uses the deployed Stronger application.

## Stored data

- **Garmin Sync** writes shared activity-model entries to
  `/users/{uid}/garminActivities/{year}`.
- **Garmin Wellness Sync** writes all daily wellness fields to
  `/users/{uid}/garminWellness/{year}`.
- Garmin wellness also merges available step, floor, and weekly intensity
  goals into `/users/{uid}/settings/app`.

Each yearly document contains `period`, `count`, `entries`, and `updatedAt`.
Incremental runs preserve all entries outside the fetched window.

## Run the workflows

Use **Actions -> Garmin Sync** or **Actions -> Garmin Wellness Sync**.
Scheduled runs overwrite matching recent entries so partially populated days
and edited activities are refreshed. Manual backfill runs fetch the configured
full-history window and remain idempotent by source ID or date.

## Troubleshooting

| Symptom | Resolution |
|---|---|
| Missing `GARMIN_TOKENS` | Recreate and store the complete token bundle. |
| Firestore returns `403` | Verify the service account belongs to the Firebase project and has Cloud Datastore User. |
| Data appears under the wrong account | Correct `FIREBASE_USER_ID`; workflows write only below that UID. |
| No new records are reported | The fetched source IDs already exist; this is normal for an idempotent rerun. |
