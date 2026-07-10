# Withings Sync Setup

Stronger can sync body-composition data (weight, body fat, muscle mass, bone mass, hydration) into Google Sheets via the Withings API. A scheduled GitHub Actions workflow pulls your latest measurements into a "Stronger - Withings" tab in your spreadsheet.

The workflow runs daily at 06:30 UTC and can also be triggered manually. It's idempotent — re-runs won't create duplicate rows.

## How it works

1. You step on a Withings scale; measurements upload to your Withings account.
2. A GitHub Actions workflow runs `scripts/withings-sync.mjs` on a daily schedule.
3. The script refreshes a Withings OAuth2 token, fetches the last 60 days of measurements, deduplicates by Withings measurement group ID, and appends new rows to the sheet via a Google service account.

### The rotating refresh token

Unlike Strava (whose refresh tokens never expire), **Withings rotates its refresh token on every refresh** — each token exchange invalidates the previous refresh token (it stops working 8 hours later) and returns a new one. A stateless cron job reading a fixed secret would work once and then break.

To handle this, the script stores the current refresh token in a **"Stronger - Infra"** tab in the same spreadsheet: it reads the token at the start of each run and writes the rotated token back at the end. The `WITHINGS_REFRESH_TOKEN` secret is only the *initial seed* — used the first time the script runs, before the Infra tab has a stored token.

You don't need to create the Infra tab yourself; the script creates it (with a `key`/`value` header) on first run. Leave it alone — it's internal plumbing.

## Data stored

Each row in the "Stronger - Withings" tab is one weigh-in and contains:

| Column | Description |
|--------|-------------|
| `date` | Measurement date (YYYY-MM-DD, UTC) |
| `grpId` | Withings measurement group ID (used for deduplication) |
| `weight` | Body weight in kg |
| `fatMass` | Fat mass in kg (blank if not measured) |
| `fatRatio` | Body fat percentage (blank if not measured) |
| `muscleMass` | Muscle mass in kg (blank if not measured) |
| `boneMass` | Bone mass in kg (blank if not measured) |
| `hydration` | Body water in kg (blank if not measured) |
| `fatFreeMass` | Fat-free (lean) mass in kg (blank if not measured) |
| `heartRate` | Resting heart rate in bpm at weigh-in (blank if not measured) |

Cells are blank when a given weigh-in didn't capture that metric (e.g. a scale without body-composition sensors reports only `weight`).

> **Units:** the sheet stores masses in **kilograms** (matching the Withings API). The app converts to **pounds** for display — you'll only ever see lb in the Body Composition view. Body fat is a percentage and heart rate is bpm; neither is converted.

## Prerequisites

- A Withings account with a connected scale
- A Google Cloud service account with editor access to your spreadsheet
- A GitHub repository (this one) with Actions enabled

## Step 1: Create a Withings API application

