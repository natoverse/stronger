# Firebase setup

Stronger uses a shared Firebase project for Firebase Authentication and Cloud
Firestore. Each user signs in with Google and owns a separate
`/users/{firebaseUid}` document tree.

Google OAuth remains separately configured for Calendar access. Scheduled
Garmin and Withings jobs write directly to Firestore.

Firebase Authentication persists the application session using the browser's
long-term storage and automatically refreshes its one-hour ID tokens. Stronger
does not impose a 30-day timeout: the session remains until explicit sign-out,
Firebase revocation or account changes, or browser storage removal. Google
Calendar access tokens are separate and are requested only when the user runs
Calendar synchronization.

After the user authorizes Calendar access, Stronger lists writable calendars
and requires an explicit selection before the first sync. The verified
selection is stored as `calendar.syncCalendarId` in `settings/app`; subsequent
sessions preselect that calendar after authorization.

> **OSS and trusted-forks security model:** public forks do not inherit
> repository secrets and have no access to the shared Firebase project by
> default. The project maintainer manually adds the Firebase configuration and
> service-account key only to approved friends-and-family forks. Owners of
> those provisioned forks are trusted administrators because they control
> workflows that can use the key. Service-account requests bypass Firestore
> rules and can access every user's data, not only the configured UID.

## 1. Create the Firebase project

1. Open the Firebase console and select **Create a project**.
2. Give the project a name and complete the project wizard. Google Analytics is
   not required.
3. Record the **Project ID** under
   **Project settings -> General -> Your project**.
