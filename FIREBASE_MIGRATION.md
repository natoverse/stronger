# Firebase migration action

The **Migrate Google Sheet to Firebase** workflow copies the current Stronger
spreadsheet into Firestore without changing the app's Google Sheets backend.
It is manual-only and defaults to a dry run.

## 1. Create the Firebase project

1. Open the Firebase console and select **Create a project**.
2. Give the project a name and complete the project wizard. Google Analytics is
   not required for Stronger.
3. Record the **Project ID** shown under
   **Project settings -> General -> Your project**.

The migration script takes its destination project from the Firebase service
account key. There is no separate Firebase project ID secret.

## 2. Create the Firestore database

1. In the Firebase console, open
   **Databases & Storage -> Firestore Database**.
2. Select **Create database**.
3. Select **Standard edition**.
4. Use the database ID **`(default)`**. The migration script does not support a
   named Firestore database.
5. Select the region where the Stronger data should be stored. Treat this as a
   permanent choice.
6. Select **Production mode**, then create the database.

Production mode is safe for the migration. The workflow authenticates as a
service account, so Firestore authorizes it through Google Cloud IAM rather
than browser-facing Firestore security rules. The migration does not require
temporarily permissive rules.

Firestore collections do not need to be created manually. The workflow creates
the `/users/{uid}` document tree when it writes the first migration.

## 3. Create a Firebase Authentication user

The destination path is tied to a Firebase Authentication UID. In the Firebase
console:

1. Open **Security -> Authentication** and select **Get started** if prompted.
2. Open the **Users** tab.
3. Create a user, or sign in once through a Firebase-enabled build of Stronger
   to create the final Google-authenticated user.
4. Copy the value in the user's **User UID** column exactly. This becomes
   `FIREBASE_USER_ID`.

For migration testing, a temporary password user is acceptable. After the
Firebase UI is available, sign in with the intended Google account, copy that
account's UID, change `FIREBASE_USER_ID`, and run the migration again for the
final user. Data migrated under one UID is not automatically moved to another.

Do not use an email address, Google account ID, Firebase project ID, or service
account ID as `FIREBASE_USER_ID`.

## 4. Create the Firebase service-account key

The workflow needs a private key for administrative Firestore writes and for
checking that `FIREBASE_USER_ID` exists:

1. Open **Project settings -> Service accounts -> Firebase Admin SDK**.
2. Select **Generate new private key**, confirm, and save the downloaded JSON
   file securely.
3. Use the complete JSON file contents as
   `FIREBASE_SERVICE_ACCOUNT_KEY`. Do not base64-encode it and do not store only
   the path to the file.

The Firebase Admin SDK service account normally has the permissions the
workflow needs. If using a custom service account instead, grant these
least-privilege project roles in Google Cloud IAM:

- **Cloud Datastore User** (`roles/datastore.user`) for Firestore document
  reads and writes.
- **Firebase Authentication Viewer** (`roles/firebaseauth.viewer`) for
  validating the destination UID.

Never commit the JSON key. Delete the local copy after storing it in GitHub if
it is no longer needed.

## 5. Prepare Google Sheets access

The migration also needs a Google service-account key:

1. Use the existing Google service account for Stronger automation, or create
   one in Google Cloud and download a JSON key.
2. Share the source Stronger spreadsheet with the service account's
   `client_email` as a **Viewer**.
3. Copy the spreadsheet ID from its URL:

   ```text
   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
   ```

The complete Google key JSON becomes `GOOGLE_SERVICE_ACCOUNT_KEY`.

## Required repository secrets

| Secret | Purpose |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | JSON service-account key with Viewer access to the source spreadsheet |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Complete Firebase service-account key JSON |
| `SPREADSHEET_ID` | Source Stronger spreadsheet ID |
| `FIREBASE_USER_ID` | Destination UID used below `/users/{uid}` |

The Firebase project in `FIREBASE_SERVICE_ACCOUNT_KEY` is the destination
project. `FIREBASE_USER_ID` is optional for a dry run but required for a real
migration.

Add the secrets under
**GitHub repository -> Settings -> Secrets and variables -> Actions**. They can
also be set from an authenticated GitHub CLI:

```bash
gh secret set GOOGLE_SERVICE_ACCOUNT_KEY < google-service-account.json
gh secret set FIREBASE_SERVICE_ACCOUNT_KEY < firebase-service-account.json
gh secret set SPREADSHEET_ID --body 'your-spreadsheet-id'
gh secret set FIREBASE_USER_ID --body 'your-firebase-auth-uid'
```

## Running the migration

1. Open **Actions -> Migrate Google Sheet to Firebase -> Run workflow**.
2. Select the `main` branch.
3. Keep **Read and validate data without writing to Firestore** enabled.
4. Keep **Delete existing migrated collections before writing** disabled.
5. Run the workflow and open the **Migrate sheet data** step.
6. Check every reported collection count and warning. A successful dry run
   ends with `Dry run complete. No Firestore writes were made.`
7. Run the workflow again with dry-run disabled.
8. Leave replacement disabled for the first real migration.

Without replacement, the action refuses to write when any migrated collection
already contains documents. Replacement writes the new snapshot first, then
deletes stale documents from the Stronger collections owned by this migration.
It does not delete the Firebase Authentication user.

Use replacement only when rerunning the migration to intentionally make
Firestore match the current spreadsheet snapshot. Missing optional spreadsheet
tabs are skipped rather than treated as empty collections, so their existing
Firestore data is not deleted.

## Inspecting the result

After the real migration:

1. Open **Firestore Database -> Data** in the Firebase console.
2. Expand `users`.
3. Open the document whose ID equals `FIREBASE_USER_ID`.
4. Inspect its subcollections, especially `exercises`, `workouts`,
   `workoutSessions`, `schedule`, and `settings`.
5. Open the `migrations` document whose ID starts with `sheet-` and contains
   the source spreadsheet ID. Confirm its status, collection counts, warnings,
   and completion timestamp.

The migration writes only under `/users/{FIREBASE_USER_ID}`. It does not modify
other users, Firebase Authentication records, or the source spreadsheet.

## Troubleshooting

| Error or symptom | Resolution |
|---|---|
| Firestore request returns `404` | Create the Standard **`(default)`** database in the same project named by the Firebase key. |
| Firestore or Authentication request returns `403` | Check the service account's IAM roles. New role grants can take several minutes to apply. |
| Authentication user does not exist | Copy the exact UID from **Authentication -> Users** and confirm that user and the service-account key belong to the same Firebase project. |
| Google Sheets request returns `403` | Share the spreadsheet with the Google key's `client_email` as Viewer. |
| A service-account secret is reported as invalid JSON | Store the complete raw JSON file as the secret; do not base64-encode it or paste a filename. |
| Required sheet tab is missing or empty | Ensure `Stronger - Exercises` and `Stronger - Workouts` exist and contain data. |
| Destination already contains documents | Inspect the existing data. Rerun with replacement only if it should be overwritten by the spreadsheet snapshot. |
