# Firebase Setup

Stronger uses Firebase Authentication for application login and Cloud Firestore
for user data. Google OAuth remains separately configured only for Calendar
sync.

## Firebase project

1. Create a Firebase project and web app.
2. Enable Authentication and the Google provider.
3. Add the deployed GitHub Pages domain to Authentication's authorized domains.
4. Create a Cloud Firestore database.
5. Deploy `firestore.rules` and `firestore.indexes.json` with the Firebase CLI.

Set these values locally in `.env.local` and as GitHub Actions secrets:

```text
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

These values identify the Firebase web app and are intentionally present in the
browser bundle. Firestore security is enforced by Authentication and
`firestore.rules`; never add a Firebase service-account key to a `VITE_*`
variable.

The scheduled Garmin and Withings workflows also require the administrative
`FIREBASE_SERVICE_ACCOUNT_KEY` and `FIREBASE_USER_ID` secrets documented in
`FIREBASE_MIGRATION.md`.

Keep `VITE_GOOGLE_CLIENT_ID` configured as described in `GOOGLE_SETUP.md`.
Its OAuth client must allow the Calendar scope for calendar synchronization.

## Migrated data

Run the migration workflow documented in `FIREBASE_MIGRATION.md` before
deploying this backend switch. There is no migration control in the web app.