4. Register a Firebase web app as described in
   [Configure the Firebase web application](#6-configure-the-firebase-web-application).

An independent OSS deployment should create its own Firebase project. Only
explicitly approved friends-and-family forks use the shared project and web
application configuration.

## 2. Enable the required Google Cloud APIs

The Firebase project needs these APIs for normal application and administrative
workflow usage:

| API | Service name | Used by | Enable in |
|---|---|---|---|
| Cloud Firestore API | `firestore.googleapis.com` | Stronger UI and direct health sync | Firebase project |
| Identity Toolkit API | `identitytoolkit.googleapis.com` | Firebase Authentication | Firebase project |

### Google Cloud Console

1. Open **Google Cloud Console -> APIs & Services -> Library**.
2. Select the Firebase project.
3. Enable **Cloud Firestore API**.
4. Enable **Identity Toolkit API**.
5. Wait several minutes for activation to propagate.

Enabling APIs requires permission such as **Service Usage Admin** on the
corresponding Google Cloud project.

### Google Cloud CLI

```bash
gcloud services enable \
  firestore.googleapis.com \
  identitytoolkit.googleapis.com \
  --project=YOUR_FIREBASE_PROJECT_ID
```

Verify the enabled services:

```bash
gcloud services list --enabled \
  --project=YOUR_FIREBASE_PROJECT_ID \
  | grep -E 'firestore.googleapis.com|identitytoolkit.googleapis.com'
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
`example` GitHub account uses `example.github.io`.

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

The web configuration is shown for a registered web app in the Firebase
console:

1. Open the Firebase project.
2. Select the gear beside **Project Overview**, then **Project settings**.
3. Stay on the **General** tab and scroll to **Your apps**.
4. If no web app exists, select the **Web** (`</>`) icon, enter a nickname such
   as `Stronger`, and select **Register app**. Firebase Hosting is not required
   because Stronger deploys to GitHub Pages.
5. Select the registered web app's nickname.
6. Under **SDK setup and configuration**, select **Config**.
7. Copy the values from the displayed `firebaseConfig` object:

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
};
```

Map the Firebase web configuration object to GitHub Actions repository secrets:

| Firebase field | Repository secret |
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

Add the six values under
**Repository Settings -> Secrets and variables -> Actions**.

Vite embeds them during the build. After changing a `VITE_FIREBASE_*` secret,
rerun **Deploy to GitHub Pages** before testing the new configuration.

Keep `VITE_GOOGLE_CLIENT_ID` configured as documented in `GOOGLE_SETUP.md`.
Firebase login does not replace the separate Google Calendar authorization.

## 7. Configure the administrative service account

The browser application does not use a service-account key. Scheduled health
sync workflows do.

1. Open **Project settings -> Service accounts -> Firebase Admin SDK**.
2. Select **Generate new private key**.
3. Store the complete downloaded JSON as
   `FIREBASE_SERVICE_ACCOUNT_KEY`.

The Firebase Admin SDK service account normally has the required permissions.
A custom service account needs:

- **Cloud Datastore User** (`roles/datastore.user`) for Firestore reads and
  writes.

Never commit a service-account key. Delete the local copy after storing it if
it is no longer needed.

## 8. Configure each approved shared-project fork

Public forks receive no upstream secrets. For each approved friends-and-family
fork, the shared-project maintainer manually adds the common Firebase
configuration and administrative key. That fork configures the UID of the
Firebase user who owns its imported health data.

| Secret | Scope | Purpose |
|---|---|---|
| `VITE_FIREBASE_*` | Shared | Browser Firebase project configuration |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Manually added to approved trusted forks only | Project-wide administrative Firestore writes |
| `FIREBASE_USER_ID` | Per user | Destination `/users/{uid}` path and scheduled sync owner |

Create the user's permanent UID by signing into Stronger:

1. Configure the six `VITE_FIREBASE_*` secrets in the user's fork.
2. Add the fork's GitHub Pages hostname to Firebase Authentication's authorized
   domains.
3. Deploy the fork.
4. Open Stronger and sign in with the Google account that will own the data.
5. In **Firebase Console -> Authentication -> Users**, find that account and
   copy its UID.
6. Store it as `FIREBASE_USER_ID` in that fork.

Selecting the same Google account later returns the same UID. Verify the account
before configuring its UID for scheduled synchronization.

Configuring a unique `FIREBASE_USER_ID` prevents the provided workflows from
accidentally targeting another user's tree. It is not a security boundary for
a fork owner who possesses the service-account key, because that owner can
modify their workflow or script.

Random public forks cannot use the upstream repository's secrets. They must
configure their own Firebase project or receive explicit shared-project
provisioning from the maintainer.

## 9. Scheduled health synchronization

Garmin activities, Garmin wellness, and Withings write directly to their
yearly Firestore bucket collections. They require:

- Their existing provider credentials.
- `FIREBASE_SERVICE_ACCOUNT_KEY`.
- `FIREBASE_USER_ID`.

Every bucket has `{ period, count, entries, updatedAt }`. Incremental syncs use
optimistic read-modify-write retries and preserve records outside their fetch
window.

Withings stores its rotating refresh token in the administrator-only
`/syncState/{uid}` document. Browser rules do not expose that path. The first run
uses `WITHINGS_REFRESH_TOKEN` only when no token is stored in Firestore.

See [Garmin sync setup](GARMIN_SYNC_SETUP.md) and
[Withings sync setup](WITHINGS_SYNC_SETUP.md) for provider credentials,
backfills, and token recovery.

## 10. Nightly Firebase backup

The **Firebase backup** workflow runs nightly at 04:15 UTC and can also be
started manually. It uses `FIREBASE_SERVICE_ACCOUNT_KEY` and
`FIREBASE_USER_ID` to export the configured user's `exercises`, `workouts`,
`workoutSessions`, `dayFlags`, and `schedule` collections.

GitHub packages the JSON directory directly as the `firebase-backup` ZIP
artifact and retains it for 30 days. After downloading and unzipping the
artifact, the files are immediately readable without a decryption step. The
artifact contains one JSON file per collection and a manifest with the source
user path, export time, and document counts. Garmin, Withings, and other
resynchronizable or nonessential collections are intentionally excluded.

## Troubleshooting

| Error or symptom | Resolution |
|---|---|
| Firestore returns `404` | Create the Standard **`(default)`** database in the Firebase project. |
| A `403` response contains `SERVICE_DISABLED` | Enable the API in `metadata.service` in the project named by `metadata.consumer`, wait several minutes, then retry. |
| Firestore or Authentication returns `403` without `SERVICE_DISABLED` | Check the administrative service account's IAM roles. |
| Firebase user does not exist | Copy the exact UID from **Authentication -> Users** and confirm the user and service-account key use the same project. |
| Settings reports that Firebase is not configured | Add all six `VITE_FIREBASE_*` secrets and redeploy the site. |
| Firebase sign-in reports an unauthorized domain | Add the deployment hostname under **Authentication -> Settings -> Authorized domains**. |
| Service-account secret is invalid JSON | Store the complete raw JSON file, not a filename or base64 encoding. |
