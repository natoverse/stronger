# Firebase setup

Stronger uses a shared Firebase project for Firebase Authentication and Cloud
Firestore. Each user signs in with Google and owns a separate
`/users/{firebaseUid}` document tree.

Google OAuth remains separately configured for Calendar access. Google Sheets
remains the ingestion ledger for the scheduled Garmin and Withings jobs during
the Firebase transition.

> **Trusted-forks security model:** every fork owner who receives
> `FIREBASE_SERVICE_ACCOUNT_KEY` is a trusted administrator of the entire
> shared Firebase project. Service-account requests bypass Firestore security
> rules and can access every user's data, not only the UID configured in that
> fork. UID isolation protects browser sessions; it does not restrict
> administrative workflow credentials. Do not distribute this key to
> untrusted users or public fork owners.

## 1. Create the Firebase project

1. Open the Firebase console and select **Create a project**.
2. Give the project a name and complete the project wizard. Google Analytics is
   not required.
3. Record the **Project ID** under
   **Project settings -> General -> Your project**.
4. Under **Your apps**, add a web application and record its Firebase
   configuration object.

All Stronger forks that share the same Firestore database use this same
Firebase project and web application configuration.

## 2. Enable the required Google Cloud APIs

The Firebase project needs these APIs for normal application and administrative
workflow usage:

| API | Service name | Used by | Enable in |
|---|---|---|---|
| Cloud Firestore API | `firestore.googleapis.com` | Stronger UI, migration, health sync mirroring | Firebase project |
| Identity Toolkit API | `identitytoolkit.googleapis.com` | Firebase Authentication and UID validation | Firebase project |
| Google Sheets API | `sheets.googleapis.com` | One-time migration and scheduled health sync ledgers | Project that owns the Google Sheets service account |

If one service account and project are used for both Firebase administration
and Google Sheets, enable all three APIs in that project.

### Google Cloud Console

1. Open **Google Cloud Console -> APIs & Services -> Library**.
2. Select the Firebase project.
3. Enable **Cloud Firestore API**.
4. Enable **Identity Toolkit API**.
5. Select the project whose ID appears in
   `GOOGLE_SERVICE_ACCOUNT_KEY.project_id`.
6. Enable **Google Sheets API**.
7. Wait several minutes for activation to propagate.

Enabling APIs requires permission such as **Service Usage Admin** on the
corresponding Google Cloud project.

### Google Cloud CLI

```bash
gcloud services enable \
  firestore.googleapis.com \
  identitytoolkit.googleapis.com \
  --project=YOUR_FIREBASE_PROJECT_ID

gcloud services enable \
  sheets.googleapis.com \
  --project=YOUR_GOOGLE_SERVICE_ACCOUNT_PROJECT_ID
```

Verify the enabled services:

```bash
gcloud services list --enabled \
  --project=YOUR_FIREBASE_PROJECT_ID \
  | grep -E 'firestore.googleapis.com|identitytoolkit.googleapis.com'

gcloud services list --enabled \
  --project=YOUR_GOOGLE_SERVICE_ACCOUNT_PROJECT_ID \
  | grep 'sheets.googleapis.com'
```

## 3. Create the Firestore database

1. In the Firebase console, open
   **Databases & Storage -> Firestore Database**.
2. Select **Create database**.
3. Select **Standard edition**.
4. Use the database ID **`(default)`**. Stronger does not support a named
   Firestore database.
5. Select the region where the data should be stored.
6. Select **Production mode**, then create the database.

Production mode is the correct starting point. Browser access is granted by
the repository's Firestore security rules. Administrative workflows use Google
Cloud IAM and do not require permissive browser rules.

Collections do not need to be created manually.

## 4. Configure Firebase Authentication

1. Open **Authentication -> Sign-in method**.
2. Enable **Google**.
3. Select the project support email and save the provider.
4. Open **Authentication -> Settings -> Authorized domains**.
5. Add every hostname that will run Stronger.

The primary deployment uses `natoverse.github.io`. A fork owned by the
`example` GitHub account uses `example.github.io`. Add `localhost` separately
when local sign-in is needed.

Every person must sign in with their own Google account. Firebase assigns each
account a stable UID, and Firestore rules restrict that account to its matching
`/users/{uid}` path.

## 5. Deploy Firestore rules and indexes

The Firebase-backed application includes `firebase.json`, `firestore.rules`,
and `firestore.indexes.json`. From a checkout containing those files:

