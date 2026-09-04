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

## Get the initial refresh token

### 1. Create a Withings API application

1. Sign in to the [Withings Developer Dashboard](https://developer.withings.com/dashboard/).
2. Create a **Public API integration** application. A developer/evaluation
   application is sufficient for personal use.
3. Set its callback URI to exactly `http://localhost`.
4. Copy the generated client ID and client secret into the
   `WITHINGS_CLIENT_ID` and `WITHINGS_CLIENT_SECRET` repository secrets.

### 2. Authorize the application

Open the following URL in a browser after replacing `YOUR_CLIENT_ID`:

```text
https://account.withings.com/oauth2_user/authorize2?response_type=code&client_id=YOUR_CLIENT_ID&scope=user.metrics&redirect_uri=http://localhost&state=stronger
```

Sign in and approve access. Withings redirects to a URL like:

```text
http://localhost/?code=AUTHORIZATION_CODE&state=stronger
```

The browser may show that it cannot connect to localhost; this is expected.
Copy the `code` value from the browser's address bar. The code is single-use
and expires in about 30 seconds, so exchange it immediately.

### 3. Exchange the authorization code

Run the following command after replacing the four placeholder values. The
redirect URI must exactly match the callback URI configured above.

```bash
curl --request POST https://wbsapi.withings.net/v2/oauth2 \
  --data action=requesttoken \
  --data grant_type=authorization_code \
  --data client_id=YOUR_CLIENT_ID \
  --data client_secret=YOUR_CLIENT_SECRET \
  --data code=AUTHORIZATION_CODE \
  --data redirect_uri=http://localhost
```

A successful response has `status: 0` and contains tokens under `body`:

```json
{"status":0,"body":{"access_token":"...","refresh_token":"..."}}
```

Copy `body.refresh_token` into the `WITHINGS_REFRESH_TOKEN` repository secret
under **Settings -> Secrets and variables -> Actions**. Do not commit or share
the response. If the exchange reports an invalid or expired code, repeat the
authorization step and exchange the new code immediately.

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
| Token refresh returns 401 or 601 | Repeat **Get the initial refresh token**, update `WITHINGS_REFRESH_TOKEN`, then remove or replace the stale `withingsRefreshToken` field in `/syncState/{uid}`. |
| Firestore returns `403` | Verify the administrative service account has Cloud Datastore User. |
| No measurements are written | Withings groups without a positive weight are intentionally skipped to match the application schema. |
