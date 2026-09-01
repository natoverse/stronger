# Firebase migration action

The **Migrate Google Sheet to Firebase** workflow copies the current Stronger
spreadsheet into Firestore without changing the app's Google Sheets backend.
It is manual-only and defaults to a dry run.

## Required repository secrets

| Secret | Purpose |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | JSON service-account key with Viewer access to the source spreadsheet |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | JSON service-account key with permission to read and write Firestore |
| `SPREADSHEET_ID` | Source Stronger spreadsheet ID |
| `FIREBASE_USER_ID` | Destination UID used below `/users/{uid}` |

The Firebase project in `FIREBASE_SERVICE_ACCOUNT_KEY` is the destination
project. The UID must already exist in Firebase Authentication. It may be a
temporary validation account; the action can be run again for the final
Firebase Authentication UID later.

## Running the migration

1. Open **Actions → Migrate Google Sheet to Firebase → Run workflow**.
2. Keep **Read and validate data without writing to Firestore** enabled for the
   first run.
3. Inspect the logged collection counts and warnings.
4. Run again with dry-run disabled to write the snapshot.
5. Enable **Delete existing migrated collections before writing** only when the
   existing destination snapshot should be replaced.

Without replacement, the action refuses to write when any migrated collection
already contains documents. Replacement writes the new snapshot first, then
deletes stale documents from the Stronger collections owned by this migration.
It does not delete the Firebase Authentication user.
