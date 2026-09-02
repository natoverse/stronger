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

- [x] Settings shows a Firebase Migration Identity section.
- [x] The section reports when the Firebase web application is not configured.
- [x] Google sign-in creates or restores the user's permanent Firebase
      Authentication account.
- [x] The signed-in email and exact Firebase UID are displayed.
- [x] The UID can be copied for use as `FIREBASE_USER_ID`.
- [x] A user can choose a different Google account if the wrong one was used.
- [x] Firebase Authentication persists across page reloads.
- [x] Firebase sign-in does not disconnect or replace the current Google Sheets
      session.
- [x] The bootstrap imports no Firestore client and performs no Firestore
      operations.
- [x] GitHub Pages builds receive the required `VITE_FIREBASE_*` configuration.
- [x] Setup documentation covers authorized domains for the primary site and
      fork deployments.

## Out of Scope

- Running the migration from the browser.
- Reading or writing Firestore data.
- Replacing Google Sheets as the application data backend.
- Managing other users' Firebase Authentication records.

## Iteration Decisions

- Every fork uses the same Firebase web configuration when users share one
  Firebase project, but each fork stores its own migration UID and spreadsheet
  ID.
- Firebase web configuration is embedded during the Vite build, so repository
  secret changes require a new GitHub Pages deployment before the Settings
  bootstrap becomes available.
- Bootstrap, authorized-domain, and per-fork configuration instructions live
  in the canonical `FIREBASE_SETUP.md` runtime guide.
- The guide identifies the Firebase console's
  **Project settings -> General -> Your apps -> SDK setup and configuration ->
  Config** pane as the source of the six `VITE_FIREBASE_*` values.
