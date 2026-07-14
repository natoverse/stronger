# Sheet Backup Setup

Stronger keeps a daily backup of your primary spreadsheet in a separate **backup spreadsheet**. A scheduled GitHub Actions workflow (or any machine with `python`) copies every tab from the source sheet into the backup sheet once a day.

The workflow runs daily at 07:00 UTC and can also be triggered manually. It's a value-only copy: each source tab is created in the backup if missing, cleared, and rewritten with the current source values.

> **Migration note:** This replaces the old in-app "backup after each workout save" logic. Expressing the backup as a simple scheduled job (source sheet ID → backup sheet ID) keeps the app focused on the workout flow and makes the backup independent of whether/when the app is used.

## How it works

1. A GitHub Actions workflow runs `scripts/sheet-backup.py` on a daily schedule.
2. The script authenticates with a Google service account, lists every tab in the source spreadsheet, and copies each tab's values into the backup spreadsheet.
3. Tabs that exist only in the backup are left untouched; matching tabs are overwritten with fresh source data.

## One-time setup

1. **Create a backup spreadsheet.** In Google Sheets, create a new, empty spreadsheet to hold the backups. Copy its spreadsheet ID from the URL (`https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`).
2. **Share both sheets with the service account.** Give the service account (the same one used by the Garmin/Withings syncs) **Editor** access to both the source and backup spreadsheets.
3. **Add repository secrets** (Settings → Secrets and variables → Actions):
   - `GOOGLE_SERVICE_ACCOUNT_KEY` — JSON key for the Google service account (already set up if the other syncs run).
   - `SPREADSHEET_ID` — the primary/source spreadsheet ID (already set up if the other syncs run).
   - `BACKUP_SPREADSHEET_ID` — the backup spreadsheet ID from step 1.

That's it — the `Sheet Backup` workflow will run daily and can be triggered manually from the Actions tab.

## Running locally

```sh
pip install -r scripts/requirements.txt
export GOOGLE_SERVICE_ACCOUNT_KEY="$(cat service-account.json)"
export SOURCE_SPREADSHEET_ID="<source spreadsheet id>"
export BACKUP_SPREADSHEET_ID="<backup spreadsheet id>"
python scripts/sheet-backup.py
```

Offline tests for the pure helpers:

```sh
python scripts/test_sheet_backup.py
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | JSON key for the Google service account (needs Editor on both sheets) |
| `SOURCE_SPREADSHEET_ID` | Spreadsheet to copy from (the primary sheet). The workflow maps this from the `SPREADSHEET_ID` secret. |
| `BACKUP_SPREADSHEET_ID` | Spreadsheet to copy into (the backup target) |

The source and backup IDs must differ; the script exits with an error if they're the same.
