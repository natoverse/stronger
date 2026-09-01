# Feature: Firebase authentication bootstrap

> Let Google Sheets users create and copy their permanent Firebase
> Authentication UID before the application switches its data backend.

## What

Add a Firebase migration identity section to the existing Settings page. A
user signs in to the shared Firebase project with Google, then copies the UID
needed by the migration workflow.

This bootstrap is intentionally independent of the application's current
Google Sheets authentication. It creates only the Firebase Authentication
identity and must not read, write, or initialize Cloud Firestore.

## Acceptance Criteria

- [ ] Settings shows a Firebase Migration Identity section.
- [ ] The section reports when the Firebase web application is not configured.
- [ ] Google sign-in creates or restores the user's permanent Firebase
      Authentication account.
- [ ] The signed-in email and exact Firebase UID are displayed.
- [ ] The UID can be copied for use as `FIREBASE_USER_ID`.
- [ ] A user can choose a different Google account if the wrong one was used.
- [ ] Firebase Authentication persists across page reloads.
- [ ] Firebase sign-in does not disconnect or replace the current Google Sheets
      session.
- [ ] The bootstrap imports no Firestore client and performs no Firestore
      operations.
- [ ] GitHub Pages builds receive the required `VITE_FIREBASE_*` configuration.
- [ ] Setup documentation covers authorized domains for the primary site and
      fork deployments.

## Out of Scope

- Running the migration from the browser.
- Reading or writing Firestore data.
- Replacing Google Sheets as the application data backend.
- Managing other users' Firebase Authentication records.

