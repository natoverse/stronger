# Withings sync setup

Stronger imports body-composition measurements through a scheduled GitHub
Action and writes directly to Firestore.

## Required secrets

| Secret | Purpose |
|---|---|
| `WITHINGS_CLIENT_ID` | Withings application client ID |
| `WITHINGS_CLIENT_SECRET` | Withings application client secret |
| `WITHINGS_REFRESH_TOKEN` | Initial seed token; used only when Firestore has no stored token |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Firebase administrative service-account JSON |
| `FIREBASE_USER_ID` | Destination UID below `/users/{uid}` |

The service account needs **Cloud Datastore User** access.

## Rotating refresh token

Withings rotates its refresh token on every successful refresh. The workflow
immediately stores the replacement token in `/syncState/{uid}` before fetching
measurements. This document is outside the browser-readable `/users/{uid}`
tree and is denied by the repository's Firestore rules; only administrative
IAM credentials can access it. Firestore requests use exponential-backoff
retries, and the workflow retries the full sync twice more at one-minute
intervals so a transient persistence failure is recovered within Withings'
old-token grace window.

For an existing Sheets installation, run **Migrate Google Sheet to Firebase**
with `collections` set to `syncState`. This copies the current
`withings_refresh_token` from the legacy `Stronger - Infra` tab. If no legacy
token exists, the first run uses `WITHINGS_REFRESH_TOKEN`.

## Stored data

Measurements are merged into
`/users/{uid}/withingsMeasurements/{year}`. Each yearly document contains
`period`, `count`, `entries`, and `updatedAt`. `grpId` is the deduplication key;
scheduled overwrite runs refresh matching measurements while preserving every
unrelated entry.

Mass values remain in kilograms in storage and are converted for display by
the application.

## Run the workflow

Use **Actions -> Withings Sync**. Scheduled runs fetch the rolling 60-day
window. A manual backfill fetches history since January 1, 2021.

## Troubleshooting

| Symptom | Resolution |
|---|---|
| Token refresh returns 401 or 601 | Reseed `WITHINGS_REFRESH_TOKEN`, then remove or replace the stale `withingsRefreshToken` field in `/syncState/{uid}`. |
| Firestore returns `403` | Verify the administrative service account has Cloud Datastore User. |
| No measurements are written | Withings groups without a positive weight are intentionally skipped to match the application schema. |
