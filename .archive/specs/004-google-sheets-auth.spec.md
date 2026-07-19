# Feature: Google Sheets auth and connection

> Connect the app to a user-provided Google Sheet via OAuth so it can read and write workout data.

## What

The app needs to authenticate with Google and connect to a specific spreadsheet. On first visit, the user enters their Google Sheet URL (or it's configured once and remembered). The app uses Google OAuth to get permission to read/write that sheet, then targets a tab called "Stronger" for all data operations.

The flow: user loads the app, clicks "Sign in with Google," authorizes Sheets access, and the app stores the sheet ID (from the URL) in browser local storage. On subsequent visits, the app reconnects automatically using the stored sheet ID and cached auth. If the "Stronger" tab doesn't exist in the sheet, the app creates it.

This spec covers only the auth and connection plumbing — no reading or writing of workout data yet. The goal is to end with a working OAuth flow and a verified connection to the target sheet/tab.

## Acceptance Criteria

- [ ] User can sign in via Google OAuth from the app (client-side flow, no backend).
- [ ] OAuth scope is limited to the Google Sheets API (read/write spreadsheets).
- [ ] User can provide a Google Sheet URL; the app extracts and stores the sheet ID in local storage.
- [ ] On subsequent visits, the app uses the stored sheet ID without re-prompting.
- [ ] The app verifies it can access the specified sheet after auth.
- [ ] If a "Stronger" tab does not exist in the sheet, the app creates it.
- [ ] If the "Stronger" tab already exists, the app connects to it without modifying it.
- [ ] The app displays a clear error if auth fails or the sheet is inaccessible.
- [ ] A "Sign out" option clears the auth token and stored sheet ID.

## Scope

### In scope
- Google OAuth client-side flow (implicit grant or PKCE)
- Google API client library setup for Sheets API
- Sheet URL input, ID extraction, and local storage persistence
- "Stronger" tab detection and creation
- Basic error handling for auth/access failures
- Sign out

### Out of scope
- Reading or writing workout data (specs 001/002)
- Any server-side auth components
- Managing multiple sheets or tabs
- Offline access / token refresh across sessions (can improve later)

## Notes

- A Google Cloud project with OAuth credentials and the Sheets API enabled is a prerequisite. The OAuth client ID will need to be configured — this can be hard-coded initially per the manifesto's guidance.
- The Google Sheet URL format is `https://docs.google.com/spreadsheets/d/{SHEET_ID}/...` — extracting the ID is straightforward.
- Consider using the `gapi` client library or the newer Google Identity Services (GIS) library. GIS is the current recommended approach and handles the OAuth flow with less boilerplate.

## Post-merge iterations

- **Token persistence**: Initially persisted in `localStorage`. Later switched to a `Secure; SameSite=Strict` cookie for better security posture. Cookie max-age set to 7 days (not tied to token `expiresIn`) so the user stays logged in for a week between gym sessions.
- **Reload behavior hardening**: On app load, the client now hydrates a persisted Google API access token into `gapi` before attempting Firebase popup sign-in, reducing repeated login prompts on normal reloads; if API calls return 401, auth is cleared and re-established.
- **403 guidance**: Spreadsheet permission errors now include the signed-in account email when available and explicitly advise sharing the sheet with that account or switching accounts.
