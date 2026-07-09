# Garmin Sync Setup

Stronger syncs activity data into Google Sheets directly from **Garmin Connect**. A scheduled GitHub Actions workflow (or any machine with `python`) pulls recent activities into the `Stronger - Strava` tab in your spreadsheet.

The workflow runs daily at 06:00 UTC and can also be triggered manually. It's idempotent — re-runs won't create duplicate rows.

> **Migration note:** This replaces the old Strava-based sync. Strava's API is now behind a paid membership, so we go straight to the source (Garmin). The sheet tab keeps its legacy name `Stronger - Strava` and its columns so the app's activity charts keep working with no changes — only the data source changed. The column formerly called `stravaId` now holds the Garmin activity ID (still used for deduplication).

## How it works

1. A one-time browser login mints a Garmin OAuth token dump (`garth`). You store it as a repo secret.
2. A GitHub Actions workflow runs `scripts/garmin-sync.py` on a daily schedule.
3. The script loads the saved tokens, refreshes the short-lived access token, fetches the 30 most recent activities, deduplicates by Garmin activity ID, and appends new rows to the sheet via a Google service account.

### Why a one-time browser login?

Garmin has no public developer API, and since March 2026 the Garmin **login page** is protected by Cloudflare fingerprinting that blocks non-browser HTTP clients ([details](https://github.com/matin/garth/discussions/222)). However, **token refresh still works** from a plain HTTP client — only the initial login is blocked. So you log in once in a browser to mint tokens, then the recurring sync runs fully headless (in Actions or on a server) using those saved tokens. Garmin OAuth1 tokens last about a year before you need to re-mint them.

## Data stored

Each activity row in the `Stronger - Strava` tab contains:

| Column | Description |
|--------|-------------|
| `date` | Activity date (YYYY-MM-DD) |
| `id` | Garmin activity ID (used for deduplication) |
| `activityType` | Garmin activity type key (e.g. `running`, `cycling`, `strength_training`) |
| `name` | Activity name from Garmin |
| `duration` | Duration in seconds |
| `distance` | Distance in meters (0 for stationary activities) |
| `elevationGain` | Total elevation gain in meters |
| `calories` | Calories burned |
| `avgHR` | Average heart rate in bpm (0 if not recorded) |
| `maxHR` | Max heart rate in bpm (0 if not recorded) |

## Prerequisites

- A Garmin Connect account with your activities
- Python 3.12+ on the machine you use to mint the token dump
- A Google Cloud service account with editor access to your spreadsheet
- A GitHub repository (this one) with Actions enabled — or any machine that can run the script on a cron

## Step 1: Mint a Garmin token dump

Install the sync dependencies and log in **once** to produce a base64 token dump. Do this on your own machine (the login needs a real browser session / your credentials, so never put your Garmin password in CI).

```bash
pip install -r scripts/requirements.txt
python3 - <<'PY'
import garth, getpass
# Interactive login (prompts for email, password, and MFA code if enabled).
garth.login(input("Garmin email: "), getpass.getpass("Garmin password: "))
print("\nGARMIN_TOKENS secret value:\n")
print(garth.client.dumps())
PY
```

Copy the printed base64 string — that's your `GARMIN_TOKENS` secret.

> If the interactive login is blocked by Cloudflare, use a browser-login helper such as [`garmin-browser-login`](https://github.com/sidequest-scribe/garmin-browser-login) to obtain `garth`-compatible tokens, then call `garth.client.dumps()` to produce the same base64 string.

## Step 2: Create a Google service account

The sync script uses a service account (not your personal OAuth) to write to the spreadsheet.

1. In the [Google Cloud Console](https://console.cloud.google.com/), go to **IAM & Admin → Service Accounts**.
2. Click **Create Service Account**.
3. Name it something like `stronger-sync` and click **Create and Continue**.
4. Skip the optional role and user access steps — click **Done**.
5. Click on the new service account, go to the **Keys** tab.
6. Click **Add Key → Create New Key → JSON**. Download the key file.
7. Copy the entire JSON content — you'll paste it into a repo secret.

## Step 3: Share your spreadsheet with the service account

1. Open the JSON key file and find the `client_email` field (e.g. `stronger-sync@your-project.iam.gserviceaccount.com`).
2. Open your Stronger spreadsheet in Google Sheets.
3. Click **Share** and add the service account email as an **Editor**.

## Step 4: Configure repository secrets

Go to your GitHub repo → **Settings → Secrets and variables → Actions** and add these 3 secrets:

| Secret | Value |
|--------|-------|
| `GARMIN_TOKENS` | The base64 token dump from Step 1 |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | The full JSON content of the service account key file |
| `SPREADSHEET_ID` | The ID from your spreadsheet URL (`https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`) |

## Step 5: Test the workflow

1. Go to **Actions → Garmin Sync (Garmin Connect → Google Sheets)**.
2. Click **Run workflow** → **Run workflow** (on the main branch).
3. Check that the workflow completes successfully.
4. Open your spreadsheet — you should see the `Stronger - Strava` tab populated with your recent activities.

After verifying, the daily cron at 06:00 UTC will keep it updated automatically.

## Running on your own machine instead

If you'd rather not use GitHub Actions (or want more frequent syncs), run the script from any machine with the same three environment variables set:

```bash
pip install -r scripts/requirements.txt
export GARMIN_TOKENS="...base64 dump..."
export GOOGLE_SERVICE_ACCOUNT_KEY="$(cat service-account.json)"
export SPREADSHEET_ID="your-spreadsheet-id"
python scripts/garmin-sync.py
```

Wire it into `cron` (or a systemd timer) to run on whatever schedule you like.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Workflow fails with "Missing GARMIN_TOKENS" | The token dump secret is not set. Re-do Step 1 and Step 4. |
| Workflow fails with "Missing GOOGLE_SERVICE_ACCOUNT_KEY" | The service account key secret is not set or is malformed. Paste the entire JSON content. |
| Workflow fails with "Missing SPREADSHEET_ID" | The spreadsheet ID secret is not set. |
| Garmin auth fails (401 / token error) | The saved tokens likely expired (~1 year) or were revoked. Re-mint them (Step 1) and update the `GARMIN_TOKENS` secret. |
| Sheets API returns 403 | The service account doesn't have editor access to the spreadsheet. Re-do Step 3. |
| "No new activities to sync" | All recent activities are already in the sheet. This is normal on re-runs. |
