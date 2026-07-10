/**
 * Backup module — copies all tab data from the source spreadsheet to a
 * separate "Stronger - Backup" spreadsheet after each workout save.
 *
 * The backup spreadsheet ID is persisted in the app settings (Settings tab,
 * key `backupSpreadsheetId`). If no backup sheet exists yet, one is created
 * automatically. If the stored backup sheet is inaccessible (deleted, unshared),
 * a new one is created and the setting is updated.
 */

import { TARGET_TAB_NAME, WORKOUT_DEFS_TAB_NAME, LOG_TAB_NAME, SCHEDULE_TAB_NAME, WORKOUT_SCHEDULE_TAB_NAME, CARDIO_TAB_NAME, STRAVA_TAB_NAME, SETTINGS_TAB_NAME } from './config.ts'
import { getGapiErrorStatus } from './auth.ts'

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const BACKUP_SHEET_TITLE = 'Stronger - Backup'

/** Settings key used to persist the backup spreadsheet ID. */
export const BACKUP_SETTING_KEY = 'backupSpreadsheetId'

/** All tabs that should be backed up, in order. */
const TABS_TO_BACKUP: string[] = [
	TARGET_TAB_NAME,
	WORKOUT_DEFS_TAB_NAME,
	LOG_TAB_NAME,
	SCHEDULE_TAB_NAME,
	WORKOUT_SCHEDULE_TAB_NAME,
	CARDIO_TAB_NAME,
	STRAVA_TAB_NAME,
	SETTINGS_TAB_NAME,
]

/** Open-ended column range used when reading/writing entire tab contents. */
const FULL_COLUMN_RANGE = 'A:ZZ'

/* ------------------------------------------------------------------ */
/*  Core backup logic                                                  */
/* ------------------------------------------------------------------ */

/**
 * Perform a full backup of all Stronger tabs from the source spreadsheet
 * to a separate backup spreadsheet.
 *
 * @param sourceSpreadsheetId The primary spreadsheet to back up.
 * @param settings            Current app settings map (used to look up / store the backup ID).
 * @returns The backup spreadsheet ID (may be new if one was just created).
 *          The caller is responsible for persisting the updated settings if the
 *          returned ID differs from what was in the settings map.
 */
export async function performBackup(
	sourceSpreadsheetId: string,
	settings: Map<string, string>,
): Promise<string> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	let backupId = settings.get(BACKUP_SETTING_KEY) ?? undefined

	// Verify existing backup sheet is still accessible.
	// Only treat 404 (deleted) or 403 (unshared) as "gone" — for transient
	// errors (network, rate-limit, etc.) we re-throw so the caller retries
	// later rather than silently spinning up a duplicate backup sheet.
	if (backupId) {
		try {
			await gapi.client.sheets.spreadsheets.get({ spreadsheetId: backupId })
		} catch (err) {
			const status = getGapiErrorStatus(err)
			if (status === 404 || status === 403) {
				// Backup sheet is truly gone — create a fresh one
				backupId = undefined
			} else {
				// Transient error — propagate so we retry next time
				throw err
			}
		}
	}

	// Create backup spreadsheet if needed
	if (!backupId) {
		const response = await gapi.client.sheets.spreadsheets.create({
			resource: { properties: { title: BACKUP_SHEET_TITLE } },
		})
		if (!response.result.spreadsheetId) {
			throw new Error('Failed to create backup spreadsheet — no ID returned')
		}
		backupId = response.result.spreadsheetId
	}

	// Determine which tabs exist in the source
	const sourceInfo = await gapi.client.sheets.spreadsheets.get({
		spreadsheetId: sourceSpreadsheetId,
	})
	const sourceTabs = new Set(
		(sourceInfo.result.sheets ?? []).map((s) => s.properties.title),
	)

	// Determine which tabs already exist in the backup
	const backupInfo = await gapi.client.sheets.spreadsheets.get({
		spreadsheetId: backupId,
	})
	const backupSheets = backupInfo.result.sheets ?? []
	const backupTabs = new Set(backupSheets.map((s) => s.properties.title))

	// Copy each tab
	for (const tabName of TABS_TO_BACKUP) {
		if (!sourceTabs.has(tabName)) continue

		// Read all data from the source tab (open-ended range)
		const readRange = `'${tabName}'!${FULL_COLUMN_RANGE}`
		let values: string[][] = []
		try {
			const response = await gapi.client.sheets.spreadsheets.values.get({
				spreadsheetId: sourceSpreadsheetId,
				range: readRange,
			})
			values = response.result.values ?? []
		} catch {
			// Tab exists but might be empty or unreadable — skip
			continue
		}

		// Ensure the tab exists in the backup
		if (!backupTabs.has(tabName)) {
			await gapi.client.sheets.spreadsheets.batchUpdate({
				spreadsheetId: backupId,
				resource: {
					requests: [{ addSheet: { properties: { title: tabName } } }],
				},
			})
			backupTabs.add(tabName)
		}

		// Clear existing backup data and write fresh
		const writeRange = `'${tabName}'!${FULL_COLUMN_RANGE}`
		await gapi.client.sheets.spreadsheets.values.clear({
			spreadsheetId: backupId,
			range: writeRange,
		})

		if (values.length > 0) {
			await gapi.client.sheets.spreadsheets.values.update({
				spreadsheetId: backupId,
				range: `'${tabName}'!A1`,
				valueInputOption: 'RAW',
				resource: { values },
			})
		}
	}

	// Clean up the default "Sheet1" tab if it still exists and we have other tabs
	const finalInfo = await gapi.client.sheets.spreadsheets.get({
		spreadsheetId: backupId,
	})
	const finalSheets = finalInfo.result.sheets ?? []
	const sheet1 = finalSheets.find((s) => s.properties.title === 'Sheet1')
	if (sheet1 && finalSheets.length > 1) {
		try {
			await gapi.client.sheets.spreadsheets.batchUpdate({
				spreadsheetId: backupId,
				resource: {
					requests: [{
						deleteSheet: { sheetId: sheet1.properties.sheetId },
					}],
				},
			})
		} catch {
			// Not critical — leave Sheet1 if deletion fails
		}
	}

	return backupId
}