1. Go to the [Withings Developer Dashboard](https://developer.withings.com/dashboard/) and sign in.
2. Create a new application:
   - **Application type**: choose **Public API integration** (a "Developer" / evaluation app is fine for personal use).
   - **Application name**: anything (e.g. "Stronger Sync").
   - **Callback URI**: `http://localhost` (used only for the one-time authorization below).
3. Note your **Client ID** and **Client Secret**.

## Step 2: Get a Withings refresh token

You need a one-time OAuth2 authorization to get the initial refresh token.

1. Open this URL in your browser, replacing `YOUR_CLIENT_ID`. Note the **read-only** `user.metrics` scope — the sync only ever reads measurements, never writes to your Withings account:

   ```
   https://account.withings.com/oauth2_user/authorize2?response_type=code&client_id=YOUR_CLIENT_ID&scope=user.metrics&redirect_uri=http://localhost&state=stronger
   ```

2. Authorize the app. You'll be redirected to `http://localhost/?code=AUTHORIZATION_CODE&state=stronger` — copy the `code` value from the URL. (Your browser will show a "can't connect" page — that's expected; the code is in the address bar.)

3. Exchange the code for tokens. Withings uses a single `/v2/oauth2` endpoint with an `action` parameter:

   ```bash
   curl -X POST https://wbsapi.withings.net/v2/oauth2 \
     -d action=requesttoken \
     -d grant_type=authorization_code \
     -d client_id=YOUR_CLIENT_ID \
     -d client_secret=YOUR_CLIENT_SECRET \
     -d code=AUTHORIZATION_CODE \
     -d redirect_uri=http://localhost
   ```

4. The response JSON looks like `{ "status": 0, "body": { "refresh_token": "...", ... } }`. Copy the `refresh_token` value from inside `body` — this is your seed token.

   > The authorization code is single-use and expires within ~30 seconds. If the exchange fails with an invalid-code error, re-do steps 1–3 to get a fresh code.

## Step 3: Create a Google service account

The sync script uses a service account (not your personal OAuth) to write to the spreadsheet. **If you already set this up for the Strava sync, reuse the same service account and skip to Step 5.**

1. In the [Google Cloud Console](https://console.cloud.google.com/), go to **IAM & Admin → Service Accounts**.
2. Click **Create Service Account**.
3. Name it something like `stronger-sync` and click **Create and Continue**.
4. Skip the optional role and user access steps — click **Done**.
5. Click on the new service account, go to the **Keys** tab.
6. Click **Add Key → Create New Key → JSON**. Download the key file.
7. Copy the entire JSON content — you'll paste it into a repo secret.

## Step 4: Share your spreadsheet with the service account

1. Open the JSON key file and find the `client_email` field (e.g. `stronger-sync@your-project.iam.gserviceaccount.com`).
2. Open your Stronger spreadsheet in Google Sheets.
3. Click **Share** and add the service account email as an **Editor**.

## Step 5: Configure repository secrets

Go to your GitHub repo → **Settings → Secrets and variables → Actions** and add these secrets (`GOOGLE_SERVICE_ACCOUNT_KEY` and `SPREADSHEET_ID` are shared with the Strava sync — you only need to add them once):

| Secret | Value |
|--------|-------|
| `WITHINGS_CLIENT_ID` | Your Withings API client ID |
| `WITHINGS_CLIENT_SECRET` | Your Withings API client secret |
| `WITHINGS_REFRESH_TOKEN` | The seed refresh token from Step 2 |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | The full JSON content of the service account key file |
| `SPREADSHEET_ID` | The ID from your spreadsheet URL (`https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`) |

## Step 6: Test the workflow

1. Go to **Actions → Withings Sync (Withings → Google Sheets)**.
2. Click **Run workflow** → **Run workflow** (on the main branch).
3. Check that the workflow completes successfully.
4. Open your spreadsheet — you should see a new "Stronger - Withings" tab with your recent measurements (and a "Stronger - Infra" tab holding the rotated token).

After verifying, the daily cron at 06:30 UTC will keep it updated automatically.

## Backfilling history

The daily sync only fetches the last 60 days each run — enough to catch new weigh-ins, but it won't reach back over your full history. To import everything since **2021-01-01** (matching the earliest year in the app's year picker), run a one-time backfill.

### From GitHub Actions (recommended)

1. Go to **Actions → Withings Sync (Withings → Google Sheets)**.
2. Click **Run workflow**.
3. Check the **Backfill full history** box, then **Run workflow**.

This reuses the secrets already stored in the repo, so nothing sensitive touches your machine. Run it **off-schedule** (not right around the 06:30 UTC cron) — the backfill rotates your Withings refresh token, and two overlapping runs could invalidate each other's token.

### From the command line

Alternatively, run the script directly with the `--backfill` flag:

```bash
WITHINGS_CLIENT_ID=... \
WITHINGS_CLIENT_SECRET=... \
WITHINGS_REFRESH_TOKEN=... \
GOOGLE_SERVICE_ACCOUNT_KEY="$(cat service-account.json)" \
SPREADSHEET_ID=... \
node scripts/withings-sync.mjs --backfill
```

Either way, this is a one-time operation. Deduplication by measurement group ID means it's safe to run over data that's already in the sheet — it only appends what's missing. After the backfill, the normal daily cron takes over with its incremental 60-day window.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Workflow fails with "Missing Withings environment variables" | One or more of the 3 Withings secrets are not configured. Check Settings → Secrets. |
| Workflow fails with "Missing GOOGLE_SERVICE_ACCOUNT_KEY" | The service account key secret is not set or is malformed. Paste the entire JSON content. |
| Workflow fails with "Missing SPREADSHEET_ID" | The spreadsheet ID secret is not set. |
| Token refresh returns status 401 or 601 | The stored refresh token is invalid — usually because a manual token exchange elsewhere rotated it out from under the sheet. Delete the `withings_refresh_token` row from the "Stronger - Infra" tab, refresh the `WITHINGS_REFRESH_TOKEN` secret via Step 2, and re-run. |
| Sheets API returns 403 | The service account doesn't have editor access to the spreadsheet. Re-do Step 4. |
| "No new measurements to sync" | All recent weigh-ins are already in the sheet. This is normal on re-runs. |
| Body-composition columns are blank | Your scale may not measure body composition, or those sensors weren't triggered. Only `weight` is guaranteed. |