```bash
npx firebase-tools login
npx firebase-tools use --add
npx firebase-tools deploy --only firestore:rules,firestore:indexes
```

Select the shared Firebase project when `firebase use --add` prompts. Do not
deploy the Firebase-backed UI until its rules have been deployed.

## 6. Configure the Firebase web application

Map the Firebase web configuration object to local environment variables and
GitHub Actions repository secrets:

| Firebase field | Environment variable or repository secret |
|---|---|
| `apiKey` | `VITE_FIREBASE_API_KEY` |
| `authDomain` | `VITE_FIREBASE_AUTH_DOMAIN` |
| `projectId` | `VITE_FIREBASE_PROJECT_ID` |
| `storageBucket` | `VITE_FIREBASE_STORAGE_BUCKET` |
| `messagingSenderId` | `VITE_FIREBASE_MESSAGING_SENDER_ID` |
| `appId` | `VITE_FIREBASE_APP_ID` |

These values identify the public Firebase web application and are intentionally
included in the browser bundle. Firestore rules and Authentication protect the
data; never put a service-account private key in a `VITE_*` variable.

For local development, copy `.env.example` to `.env.local` and fill in the
values. For GitHub Pages, add the six values under
**Repository Settings -> Secrets and variables -> Actions**.

Vite embeds them during the build. After changing a `VITE_FIREBASE_*` secret,
rerun **Deploy to GitHub Pages** before testing the new configuration.

Keep `VITE_GOOGLE_CLIENT_ID` configured as documented in `GOOGLE_SETUP.md`.
Firebase login does not replace the separate Google Calendar authorization.

## 7. Configure the administrative service account

The browser application does not use a service-account key. The migration and
scheduled Garmin/Withings Firestore mirrors do.

1. Open **Project settings -> Service accounts -> Firebase Admin SDK**.
2. Select **Generate new private key**.
3. Store the complete downloaded JSON as
   `FIREBASE_SERVICE_ACCOUNT_KEY`.

The Firebase Admin SDK service account normally has the required permissions.
A custom service account needs:

- **Cloud Datastore User** (`roles/datastore.user`) for Firestore reads and
  writes.
- **Firebase Authentication Viewer** (`roles/firebaseauth.viewer`) for
  validating destination users.

The same service account may be used for Sheets and Firebase if it belongs to
the Firebase project, has the roles above, and has access to the spreadsheet.
In that case, the same JSON may be stored in both service-account secrets.

Never commit a service-account key. Delete the local copy after storing it if
it is no longer needed.

## 8. Configure each user or fork

Every fork uses the shared Firebase web configuration but has its own
spreadsheet and Firebase UID.

| Secret | Scope | Purpose |
|---|---|---|
| `VITE_FIREBASE_*` | Shared | Browser Firebase project configuration |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Shared, trusted administrators only | Project-wide administrative Firestore writes |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Per fork or shared | Reads the user's sheet; scheduled health jobs may also write their ledger tabs |
| `SPREADSHEET_ID` | Per user | Source Google spreadsheet |
| `FIREBASE_USER_ID` | Per user | Destination `/users/{uid}` path and scheduled sync owner |

Before migrating, create the user's permanent UID from the existing
Google Sheets-backed Stronger UI:

1. Configure the six `VITE_FIREBASE_*` secrets in the user's fork.
2. Add the fork's GitHub Pages hostname to Firebase Authentication's authorized
   domains.
3. Deploy the fork.
4. Open Stronger and connect the Google Sheet normally.
5. Open **Settings -> Firebase Migration Identity**.
6. Select **Create Firebase migration ID** and sign in with the Google account
   that will use Firebase Stronger.
7. Verify the email and copy the displayed UID.
8. Store it as `FIREBASE_USER_ID` in that fork.

Selecting the same Google account later returns the same UID. If the wrong
account was selected, use **Choose another Google account** before copying it.

Configuring a unique `FIREBASE_USER_ID` prevents the provided workflows from
accidentally targeting another user's tree. It is not a security boundary for
a fork owner who possesses the service-account key, because that owner can
modify their workflow or script.

## 9. Scheduled health synchronization

The Garmin, Garmin Wellness, and Withings workflows continue to update their
Google Sheet tabs, then mirror only their owned collections into Firestore.
They require:

