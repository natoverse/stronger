# Feature: Scheduled Sheet Backup

> Move the "backup the spreadsheet after each workout" logic out of the app and into a simple scheduled GitHub Action that copies a source spreadsheet to a backup spreadsheet once a day.

## What

The app previously backed up the whole spreadsheet on every workout save (`src/google/backup.ts`, `runBackup` in `App.tsx`). That coupled backups to app usage, ran redundant full copies on every save, and stored a backup spreadsheet ID in the Settings tab.

This replaces that with a scheduled GitHub Actions workflow (`sheet-backup.yml`) that runs `scripts/sheet-backup.py` once a day. The script authenticates with the existing Google service account, lists every tab in the source spreadsheet, and copies each tab's values into a separate backup spreadsheet (creating tabs as needed, then clearing and rewriting). It mirrors the Garmin/Withings sync pipelines: no backend, service-account auth, cron + `workflow_dispatch`.

The source and backup spreadsheet IDs are supplied as environment variables (`SOURCE_SPREADSHEET_ID`, `BACKUP_SPREADSHEET_ID`); the workflow maps the source from the existing `SPREADSHEET_ID` secret and reads the target from a new `BACKUP_SPREADSHEET_ID` secret.

## Acceptance Criteria

- [x] A new GitHub Actions workflow (`sheet-backup.yml`) runs on a daily cron schedule and on `workflow_dispatch`
- [x] The workflow authenticates with a Google service account and copies every source tab into the backup spreadsheet
- [x] Missing tabs are created in the backup; matching tabs are cleared and rewritten (value-only copy)
- [x] Source and backup IDs are configurable; the script errors if they are equal
- [x] The in-app backup logic is removed (`src/google/backup.ts`, its test, the `performBackup`/`BACKUP_SETTING_KEY` exports, and `runBackup` in `App.tsx`)
- [x] Offline tests cover the pure tab-selection helpers (`scripts/test_sheet_backup.py`)
- [x] Setup instructions are documented (`SHEET_BACKUP_SETUP.md`)

## Scope

### In scope
- Python backup script + offline tests
- Scheduled GitHub Actions workflow
- Removal of the in-app backup code path
- Setup documentation

### Out of scope
- Formatting/formula-preserving copies (only cell values are copied, matching the old behavior)
- Pruning backup-only tabs that no longer exist in the source
- Point-in-time / versioned backups (each run overwrites the previous backup)

## Notes

- The backup is a value-only copy over the open-ended range `A:ZZ`, consistent with the previous in-app implementation.
- Runs at 07:00 UTC, after the 06:00 Garmin sync, to avoid overlapping quota bursts.
