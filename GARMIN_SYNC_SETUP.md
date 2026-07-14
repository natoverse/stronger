# Garmin Sync Setup

Stronger syncs activity data into Google Sheets directly from **Garmin Connect**. A scheduled GitHub Actions workflow (or any machine with `python`) pulls recent activities into a dedicated `Stronger - Garmin` tab in your spreadsheet.

The workflow runs daily at 06:00 UTC and can also be triggered manually. It's idempotent — re-runs won't create duplicate rows.

> **Migration note:** This replaces the old Strava-based sync. Strava's API is now behind a paid membership, so we go straight to the source (Garmin). Garmin exposes richer metrics than Strava did, so the data lands in its own `Stronger - Garmin` tab with a Garmin-native schema. The legacy `Stronger - Strava` tab is left in place and deprecated gradually as the app's activity view is migrated over.

## How it works

1. A one-time local login mints a Garmin token bundle (`garminconnect`). You store it as a repo secret.
2. A GitHub Actions workflow runs `scripts/garmin-sync.py` on a daily schedule.
3. The script loads the saved tokens, refreshes the short-lived access token, fetches the 30 most recent activities, deduplicates by Garmin activity ID, and appends new rows to the sheet via a Google service account.

### Authentication

Garmin has no public developer API. We use [`python-garminconnect`](https://github.com/cyberjunky/python-garminconnect), the maintained client that [GarminDB](https://github.com/tcgoetz/GarminDB) also uses. It logs in via Garmin's mobile SSO flow with `curl_cffi` TLS impersonation, which restores fully **headless** logins (no browser needed). Once you mint a token bundle, the recurring sync runs headless in Actions or on a server using those saved tokens. The DI refresh token auto-renews the short-lived access token indefinitely; a full re-login is only needed if the refresh token is revoked or expires.

## Data stored

Each activity row in the `Stronger - Garmin` tab contains:

| Column | Description |
|--------|-------------|
| `date` | Activity date (YYYY-MM-DD) |
| `activityId` | Garmin activity ID (used for deduplication) |
| `activityType` | Garmin activity type key (e.g. `running`, `cycling`, `strength_training`) |
| `name` | Activity name from Garmin |
| `duration` | Total duration in seconds |
| `movingDuration` | Moving duration in seconds |
| `distance` | Distance in meters (0 for stationary activities) |
| `elevationGain` | Total elevation gain in meters |
| `elevationLoss` | Total elevation loss in meters |
| `calories` | Calories burned |
| `avgHR` | Average heart rate in bpm (0 if not recorded) |
| `maxHR` | Max heart rate in bpm (0 if not recorded) |
| `avgSpeed` | Average speed in m/s (0 if not recorded) |
| `maxSpeed` | Max speed in m/s (0 if not recorded) |
| `steps` | Step count (0 if not applicable) |
| `aerobicTE` | Aerobic training effect (0–5, 0 if not recorded) |
| `anaerobicTE` | Anaerobic training effect (0–5, 0 if not recorded) |
| `vo2Max` | VO2 max estimate for the activity (0 if not recorded) |

## Prerequisites

- A Garmin Connect account with your activities
- Python 3.12+ on the machine you use to mint the token dump
- A Google Cloud service account with editor access to your spreadsheet
- A GitHub repository (this one) with Actions enabled — or any machine that can run the script on a cron

## Step 1: Mint a Garmin token bundle

Install the sync dependencies and log in **once** to produce a saved token bundle. Do this on your own machine (the login needs your credentials, so never put your Garmin password in CI). The login is headless — no browser required.

```bash
pip install -r scripts/requirements.txt
python3 - <<'PY'
import getpass
from pathlib import Path
from garminconnect import Garmin

email = input("Garmin email: ")
password = getpass.getpass("Garmin password: ")

# Interactive login (prompts for an MFA code if your account has it enabled).
garmin = Garmin(email=email, password=password, prompt_mfa=lambda: input("MFA code: "))
garmin.login("~/.garminconnect")  # saves ~/.garminconnect/garmin_tokens.json

print("\nGARMIN_TOKENS secret value:\n")
print(Path("~/.garminconnect/garmin_tokens.json").expanduser().read_text())
PY
```

Copy the printed JSON — that's your `GARMIN_TOKENS` secret.

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
| `GARMIN_TOKENS` | The token bundle JSON from Step 1 |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | The full JSON content of the service account key file |
| `SPREADSHEET_ID` | The ID from your spreadsheet URL (`https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`) |

## Step 5: Test the workflow

1. Go to **Actions → Garmin Sync (Garmin Connect → Google Sheets)**.
2. Click **Run workflow** → **Run workflow** (on the main branch).
3. Check that the workflow completes successfully.
4. Open your spreadsheet — you should see a `Stronger - Garmin` tab populated with your recent activities.

After verifying, the daily cron at 06:00 UTC will keep it updated automatically.

## Running on your own machine instead

If you'd rather not use GitHub Actions (or want more frequent syncs), run the script from any machine with the same three environment variables set:

```bash
pip install -r scripts/requirements.txt
export GARMIN_TOKENS="$(cat ~/.garminconnect/garmin_tokens.json)"
export GOOGLE_SERVICE_ACCOUNT_KEY="$(cat service-account.json)"
export SPREADSHEET_ID="your-spreadsheet-id"
python scripts/garmin-sync.py
```

Wire it into `cron` (or a systemd timer) to run on whatever schedule you like.

## Backfilling older history

By default the sync only fetches the most recent activities, which is all the daily cron needs. Garmin Connect keeps your **full** history, so there's no limit on how far back you can pull — you just have to ask for it.

To backfill, run the script with the `--backfill` flag. It fetches every activity since **2021-01-01** (matching the earliest year in the in-app year picker), deduplicates by activity ID, and appends only new rows:

```bash
python scripts/garmin-sync.py --backfill
```

From GitHub Actions, trigger a backfill via **Actions → Garmin Sync → Run workflow**, which has a **backfill** checkbox (leave it unchecked for a normal recent-activity sync). Because the sync dedups by Garmin activity ID, running a backfill won't create duplicate rows, and the daily runs keep fetching just recent activities afterwards.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Workflow fails with "Missing GARMIN_TOKENS" | The token bundle secret is not set. Re-do Step 1 and Step 4. |
| Workflow fails with "Missing GOOGLE_SERVICE_ACCOUNT_KEY" | The service account key secret is not set or is malformed. Paste the entire JSON content. |
| Workflow fails with "Missing SPREADSHEET_ID" | The spreadsheet ID secret is not set. |
| Garmin auth fails (401 / token error) | The saved tokens were revoked or the refresh token expired. Re-mint them (Step 1) and update the `GARMIN_TOKENS` secret. |
| Sheets API returns 403 | The service account doesn't have editor access to the spreadsheet. Re-do Step 3. |
| "No new activities to sync" | All recent activities are already in the sheet. This is normal on re-runs. |