- Their existing provider credentials.
- `GOOGLE_SERVICE_ACCOUNT_KEY`.
- `SPREADSHEET_ID`.
- `FIREBASE_SERVICE_ACCOUNT_KEY`.
- `FIREBASE_USER_ID`.

Missing Garmin or Withings tabs do not affect the core workout application or
the one-time migration.

## One-time Google Sheets migration

The **Migrate Google Sheet to Firebase** workflow is a special-case,
manual-only import. It copies an existing Stronger spreadsheet into the
configured `/users/{FIREBASE_USER_ID}` tree before the application switches
its data backend.

### Minimum spreadsheet

Only these tabs are required:

- `Stronger - Exercises`
- `Stronger - Workouts`

Workout logs, schedules, cardio definitions, nutrition, Garmin activities,
Garmin wellness, Withings, and settings are optional. Missing optional tabs
produce warnings and are excluded from both writes and replacement deletion.

The deprecated `Stronger - Strava` tab is not read or migrated.

### Migration secrets

The migration uses the four non-`VITE_*` secrets from the per-user table:

```bash
gh secret set GOOGLE_SERVICE_ACCOUNT_KEY < google-service-account.json
gh secret set FIREBASE_SERVICE_ACCOUNT_KEY < firebase-service-account.json
gh secret set SPREADSHEET_ID --body 'your-spreadsheet-id'
gh secret set FIREBASE_USER_ID --body 'your-firebase-auth-uid'
```

Share the source spreadsheet with the Google service account's `client_email`
as a **Viewer**. Scheduled sync jobs require Editor access instead.

`FIREBASE_USER_ID` is optional for a dry run but required for a real migration.
The Firebase service-account key's `project_id` determines the destination
project.

### Run the migration

1. Open **Actions -> Migrate Google Sheet to Firebase -> Run workflow**.
2. Select the `main` branch.
3. Keep **Read and validate data without writing to Firestore** enabled.
4. Keep **Delete existing migrated collections before writing** disabled.
5. Run the workflow and inspect every collection count and warning.
6. Confirm the log ends with
   `Dry run complete. No Firestore writes were made.`
7. Run it again with dry-run disabled.
8. Leave replacement disabled for the first real migration.

A true dry run reads only Google Sheets and never calls a
`firestore.googleapis.com` URL.

Without replacement, the real migration refuses to write when a migrated
destination collection already contains documents. Replacement writes the new
snapshot first and then removes stale documents from migration-owned
collections.

Missing optional tabs are excluded from replacement deletion. Present but
empty optional tabs intentionally produce empty destination collections.

Historical Day Flags and Garmin Wellness tabs may contain repeated dates.
These one-document-per-day collections keep the last valid row and report a
warning. Multiple Workout Schedule entries on the same date remain distinct.

### Inspect the result

1. Open **Firestore Database -> Data** in the Firebase console.
2. Expand `users`.
3. Open the document whose ID equals `FIREBASE_USER_ID`.
4. Inspect its subcollections, especially `exercises`, `workouts`,
   `workoutSessions`, `schedule`, and `settings`.
5. Inspect the `migrations` document whose ID begins with `sheet-`.

The migration does not modify the source spreadsheet, other users, or Firebase
Authentication records.

## Troubleshooting

| Error or symptom | Resolution |
|---|---|
| Firestore returns `404` | Create the Standard **`(default)`** database in the Firebase project. |
| A `403` response contains `SERVICE_DISABLED` | Enable the API in `metadata.service` in the project named by `metadata.consumer`, wait several minutes, then retry. |
| Firestore or Authentication returns `403` without `SERVICE_DISABLED` | Check the administrative service account's IAM roles. |
| Firebase user does not exist | Copy the exact UID from **Authentication -> Users** and confirm the user and service-account key use the same project. |
| Settings reports that Firebase is not configured | Add all six `VITE_FIREBASE_*` secrets and redeploy the site. |
| Firebase sign-in reports an unauthorized domain | Add the deployment hostname under **Authentication -> Settings -> Authorized domains**. |
| Google Sheets returns `403` | Enable the Sheets API and share the spreadsheet with the Google service account. |
| Service-account secret is invalid JSON | Store the complete raw JSON file, not a filename or base64 encoding. |
| Required sheet tab is missing or empty | Ensure Exercises and Workouts exist and contain valid data. |
| Destination already contains documents | Inspect it first; enable replacement only when the sheet should overwrite the current snapshot. |
