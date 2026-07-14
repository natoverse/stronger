/**
 * Google Sheets API helpers.
 *
 * Verifies access to a spreadsheet, ensures the "Stronger" tab exists,
 * and provides read/write operations for the config and log zones.
 */

import { TARGET_TAB_NAME, WORKOUT_DEFS_TAB_NAME, LOG_TAB_NAME, SCHEDULE_TAB_NAME, WORKOUT_SCHEDULE_TAB_NAME, CARDIO_TAB_NAME, MEAL_ITEMS_TAB_NAME, MEAL_LOG_TAB_NAME, STRAVA_TAB_NAME, WITHINGS_TAB_NAME, SETTINGS_TAB_NAME } from './config.ts'
import type { LiftConfig, ComputedSet, SetResult, SetTemplate, ExerciseTemplate, ExerciseRole, WeightBasis, PreviousSetData, ScheduleEntry, DayFlags, DayFlagEntry, WorkoutScheduleEntry, CardioActivity, MealCategory, MealItem, MealLogEntry, StravaActivity, WithingsMeasurement, AppSettings, AppBooleanSettingKey, AppPercentSettingKey } from '../model/types.ts'
import type { StravaGoal, StravaMetric } from '../model/strava.ts'
import type { WithingsGoal, WithingsMetric } from '../model/withings.ts'
import type { WorkoutDefinition } from '../data/sample-workouts.ts'

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** A1 range for the config zone (open-ended rows). */
const CONFIG_RANGE = `'${TARGET_TAB_NAME}'!A:I`

/** A1 range for the log zone header (row 1 of the log tab). */
const LOG_HEADER_RANGE = `'${LOG_TAB_NAME}'!A1:M1`

/** A1 range used for appending log data (row 2 onward). */
const LOG_APPEND_RANGE = `'${LOG_TAB_NAME}'!A2:M2`

/** A1 range for reading all log data (row 2 onward, open-ended). */
const LOG_READ_RANGE = `'${LOG_TAB_NAME}'!A2:M`

const CONFIG_HEADER: string[] = [
	'id',
	'name',
	'topSetWeight',
	'backoffWeight',
	'increment',
	'minimumWeight',
	'roundingFactor',
	'barWeight',
	'gear',
]

const LOG_HEADER: string[] = [
	'date',
	'startTime',
	'endTime',
	'workoutId',
	'exerciseName',
	'liftId',
	'setNumber',
	'setType',
	'plannedWeight',
	'plannedReps',
	'actualWeight',
	'actualReps',
	'completed',
]

/* ------------------------------------------------------------------ */
/*  Sheet access verification                                          */
/* ------------------------------------------------------------------ */

export interface SheetInfo {
	title: string
	strongerTabExists: boolean
}

/**
 * Verify that the authenticated user can access the given spreadsheet.
 * Returns basic metadata including whether the target tab already exists.
 *
 * Throws if the sheet is inaccessible or the API call fails.
 */
export async function verifySheetAccess(
	spreadsheetId: string,
): Promise<SheetInfo> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const response = await gapi.client.sheets.spreadsheets.get({
		spreadsheetId,
	})
	const sheets = response.result.sheets ?? []
	const strongerTabExists = sheets.some(
		(s) => s.properties.title === TARGET_TAB_NAME,
	)
	return {
		title: response.result.properties.title,
		strongerTabExists,
	}
}

/* ------------------------------------------------------------------ */
/*  Tab creation                                                       */
/* ------------------------------------------------------------------ */

/**
 * Create the "Stronger" tab inside the given spreadsheet.
 * This is a no-op if the tab already exists (callers should check first).
 */
export async function createStrongerTab(
	spreadsheetId: string,
): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	await gapi.client.sheets.spreadsheets.batchUpdate({
		spreadsheetId,
		resource: {
			requests: [{ addSheet: { properties: { title: TARGET_TAB_NAME } } }],
		},
	})
}

/* ------------------------------------------------------------------ */
/*  Spreadsheet creation                                               */
/* ------------------------------------------------------------------ */

/**
 * Create a brand-new Google Spreadsheet with the given title.
 * Returns the new spreadsheet's ID.
 */
export async function createSpreadsheet(title: string): Promise<string> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const response = await gapi.client.sheets.spreadsheets.create({
		resource: {
			properties: { title },
		},
	})
	return response.result.spreadsheetId
}

/* ------------------------------------------------------------------ */
/*  Combined connect flow                                              */
/* ------------------------------------------------------------------ */

/**
 * High-level helper: verify sheet access and ensure the "Stronger - Exercises" tab
 * exists. Returns the spreadsheet title.
 */
export async function connectToSheet(spreadsheetId: string): Promise<string> {
	const info = await verifySheetAccess(spreadsheetId)
	if (!info.strongerTabExists) {
		await createStrongerTab(spreadsheetId)
	}
	return info.title
}

/* ------------------------------------------------------------------ */
/*  Log tab management                                                 */
/* ------------------------------------------------------------------ */

/**
 * Check if the log tab exists in the spreadsheet.
 */
export async function verifyLogTab(
	spreadsheetId: string,
): Promise<boolean> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const response = await gapi.client.sheets.spreadsheets.get({
		spreadsheetId,
	})
	const sheets = response.result.sheets ?? []
	return sheets.some(
		(s) => s.properties.title === LOG_TAB_NAME,
	)
}

/**
 * Create the log tab and write the header row.
 */
export async function createLogTab(
	spreadsheetId: string,
): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	await gapi.client.sheets.spreadsheets.batchUpdate({
		spreadsheetId,
		resource: {
			requests: [{ addSheet: { properties: { title: LOG_TAB_NAME } } }],
		},
	})

	// Write log header to row 1
	await gapi.client.sheets.spreadsheets.values.update({
		spreadsheetId,
		range: LOG_HEADER_RANGE,
		valueInputOption: 'RAW',
		resource: { values: [LOG_HEADER] },
	})
}

/* ------------------------------------------------------------------ */
/*  Config zone serialization                                          */
/* ------------------------------------------------------------------ */

/** Convert a LiftConfig to a spreadsheet row (string/number array). */
export function liftConfigToRow(
	config: LiftConfig,
): (string | number)[] {
	return [
		config.id,
		config.name,
		config.topSetWeight,
		config.backoffWeight,
		config.increment,
		config.minimumWeight,
		config.roundingFactor,
		config.barWeight,
		config.gear,
	]
}

/** Check that a number is finite and non-negative. */
function isValidWeight(n: number): boolean {
	return Number.isFinite(n) && n >= 0;
}

/**
 * Parse a spreadsheet row back into a LiftConfig.
 * Returns `null` if the row is missing required fields or contains
 * non-numeric values where numbers are expected.
 */
/** Valid gear type values. */
const VALID_GEAR_TYPES = new Set(['barbell', 'dumbbell', 'band', 'bodyweight', 'other']);

export function rowToLiftConfig(row: string[]): LiftConfig | null {
	// Need at least id (col 0) and name (col 1) plus 5 numeric columns
	if (!row || row.length < 7) return null;

	const id = (row[0] ?? '').trim();
	const name = (row[1] ?? '').trim();
	if (!id || !name) return null;

	const rawTopSet = (row[2] ?? '').trim();
	const rawBackoff = (row[3] ?? '').trim();
	const rawIncrement = (row[4] ?? '').trim();
	const rawMinWeight = (row[5] ?? '').trim();
	const rawRounding = (row[6] ?? '').trim();

	// Reject rows where any numeric field is blank
	if (!rawTopSet || !rawBackoff || !rawIncrement || !rawMinWeight || !rawRounding) {
		return null;
	}

	const topSetWeight = Number(rawTopSet);
	const backoffWeight = Number(rawBackoff);
	const increment = Number(rawIncrement);
	const minimumWeight = Number(rawMinWeight);
	const roundingFactor = Number(rawRounding);

	// Reject rows where any numeric field is NaN, Infinity, or negative
	if (
		!isValidWeight(topSetWeight) ||
		!isValidWeight(backoffWeight) ||
		!isValidWeight(increment) ||
		!isValidWeight(minimumWeight) ||
		!isValidWeight(roundingFactor)
	) {
		return null;
	}

	// barWeight (col 7) — default to 0 if absent or blank (backward compat)
	const rawBarWeight = (row[7] ?? '').trim();
	const barWeight = rawBarWeight ? Number(rawBarWeight) : 0;
	if (!isValidWeight(barWeight)) return null;

	// gear (col 8) — default to 'other' if absent or unrecognized
	const rawGear = (row[8] ?? '').trim().toLowerCase();
	const gear = VALID_GEAR_TYPES.has(rawGear) ? rawGear as LiftConfig['gear'] : 'other';

	return { id, name, topSetWeight, backoffWeight, increment, minimumWeight, roundingFactor, barWeight, gear };
}

/* ------------------------------------------------------------------ */
/*  Config zone read/write                                             */
/* ------------------------------------------------------------------ */

/**
 * Read the config zone and return LiftConfig values.
 * Returns `null` if the config zone is empty or contains no valid rows
 * (first connection, or all rows are invalid).
 */
export async function readConfigZone(
	spreadsheetId: string,
): Promise<LiftConfig[] | null> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const response = await gapi.client.sheets.spreadsheets.values.get({
		spreadsheetId,
		range: CONFIG_RANGE,
	})

	const rows = response.result.values
	if (!rows || rows.length <= 1) {
		// Empty or header-only → first connection
		return null
	}

	// Skip header row, parse data rows, filter out invalid entries
	const configs = rows.slice(1)
		.map(rowToLiftConfig)
		.filter((config): config is LiftConfig => config !== null);
	return configs.length > 0 ? configs : null;
}

/**
 * Write the config header + default lift config values to the config zone.
 * Used on first connection when the tab is empty.
 */
export async function writeDefaultConfig(
	spreadsheetId: string,
	defaults: LiftConfig[],
): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	// Build config zone: header + one row per lift
	const configRows: (string | number)[][] = [
		CONFIG_HEADER,
		...defaults.map(liftConfigToRow),
	]

	// Write config zone
	await gapi.client.sheets.spreadsheets.values.update({
		spreadsheetId,
		range: CONFIG_RANGE,
		valueInputOption: 'RAW',
		resource: { values: configRows },
	})
}

/**
 * Write updated lift config values back to the config zone.
 * Clears existing data (below header) first, then writes all rows.
 * Used by the progression review to persist weight changes and by
 * the exercise editor to add/update exercises.
 */
export async function writeConfigValues(
	spreadsheetId: string,
	configs: LiftConfig[],
): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const rows = configs.map(liftConfigToRow)
	const allRows: (string | number)[][] = [
		CONFIG_HEADER,
		...rows,
	]

	// Clear existing data then write fresh (handles row count changes)
	await gapi.client.sheets.spreadsheets.values.clear({
		spreadsheetId,
		range: CONFIG_RANGE,
	})

	await gapi.client.sheets.spreadsheets.values.update({
		spreadsheetId,
		range: CONFIG_RANGE,
		valueInputOption: 'RAW',
		resource: { values: allRows },
	})
}

/* ------------------------------------------------------------------ */
/*  Log zone serialization                                             */
/* ------------------------------------------------------------------ */

export interface LogContext {
	date: string
	startTime: string
	endTime: string
	workoutId: string
}

/** Build a single log row for one set (strength). */
export function buildLogRow(
	ctx: LogContext,
	exerciseName: string,
	liftId: string,
	setNumber: number,
	setType: string,
	planned: ComputedSet,
	result: SetResult,
): (string | number | boolean)[] {
	return [
		ctx.date,
		ctx.startTime,
		ctx.endTime,
		ctx.workoutId,
		exerciseName,
		liftId,
		setNumber,
		setType,
		planned.weight,
		planned.maxReps,
		result.actualWeight,
		result.actualReps,
		result.completed ? 'TRUE' : 'FALSE',
	]
}

/* ------------------------------------------------------------------ */
/*  Log zone append                                                    */
/* ------------------------------------------------------------------ */

/**
 * Append set-level log rows to the log tab (row 2+).
 * Rows are appended below all existing data.
 */
export async function appendLogRows(
	spreadsheetId: string,
	rows: (string | number | boolean)[][],
): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	await gapi.client.sheets.spreadsheets.values.append({
		spreadsheetId,
		range: LOG_APPEND_RANGE,
		valueInputOption: 'RAW',
		insertDataOption: 'INSERT_ROWS',
		resource: { values: rows },
	})
}

/* ------------------------------------------------------------------ */
/*  Log zone – in-place update                                         */
/* ------------------------------------------------------------------ */

/**
 * Update existing log rows in-place by matching (date, workoutId, startTime).
 *
 * Reads all raw rows from the log tab, finds the ones matching the session
 * key, then overwrites each matching row with the corresponding updated
 * ParsedLogRow. This targets individual rows rather than rewriting the
 * entire log, which is safer for large logs.
 */
export async function updateLogRows(
	spreadsheetId: string,
	sessionDate: string,
	sessionWorkoutId: string,
	sessionStartTime: string,
	updatedRows: ParsedLogRow[],
): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	// Read all raw rows to find sheet-level row numbers
	const response = await gapi.client.sheets.spreadsheets.values.get({
		spreadsheetId,
		range: LOG_READ_RANGE,
	})

	const rawRows = response.result.values
	if (!rawRows || rawRows.length === 0) return

	// Find raw row indices matching this session
	const matchingIndices: number[] = []
	for (let i = 0; i < rawRows.length; i++) {
		const raw = rawRows[i]
		const date = (raw[0] ?? '').trim()
		const startTime = (raw[1] ?? '').trim()
		const workoutId = (raw[3] ?? '').trim()
		if (date === sessionDate && startTime === sessionStartTime && workoutId === sessionWorkoutId) {
			matchingIndices.push(i)
		}
	}

	if (matchingIndices.length === 0) return

	// Build updated row data keyed by (exerciseName, setNumber) for matching
	const updateMap = new Map<string, ParsedLogRow>()
	for (const row of updatedRows) {
		updateMap.set(`${row.exerciseName}:${row.setNumber}`, row)
	}

	// Update each matching row in-place
	for (const rawIdx of matchingIndices) {
		const raw = rawRows[rawIdx]
		const exerciseName = (raw[4] ?? '').trim()
		const setNumber = (raw[6] ?? '').trim()
		const key = `${exerciseName}:${setNumber}`
		const updated = updateMap.get(key)
		if (!updated) continue

		// Row number in sheet = rawIdx + 2 (data starts at row 2, 0-indexed)
		const sheetRow = rawIdx + 2
		const range = `'${LOG_TAB_NAME}'!A${sheetRow}:M${sheetRow}`

		const rowData = [
			updated.date,
			updated.startTime,
			updated.endTime,
			updated.workoutId,
			updated.exerciseName,
			updated.liftId,
			updated.setNumber,
			updated.setType,
			updated.plannedWeight,
			updated.plannedReps,
			updated.actualWeight,
			updated.actualReps,
			updated.completed ? 'TRUE' : 'FALSE',
		]

		await gapi.client.sheets.spreadsheets.values.update({
			spreadsheetId,
			range,
			valueInputOption: 'RAW',
			resource: { values: [rowData] },
		})
	}
}

/* ------------------------------------------------------------------ */
/*  Log zone – delete session                                          */
/* ------------------------------------------------------------------ */

/**
 * Delete all log rows matching a session (date, workoutId, startTime).
 *
 * Finds the log tab's numeric sheetId, reads all raw rows to locate
 * matching indices, then issues a batchUpdate with deleteDimension
 * requests (processed in reverse order to keep indices stable).
 */
export async function deleteLogSession(
	spreadsheetId: string,
	sessionDate: string,
	sessionWorkoutId: string,
	sessionStartTime: string,
): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	// Get the numeric sheetId for the log tab
	const metaResponse = await gapi.client.sheets.spreadsheets.get({
		spreadsheetId,
	})
	const logSheet = (metaResponse.result.sheets ?? []).find(
		(s) => s.properties.title === LOG_TAB_NAME,
	)
	if (!logSheet) return
	const sheetId = logSheet.properties.sheetId

	// Read all raw rows to find matching indices
	const response = await gapi.client.sheets.spreadsheets.values.get({
		spreadsheetId,
		range: LOG_READ_RANGE,
	})

	const rawRows = response.result.values
	if (!rawRows || rawRows.length === 0) return

	// Find raw row indices matching this session
	const matchingIndices: number[] = []
	for (let i = 0; i < rawRows.length; i++) {
		const raw = rawRows[i]
		const date = (raw[0] ?? '').trim()
		const startTime = (raw[1] ?? '').trim()
		const workoutId = (raw[3] ?? '').trim()
		if (date === sessionDate && startTime === sessionStartTime && workoutId === sessionWorkoutId) {
			matchingIndices.push(i)
		}
	}

	if (matchingIndices.length === 0) return

	// Build delete requests in reverse order (highest index first)
	// so that earlier deletions don't shift later indices.
	// Sheet row = rawIdx + 2 (header is row 1, data starts at row 2, both 1-indexed)
	// deleteDimension uses 0-indexed: startIndex = sheetRow - 1
	const requests = matchingIndices
		.slice()
		.sort((a, b) => b - a)
		.map((rawIdx) => ({
			deleteDimension: {
				range: {
					sheetId,
					dimension: 'ROWS' as const,
					startIndex: rawIdx + 1, // 0-indexed: row 2 in sheet = index 1
					endIndex: rawIdx + 2,
				},
			},
		}))

	await gapi.client.sheets.spreadsheets.batchUpdate({
		spreadsheetId,
		resource: { requests },
	})
}

/* ------------------------------------------------------------------ */
/*  Workout Defs tab – constants                                       */
/* ------------------------------------------------------------------ */

/** A1 range for the workout defs tab (open-ended rows). */
const WORKOUT_DEFS_RANGE = `'${WORKOUT_DEFS_TAB_NAME}'!A:M`

const WORKOUT_DEFS_HEADER: string[] = [
	'workoutId',
	'workoutName',
	'exerciseOrder',
	'exerciseRole',
	'liftId',
	'setType',
	'percentage',
	'weightBasis',
	'minReps',
	'maxReps',
	'amrap',
	'comment',
	'favorite',
]

/* ------------------------------------------------------------------ */
/*  Workout Defs tab – serialization                                   */
/* ------------------------------------------------------------------ */

/**
 * Encode a {@link WeightBasis} discriminated union into a single string
 * suitable for a spreadsheet cell.
 *
 * - `{ kind: 'topSet' }`                      → `"topSet"`
 * - `{ kind: 'backoff' }`                     → `"backoff"`
 * - `{ kind: 'crossReference', liftId: 'x' }` → `"crossReference:x"`
 * - `{ kind: 'fixed', weight: 45 }`           → `"fixed:45"`
 * - `{ kind: 'relative', reference: 'backoff', offset: -20 }` → `"relative:backoff:-20"`
 */
export function encodeWeightBasis(wb: WeightBasis): string {
	switch (wb.kind) {
		case 'topSet':
			return 'topSet'
		case 'backoff':
			return 'backoff'
		case 'barWeight':
			return 'barWeight'
		case 'crossReference':
			return `crossReference:${wb.liftId}`
		case 'fixed':
			return `fixed:${wb.weight}`
		case 'relative':
			return `relative:${wb.reference}:${wb.offset}`
	}
}

/**
 * Decode a weight-basis string back into a {@link WeightBasis}.
 * Returns `null` for unrecognised formats.
 */
export function decodeWeightBasis(raw: string): WeightBasis | null {
	const s = raw.trim()
	if (s === 'topSet') return { kind: 'topSet' }
	if (s === 'backoff') return { kind: 'backoff' }
	if (s === 'barWeight') return { kind: 'barWeight' }
	if (s.startsWith('crossReference:')) {
		const liftId = s.slice('crossReference:'.length).trim()
		return liftId ? { kind: 'crossReference', liftId } : null
	}
	if (s.startsWith('fixed:')) {
		const n = Number(s.slice('fixed:'.length).trim())
		return Number.isFinite(n) && n >= 0 ? { kind: 'fixed', weight: n } : null
	}
	if (s.startsWith('relative:')) {
		const rest = s.slice('relative:'.length)
		const sep = rest.indexOf(':')
		if (sep < 0) return null
		const reference = rest.slice(0, sep).trim()
		const offset = Number(rest.slice(sep + 1).trim())
		if ((reference === 'topSet' || reference === 'backoff') && Number.isFinite(offset)) {
			return { kind: 'relative', reference, offset }
		}
		return null
	}
	return null
}

/** Valid exercise roles for validation. */
const VALID_ROLES = new Set<ExerciseRole>(['primary', 'secondary', 'assistance'])

/**
 * Build the flat spreadsheet rows from a {@link WorkoutDefinition} array.
 * Each set becomes one row.
 */
export function workoutDefsToRows(
	defs: WorkoutDefinition[],
): (string | number)[][] {
	const rows: (string | number)[][] = []
	for (const def of defs) {
		// Skip workouts with no exercises
		if (def.templates.length === 0) continue

		for (let ei = 0; ei < def.templates.length; ei++) {
			const tpl = def.templates[ei]
			const exerciseOrder = ei + 1
			for (const set of tpl.sets) {
				rows.push([
					def.id,
					def.name,
					exerciseOrder,
					tpl.role,
					tpl.liftId,
					set.setType,
					set.percentage,
					encodeWeightBasis(set.weightBasis),
					set.minReps,
					set.maxReps,
					set.amrap ? 'TRUE' : 'FALSE',
					set.comment ?? '',
					def.favorite ? 'TRUE' : 'FALSE',
				])
			}
		}
	}
	return rows
}

/**
 * Parse an exercise role string, defaulting to 'assistance' for unrecognized values.
 */
function parseExerciseRole(raw: string): ExerciseRole {
	const lower = raw.toLowerCase().trim() as ExerciseRole
	return VALID_ROLES.has(lower) ? lower : 'assistance'
}

/* ------------------------------------------------------------------ */
/*  Workout Defs tab – parsing                                         */
/* ------------------------------------------------------------------ */

interface WorkoutDefRow {
	workoutId: string
	workoutName: string
	exerciseOrder: number
	exerciseRole: string
	liftId: string
	favorite: boolean
	set: SetTemplate
}

/**
 * Parse a single spreadsheet row into a {@link WorkoutDefRow}.
 * Returns `null` for invalid or incomplete rows.
 */
export function parseWorkoutDefRow(row: string[]): WorkoutDefRow | null {
	if (!row || row.length < 2) return null

	const workoutId = (row[0] ?? '').trim()
	const workoutName = (row[1] ?? '').trim()
	if (!workoutId || !workoutName) return null

	// Detect favorite from column 13 (index 12) — default to false
	const favorite = (row[12] ?? '').trim().toUpperCase() === 'TRUE'

	// Exercise order must be present
	const rawOrder = (row[2] ?? '').trim()
	if (!rawOrder) return null

	// Full row — validate all fields
	if (row.length < 11) return null

	const exerciseRole = (row[3] ?? '').trim()
	const liftId = (row[4] ?? '').trim()
	const rawSetType = (row[5] ?? '').trim()
	const rawPct = (row[6] ?? '').trim()
	const rawBasis = (row[7] ?? '').trim()
	const rawMin = (row[8] ?? '').trim()
	const rawMax = (row[9] ?? '').trim()
	const rawAmrap = (row[10] ?? '').trim().toUpperCase()
	const comment = (row[11] ?? '').trim()

	if (!exerciseRole || !liftId) return null
	if (!rawSetType || !rawPct || !rawBasis || !rawMin || !rawMax) return null

	const exerciseOrder = Number(rawOrder)
	if (!Number.isFinite(exerciseOrder) || exerciseOrder < 1) return null

	const setType = rawSetType as 'warmup' | 'work' | 'backoff' | 'joker'
	if (setType !== 'warmup' && setType !== 'work' && setType !== 'backoff' && setType !== 'joker') return null

	const percentage = Number(rawPct)
	if (!Number.isFinite(percentage) || percentage < 0) return null

	const weightBasis = decodeWeightBasis(rawBasis)
	if (!weightBasis) return null

	const minReps = Number(rawMin)
	const maxReps = Number(rawMax)
	if (!Number.isFinite(minReps) || minReps < 0) return null
	if (!Number.isFinite(maxReps) || maxReps < minReps) return null

	const amrap = rawAmrap === 'TRUE'

	const set: SetTemplate = {
		setType,
		percentage,
		weightBasis,
		minReps,
		maxReps,
		amrap,
		...(comment ? { comment } : {}),
	}

	return { workoutId, workoutName, exerciseOrder, exerciseRole, liftId, favorite, set }
}

/**
 * Group parsed rows into {@link WorkoutDefinition} array.
 * Rows are grouped by `workoutId`, exercises by `exerciseOrder`.
 * Exercise display names are derived from exerciseRole + liftId
 * (caller should map lift names afterward using configs if desired).
 */
export function rowsToWorkoutDefs(
	rows: WorkoutDefRow[],
	liftNames?: ReadonlyMap<string, string>,
): WorkoutDefinition[] {
	// Group by workoutId, preserving row order for stable workout ordering
	const workoutOrder: string[] = []
	const workoutMap = new Map<string, { name: string; favorite: boolean; rows: WorkoutDefRow[] }>()
	for (const r of rows) {
		if (!workoutMap.has(r.workoutId)) {
			workoutOrder.push(r.workoutId)
			workoutMap.set(r.workoutId, { name: r.workoutName, favorite: r.favorite, rows: [] })
		}
		workoutMap.get(r.workoutId)!.rows.push(r)
	}

	const defs: WorkoutDefinition[] = []
	for (const wid of workoutOrder) {
		const entry = workoutMap.get(wid)!

		// Group by exerciseOrder within this workout
		const exerciseOrderSet: number[] = []
		const exerciseMap = new Map<number, WorkoutDefRow[]>()
		for (const r of entry.rows) {
			if (!exerciseMap.has(r.exerciseOrder)) {
				exerciseOrderSet.push(r.exerciseOrder)
				exerciseMap.set(r.exerciseOrder, [])
			}
			exerciseMap.get(r.exerciseOrder)!.push(r)
		}

		// Sort exercises by exerciseOrder
		exerciseOrderSet.sort((a, b) => a - b)

		const templates: ExerciseTemplate[] = []
		for (const eo of exerciseOrderSet) {
			const exRows = exerciseMap.get(eo)!
			const first = exRows[0]
			// Use lift name as the display name (role is a separate field)
			const name = liftNames?.get(first.liftId) ?? first.liftId
			const role = parseExerciseRole(first.exerciseRole)
			templates.push({
				liftId: first.liftId,
				name,
				role,
				sets: exRows.map((r) => r.set),
			})
		}

		defs.push({ id: wid, name: entry.name, favorite: entry.favorite, templates })
	}

	return defs
}

/* ------------------------------------------------------------------ */
/*  Workout Defs tab – read/write                                      */
/* ------------------------------------------------------------------ */

/**
 * Check if the "Workout Defs" tab exists in the spreadsheet.
 */
export async function verifyWorkoutDefsTab(
	spreadsheetId: string,
): Promise<boolean> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const response = await gapi.client.sheets.spreadsheets.get({
		spreadsheetId,
	})
	const sheets = response.result.sheets ?? []
	return sheets.some(
		(s) => s.properties.title === WORKOUT_DEFS_TAB_NAME,
	)
}

/**
 * Create the "Workout Defs" tab inside the given spreadsheet.
 */
export async function createWorkoutDefsTab(
	spreadsheetId: string,
): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	await gapi.client.sheets.spreadsheets.batchUpdate({
		spreadsheetId,
		resource: {
			requests: [{ addSheet: { properties: { title: WORKOUT_DEFS_TAB_NAME } } }],
		},
	})
}

/**
 * Read the "Workout Defs" tab and parse rows into WorkoutDefinition[].
 * Returns `null` if the tab is empty or contains no valid rows.
 *
 * @param liftNames - optional map of liftId → display name for generating
 *   exercise display names. If not provided, the liftId is used as-is.
 */
export async function readWorkoutDefs(
	spreadsheetId: string,
	liftNames?: ReadonlyMap<string, string>,
): Promise<WorkoutDefinition[] | null> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const response = await gapi.client.sheets.spreadsheets.values.get({
		spreadsheetId,
		range: WORKOUT_DEFS_RANGE,
	})

	const allRows = response.result.values
	if (!allRows || allRows.length <= 1) {
		return null
	}

	// Skip header, parse data rows, filter out nulls
	const parsed = allRows.slice(1)
		.map(parseWorkoutDefRow)
		.filter((r): r is WorkoutDefRow => r !== null)

	if (parsed.length === 0) return null

	const defs = rowsToWorkoutDefs(parsed, liftNames)
	return defs.length > 0 ? defs : null
}

/**
 * Write the header + default workout definition rows to the "Workout Defs" tab.
 * Used on first connection when the tab is empty.
 */
export async function writeDefaultWorkoutDefs(
	spreadsheetId: string,
	defs: WorkoutDefinition[],
): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const dataRows = workoutDefsToRows(defs)
	const allRows: (string | number)[][] = [
		WORKOUT_DEFS_HEADER,
		...dataRows,
	]

	await gapi.client.sheets.spreadsheets.values.update({
		spreadsheetId,
		range: WORKOUT_DEFS_RANGE,
		valueInputOption: 'RAW',
		resource: { values: allRows },
	})
}

/**
 * Write the full set of workout definitions to the "Workout Defs" tab.
 * Clears existing data first, then writes header + all rows.
 */
export async function writeWorkoutDefs(
	spreadsheetId: string,
	defs: WorkoutDefinition[],
): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const dataRows = workoutDefsToRows(defs)
	const allRows: (string | number)[][] = [
		WORKOUT_DEFS_HEADER,
		...dataRows,
	]

	// Clear existing data then write fresh (handles row count changes)
	await gapi.client.sheets.spreadsheets.values.clear({
		spreadsheetId,
		range: WORKOUT_DEFS_RANGE,
	})

	await gapi.client.sheets.spreadsheets.values.update({
		spreadsheetId,
		range: WORKOUT_DEFS_RANGE,
		valueInputOption: 'RAW',
		resource: { values: allRows },
	})
}

/* ------------------------------------------------------------------ */
/*  Log zone – read & parse                                            */
/* ------------------------------------------------------------------ */

/** A parsed log row representing one completed set. */
export interface ParsedLogRow {
	date: string
	startTime: string
	endTime: string
	workoutId: string
	exerciseName: string
	liftId: string
	setNumber: number
	setType: string
	plannedWeight: number
	plannedReps: number
	actualWeight: number
	actualReps: number
	completed: boolean
}

/**
 * Parse a single raw log row (string array) into a {@link ParsedLogRow}.
 * Returns `null` for incomplete or invalid rows.
 */
export function parseLogRow(row: string[]): ParsedLogRow | null {
	if (!row || row.length < 13) return null

	const date = (row[0] ?? '').trim()
	const startTime = (row[1] ?? '').trim()
	const endTime = (row[2] ?? '').trim()
	const workoutId = (row[3] ?? '').trim()
	const exerciseName = (row[4] ?? '').trim()
	const liftId = (row[5] ?? '').trim()
	const rawSetNumber = (row[6] ?? '').trim()
	const setType = (row[7] ?? '').trim()
	const rawPlannedWeight = (row[8] ?? '').trim()
	const rawPlannedReps = (row[9] ?? '').trim()
	const rawActualWeight = (row[10] ?? '').trim()
	const rawActualReps = (row[11] ?? '').trim()
	const rawCompleted = (row[12] ?? '').trim().toUpperCase()

	if (!date || !startTime || !workoutId || !exerciseName) return null

	const setNumber = Number(rawSetNumber)
	const plannedWeight = Number(rawPlannedWeight)
	const plannedReps = Number(rawPlannedReps)
	const actualWeight = Number(rawActualWeight)
	const actualReps = Number(rawActualReps)

	if (!Number.isFinite(setNumber) || setNumber < 1) return null
	if (!Number.isFinite(actualWeight) || !Number.isFinite(actualReps)) return null

	return {
		date,
		startTime,
		endTime,
		workoutId,
		exerciseName,
		liftId,
		setNumber,
		setType,
		plannedWeight: Number.isFinite(plannedWeight) ? plannedWeight : 0,
		plannedReps: Number.isFinite(plannedReps) ? plannedReps : 0,
		actualWeight,
		actualReps,
		completed: rawCompleted === 'TRUE',
	}
}

/**
 * Find the previous workout's set data for each exercise/set position.
 *
 * Scans the parsed log rows to find the most recent session matching
 * `workoutId`, then returns a 2D array indexed by exercise position and
 * set position within that exercise. Returns `null` when no previous
 * session exists.
 *
 * "Most recent session" is identified by the latest `startTime` value
 * among rows with the target `workoutId`.
 */
export function findPreviousWorkoutSets(
	logRows: ParsedLogRow[],
	workoutId: string,
): PreviousSetData[][] | null {
	// Filter to rows matching this workout ID
	const matching = logRows.filter((r) => r.workoutId === workoutId)
	if (matching.length === 0) return null

	// Find the most recent session by startTime (lexicographic sort on ISO strings)
	let latestStart = ''
	for (const row of matching) {
		if (row.startTime > latestStart) {
			latestStart = row.startTime
		}
	}

	const sessionRows = matching.filter((r) => r.startTime === latestStart)
	if (sessionRows.length === 0) return null

	// Group by exercise name, preserving first-seen order
	const exerciseOrder: string[] = []
	const exerciseMap = new Map<string, ParsedLogRow[]>()
	for (const row of sessionRows) {
		if (!exerciseMap.has(row.exerciseName)) {
			exerciseOrder.push(row.exerciseName)
			exerciseMap.set(row.exerciseName, [])
		}
		exerciseMap.get(row.exerciseName)!.push(row)
	}

	// Build 2D array: exercises × sets (sorted by setNumber within each exercise)
	const result: PreviousSetData[][] = []
	for (const name of exerciseOrder) {
		const rows = exerciseMap.get(name)!
		rows.sort((a, b) => a.setNumber - b.setNumber)
		result.push(
			rows.map((r) => ({ weight: r.actualWeight, reps: r.actualReps })),
		)
	}

	return result
}

/**
 * Read the log tab (row 2+) and return parsed log rows.
 * Returns an empty array if there are no log entries yet.
 */
export async function readLogZone(
	spreadsheetId: string,
): Promise<ParsedLogRow[]> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const response = await gapi.client.sheets.spreadsheets.values.get({
		spreadsheetId,
		range: LOG_READ_RANGE,
	})

	const rawRows = response.result.values
	if (!rawRows || rawRows.length === 0) return []

	return rawRows
		.map(parseLogRow)
		.filter((r): r is ParsedLogRow => r !== null)
}

/* ------------------------------------------------------------------ */
/*  Schedule tab – constants                                           */
/* ------------------------------------------------------------------ */

/** A1 range for the schedule (flags) header (row 1). */
const SCHEDULE_HEADER_RANGE = `'${SCHEDULE_TAB_NAME}'!A1:G1`

/** A1 range for reading all schedule (flags) data (row 2 onward, generous upper bound). */
const SCHEDULE_READ_RANGE = `'${SCHEDULE_TAB_NAME}'!A2:G10000`

/** A1 range covering the full schedule (flags) tab for clearing. */
const SCHEDULE_FULL_RANGE = `'${SCHEDULE_TAB_NAME}'!A1:G10000`

const SCHEDULE_HEADER: string[] = ['date', 'home', 'elsewhere', 'travel', 'visitors', 'alcohol', 'blocked']

/* ------------------------------------------------------------------ */
/*  Workout Schedule tab – constants                                    */
/* ------------------------------------------------------------------ */

/** A1 range for the workout schedule header (row 1). */
const WORKOUT_SCHEDULE_HEADER_RANGE = `'${WORKOUT_SCHEDULE_TAB_NAME}'!A1:D1`

/** A1 range for reading all workout schedule data (row 2 onward). */
const WORKOUT_SCHEDULE_READ_RANGE = `'${WORKOUT_SCHEDULE_TAB_NAME}'!A2:D10000`

/** A1 range covering the full workout schedule tab for clearing. */
const WORKOUT_SCHEDULE_FULL_RANGE = `'${WORKOUT_SCHEDULE_TAB_NAME}'!A1:D10000`

const WORKOUT_SCHEDULE_HEADER: string[] = ['date', 'workoutId', 'calendarEventId', 'strongerId']

/* ------------------------------------------------------------------ */
/*  Schedule (flags) tab – serialization                                */
/* ------------------------------------------------------------------ */

/**
 * Parse a single raw schedule (flags) row into a {@link DayFlagEntry}.
 * Returns `null` for incomplete or invalid rows.
 */
export function parseFlagRow(row: string[]): DayFlagEntry | null {
	if (!row || row.length < 1) return null

	const date = (row[0] ?? '').trim()
	if (!date) return null
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null

	const flags: DayFlags = {
		home: (row[1] ?? '').trim().toUpperCase() === 'TRUE',
		elsewhere: (row[2] ?? '').trim().toUpperCase() === 'TRUE',
		travel: (row[3] ?? '').trim().toUpperCase() === 'TRUE',
		visitors: (row[4] ?? '').trim().toUpperCase() === 'TRUE',
		alcohol: (row[5] ?? '').trim().toUpperCase() === 'TRUE',
		blocked: (row[6] ?? '').trim().toUpperCase() === 'TRUE',
	}

	const hasFlags = flags.home || flags.elsewhere || flags.travel || flags.visitors || flags.alcohol || flags.blocked
	if (!hasFlags) return null

	return { date, flags }
}

/** Convert a {@link DayFlagEntry} to a spreadsheet row. */
export function flagEntryToRow(entry: DayFlagEntry): string[] {
	const f = entry.flags
	return [
		entry.date,
		f.home ? 'TRUE' : '',
		f.elsewhere ? 'TRUE' : '',
		f.travel ? 'TRUE' : '',
		f.visitors ? 'TRUE' : '',
		f.alcohol ? 'TRUE' : '',
		f.blocked ? 'TRUE' : '',
	]
}

/* ------------------------------------------------------------------ */
/*  Workout Schedule tab – serialization                                */
/* ------------------------------------------------------------------ */

/**
 * Parse a single raw workout schedule row into a {@link WorkoutScheduleEntry}.
 * Returns `null` for incomplete or invalid rows.
 */
export function parseWorkoutScheduleRow(row: string[]): WorkoutScheduleEntry | null {
	if (!row || row.length < 1) return null

	const date = (row[0] ?? '').trim()
	const workoutId = (row[1] ?? '').trim()

	if (!date) return null
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null

	const calendarEventId = (row[2] ?? '').trim() || undefined
	const strongerId = (row[3] ?? '').trim() || undefined

	// Must have either a workoutId, a calendarEventId, or a strongerId
	if (!workoutId && !calendarEventId && !strongerId) return null

	return {
		date,
		workoutId,
		...(calendarEventId ? { calendarEventId } : {}),
		...(strongerId ? { strongerId } : {}),
	}
}

/** Convert a {@link WorkoutScheduleEntry} to a spreadsheet row. */
export function workoutScheduleEntryToRow(entry: WorkoutScheduleEntry): string[] {
	return [
		entry.date,
		entry.workoutId,
		entry.calendarEventId ?? '',
		entry.strongerId ?? '',
	]
}

/* ------------------------------------------------------------------ */
/*  Legacy schedule serialization (kept for backward compat/migration)  */
/* ------------------------------------------------------------------ */

/**
 * @deprecated Use {@link parseFlagRow} and {@link parseWorkoutScheduleRow} instead.
 * Parse a single raw schedule row (string array) into a {@link ScheduleEntry}.
 * Returns `null` for incomplete or invalid rows.
 * A row with the FLAG_SENTINEL workoutId is a dedicated flag row.
 */
export function parseScheduleRow(row: string[]): ScheduleEntry | null {
	if (!row || row.length < 1) return null

	const date = (row[0] ?? '').trim()
	const workoutId = (row[1] ?? '').trim()

	if (!date) return null
	// Basic date format validation: YYYY-MM-DD
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null

	// Parse flag columns (columns 2-7, TRUE/FALSE strings)
	const flags: DayFlags = {
		home: (row[2] ?? '').trim().toUpperCase() === 'TRUE',
		elsewhere: (row[3] ?? '').trim().toUpperCase() === 'TRUE',
		travel: (row[4] ?? '').trim().toUpperCase() === 'TRUE',
		visitors: (row[5] ?? '').trim().toUpperCase() === 'TRUE',
		alcohol: (row[6] ?? '').trim().toUpperCase() === 'TRUE',
		blocked: (row[7] ?? '').trim().toUpperCase() === 'TRUE',
	}

	const hasFlags = flags.home || flags.elsewhere || flags.travel || flags.visitors || flags.alcohol || flags.blocked

	const calendarEventId = (row[8] ?? '').trim() || undefined
	const strongerId = (row[9] ?? '').trim() || undefined

	// Must have either a workoutId, at least one flag, a calendarEventId, or a strongerId
	if (!workoutId && !hasFlags && !calendarEventId && !strongerId) return null

	return {
		date,
		workoutId,
		...(hasFlags ? { flags } : {}),
		...(calendarEventId ? { calendarEventId } : {}),
		...(strongerId ? { strongerId } : {}),
	}
}

/** @deprecated Use {@link flagEntryToRow} and {@link workoutScheduleEntryToRow} instead. */
export function scheduleEntryToRow(entry: ScheduleEntry): string[] {
	const f = entry.flags
	return [
		entry.date,
		entry.workoutId,
		f?.home ? 'TRUE' : '',
		f?.elsewhere ? 'TRUE' : '',
		f?.travel ? 'TRUE' : '',
		f?.visitors ? 'TRUE' : '',
		f?.alcohol ? 'TRUE' : '',
		f?.blocked ? 'TRUE' : '',
		entry.calendarEventId ?? '',
		entry.strongerId ?? '',
	]
}

/* ------------------------------------------------------------------ */
/*  Schedule (flags) tab – read/write                                   */
/* ------------------------------------------------------------------ */

/**
 * Check if the schedule (flags) tab exists in the spreadsheet.
 */
export async function verifyScheduleTab(
	spreadsheetId: string,
): Promise<boolean> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const response = await gapi.client.sheets.spreadsheets.get({
		spreadsheetId,
	})
	const sheets = response.result.sheets ?? []
	return sheets.some(
		(s) => s.properties.title === SCHEDULE_TAB_NAME,
	)
}

/**
 * Create the schedule (flags) tab and write the header row.
 */
export async function createScheduleTab(
	spreadsheetId: string,
): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	await gapi.client.sheets.spreadsheets.batchUpdate({
		spreadsheetId,
		resource: {
			requests: [{ addSheet: { properties: { title: SCHEDULE_TAB_NAME } } }],
		},
	})

	await gapi.client.sheets.spreadsheets.values.update({
		spreadsheetId,
		range: SCHEDULE_HEADER_RANGE,
		valueInputOption: 'RAW',
		resource: { values: [SCHEDULE_HEADER] },
	})
}

/**
 * Read the schedule (flags) tab and return parsed day flag entries.
 * Returns an empty array if there are no entries yet.
 */
export async function readFlags(
	spreadsheetId: string,
): Promise<DayFlagEntry[]> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const response = await gapi.client.sheets.spreadsheets.values.get({
		spreadsheetId,
		range: SCHEDULE_READ_RANGE,
	})

	const rawRows = response.result.values
	if (!rawRows || rawRows.length === 0) return []

	return rawRows
		.map(parseFlagRow)
		.filter((r): r is DayFlagEntry => r !== null)
}

/**
 * Write the full flags to the sheet (header + all entries).
 * This overwrites all existing flag data.
 */
export async function writeFlags(
	spreadsheetId: string,
	entries: DayFlagEntry[],
): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const rows: string[][] = [
		SCHEDULE_HEADER,
		...entries.map(flagEntryToRow),
	]

	await gapi.client.sheets.spreadsheets.values.update({
		spreadsheetId,
		range: SCHEDULE_FULL_RANGE,
		valueInputOption: 'RAW',
		resource: { values: rows },
	})

	const tailStartRow = rows.length + 1
	const SCHEDULE_MAX_ROW = 10000
	if (tailStartRow <= SCHEDULE_MAX_ROW) {
		const tailRange = `'${SCHEDULE_TAB_NAME}'!A${tailStartRow}:G${SCHEDULE_MAX_ROW}`
		await gapi.client.sheets.spreadsheets.values.clear({
			spreadsheetId,
			range: tailRange,
		})
	}
}

/* ------------------------------------------------------------------ */
/*  Workout Schedule tab – read/write                                   */
/* ------------------------------------------------------------------ */

/**
 * Check if the workout schedule tab exists in the spreadsheet.
 */
export async function verifyWorkoutScheduleTab(
	spreadsheetId: string,
): Promise<boolean> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const response = await gapi.client.sheets.spreadsheets.get({
		spreadsheetId,
	})
	const sheets = response.result.sheets ?? []
	return sheets.some(
		(s) => s.properties.title === WORKOUT_SCHEDULE_TAB_NAME,
	)
}

/**
 * Create the workout schedule tab and write the header row.
 */
export async function createWorkoutScheduleTab(
	spreadsheetId: string,
): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	await gapi.client.sheets.spreadsheets.batchUpdate({
		spreadsheetId,
		resource: {
			requests: [{ addSheet: { properties: { title: WORKOUT_SCHEDULE_TAB_NAME } } }],
		},
	})

	await gapi.client.sheets.spreadsheets.values.update({
		spreadsheetId,
		range: WORKOUT_SCHEDULE_HEADER_RANGE,
		valueInputOption: 'RAW',
		resource: { values: [WORKOUT_SCHEDULE_HEADER] },
	})
}

/**
 * Read the workout schedule tab and return parsed entries.
 * Returns an empty array if there are no entries yet.
 */
export async function readWorkoutSchedule(
	spreadsheetId: string,
): Promise<WorkoutScheduleEntry[]> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const response = await gapi.client.sheets.spreadsheets.values.get({
		spreadsheetId,
		range: WORKOUT_SCHEDULE_READ_RANGE,
	})

	const rawRows = response.result.values
	if (!rawRows || rawRows.length === 0) return []

	return rawRows
		.map(parseWorkoutScheduleRow)
		.filter((r): r is WorkoutScheduleEntry => r !== null)
}

/**
 * Write the full workout schedule to the sheet (header + all entries).
 * This overwrites all existing workout schedule data.
 */
export async function writeWorkoutSchedule(
	spreadsheetId: string,
	entries: WorkoutScheduleEntry[],
): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const rows: string[][] = [
		WORKOUT_SCHEDULE_HEADER,
		...entries.map(workoutScheduleEntryToRow),
	]

	await gapi.client.sheets.spreadsheets.values.update({
		spreadsheetId,
		range: WORKOUT_SCHEDULE_FULL_RANGE,
		valueInputOption: 'RAW',
		resource: { values: rows },
	})

	const tailStartRow = rows.length + 1
	const MAX_ROW = 10000
	if (tailStartRow <= MAX_ROW) {
		const tailRange = `'${WORKOUT_SCHEDULE_TAB_NAME}'!A${tailStartRow}:D${MAX_ROW}`
		await gapi.client.sheets.spreadsheets.values.clear({
			spreadsheetId,
			range: tailRange,
		})
	}
}

/**
 * @deprecated Use {@link readFlags} and {@link readWorkoutSchedule} instead.
 * Read the legacy combined schedule tab and return parsed schedule entries.
 */
export async function readSchedule(
	spreadsheetId: string,
): Promise<ScheduleEntry[]> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const legacyRange = `'${SCHEDULE_TAB_NAME}'!A2:J10000`
	const response = await gapi.client.sheets.spreadsheets.values.get({
		spreadsheetId,
		range: legacyRange,
	})

	const rawRows = response.result.values
	if (!rawRows || rawRows.length === 0) return []

	return rawRows
		.map(parseScheduleRow)
		.filter((r): r is ScheduleEntry => r !== null)
}

/**
 * @deprecated Use {@link writeFlags} and {@link writeWorkoutSchedule} instead.
 * Write the full legacy combined schedule to the sheet.
 */
export async function writeSchedule(
	spreadsheetId: string,
	entries: ScheduleEntry[],
): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const legacyHeader: string[] = ['date', 'workoutId', 'home', 'elsewhere', 'travel', 'visitors', 'alcohol', 'blocked', 'calendarEventId', 'strongerId']
	const legacyFullRange = `'${SCHEDULE_TAB_NAME}'!A1:J10000`

	const rows: string[][] = [
		legacyHeader,
		...entries.map(scheduleEntryToRow),
	]

	await gapi.client.sheets.spreadsheets.values.update({
		spreadsheetId,
		range: legacyFullRange,
		valueInputOption: 'RAW',
		resource: { values: rows },
	})

	const tailStartRow = rows.length + 1
	const SCHEDULE_MAX_ROW = 10000
	if (tailStartRow <= SCHEDULE_MAX_ROW) {
		const tailRange = `'${SCHEDULE_TAB_NAME}'!A${tailStartRow}:J${SCHEDULE_MAX_ROW}`
		await gapi.client.sheets.spreadsheets.values.clear({
			spreadsheetId,
			range: tailRange,
		})
	}
}

/* ------------------------------------------------------------------ */
/*  Cardio tab – constants                                             */
/* ------------------------------------------------------------------ */

/** A1 range for the cardio tab (open-ended rows, 2 columns). */
const CARDIO_RANGE = `'${CARDIO_TAB_NAME}'!A:B`

const CARDIO_HEADER: string[] = ['id', 'name']

/* ------------------------------------------------------------------ */
/*  Cardio tab – serialization                                         */
/* ------------------------------------------------------------------ */

/** Convert a {@link CardioActivity} to a spreadsheet row. */
export function cardioActivityToRow(activity: CardioActivity): string[] {
	return [activity.id, activity.name]
}

/**
 * Parse a single raw cardio row (string array) into a {@link CardioActivity}.
 * Returns `null` for incomplete rows.
 */
export function parseCardioRow(row: string[]): CardioActivity | null {
	if (!row || row.length < 2) return null
	const id = (row[0] ?? '').trim()
	const name = (row[1] ?? '').trim()
	if (!id || !name) return null
	return { id, name }
}

/* ------------------------------------------------------------------ */
/*  Cardio tab – read/write                                            */
/* ------------------------------------------------------------------ */

/**
 * Check if the cardio tab exists in the spreadsheet.
 */
export async function verifyCardioTab(
	spreadsheetId: string,
): Promise<boolean> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const response = await gapi.client.sheets.spreadsheets.get({
		spreadsheetId,
	})
	const sheets = response.result.sheets ?? []
	return sheets.some(
		(s) => s.properties.title === CARDIO_TAB_NAME,
	)
}

/**
 * Create the cardio tab inside the given spreadsheet.
 */
export async function createCardioTab(
	spreadsheetId: string,
): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	await gapi.client.sheets.spreadsheets.batchUpdate({
		spreadsheetId,
		resource: {
			requests: [{ addSheet: { properties: { title: CARDIO_TAB_NAME } } }],
		},
	})
}

/**
 * Read the cardio tab and return parsed cardio activities.
 * Returns `null` if the tab is empty or contains no valid rows.
 */
export async function readCardioActivities(
	spreadsheetId: string,
): Promise<CardioActivity[] | null> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const response = await gapi.client.sheets.spreadsheets.values.get({
		spreadsheetId,
		range: CARDIO_RANGE,
	})

	const allRows = response.result.values
	if (!allRows || allRows.length <= 1) return null

	const parsed = allRows.slice(1)
		.map(parseCardioRow)
		.filter((r): r is CardioActivity => r !== null)

	return parsed.length > 0 ? parsed : null
}

/**
 * Write the header + default cardio activities to the cardio tab.
 * Used on first connection when the tab is empty.
 */
export async function writeDefaultCardioActivities(
	spreadsheetId: string,
	activities: CardioActivity[],
): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const allRows: string[][] = [
		CARDIO_HEADER,
		...activities.map(cardioActivityToRow),
	]

	await gapi.client.sheets.spreadsheets.values.update({
		spreadsheetId,
		range: CARDIO_RANGE,
		valueInputOption: 'RAW',
		resource: { values: allRows },
	})
}

/**
 * Write the full set of cardio activities to the cardio tab.
 * Clears existing data first, then writes header + all rows.
 */
export async function writeCardioActivities(
	spreadsheetId: string,
	activities: CardioActivity[],
): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const allRows: string[][] = [
		CARDIO_HEADER,
		...activities.map(cardioActivityToRow),
	]

	await gapi.client.sheets.spreadsheets.values.clear({
		spreadsheetId,
		range: CARDIO_RANGE,
	})

	await gapi.client.sheets.spreadsheets.values.update({
		spreadsheetId,
		range: CARDIO_RANGE,
		valueInputOption: 'RAW',
		resource: { values: allRows },
	})
}

/* ------------------------------------------------------------------ */
/*  Meal tabs                                                           */
/* ------------------------------------------------------------------ */

const MEAL_ITEMS_RANGE = `'${MEAL_ITEMS_TAB_NAME}'!A:H`
const MEAL_LOG_HEADER_RANGE = `'${MEAL_LOG_TAB_NAME}'!A1:J1`
const MEAL_LOG_APPEND_RANGE = `'${MEAL_LOG_TAB_NAME}'!A2:J2`
const MEAL_LOG_READ_RANGE = `'${MEAL_LOG_TAB_NAME}'!A2:J`
const MEAL_ITEMS_HEADER = ['id', 'name', 'category', 'calories', 'fat', 'carbs', 'fiber', 'protein']
const MEAL_LOG_HEADER = ['date', ...MEAL_ITEMS_HEADER, 'quantity']
const MEAL_CATEGORIES: MealCategory[] = ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Drinks']

export function mealItemToRow(item: MealItem): (string | number)[] {
	return [item.id, item.name, item.category, item.calories, item.fat, item.carbs, item.fiber, item.protein]
}

function parseMealValues(row: string[], offset: number): Omit<MealItem, 'id'> | null {
	const name = (row[offset] ?? '').trim()
	const category = (row[offset + 1] ?? '').trim() as MealCategory
	const macroValues = row.slice(offset + 2, offset + 7).map(Number)
	if (!name || !MEAL_CATEGORIES.includes(category) || macroValues.length !== 5) return null
	if (macroValues.some((value) => !Number.isFinite(value) || value < 0)) return null
	const [calories, fat, carbs, fiber, protein] = macroValues
	return { name, category, calories, fat, carbs, fiber, protein }
}

/** Parse a serving quantity, defaulting to 1 for missing or invalid values. */
function parseQuantity(raw: string | undefined): number {
	const value = Number((raw ?? '').trim())
	return Number.isFinite(value) && value > 0 ? value : 1
}

export function parseMealItemRow(row: string[]): MealItem | null {
	const id = (row[0] ?? '').trim()
	const values = parseMealValues(row, 1)
	return id && values ? { id, ...values } : null
}

export function mealLogEntryToRow(entry: MealLogEntry): (string | number)[] {
	return [entry.date, ...mealItemToRow(entry), entry.quantity]
}

export function parseMealLogRow(row: string[]): MealLogEntry | null {
	const date = (row[0] ?? '').trim()
	const id = (row[1] ?? '').trim()
	const values = parseMealValues(row, 2)
	if (!date || !id || !values) return null
	return { date, id, ...values, quantity: parseQuantity(row[9]) }
}

async function verifyTab(spreadsheetId: string, tabName: string): Promise<boolean> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')
	const response = await gapi.client.sheets.spreadsheets.get({ spreadsheetId })
	return (response.result.sheets ?? []).some((sheet) => sheet.properties.title === tabName)
}

async function createTab(spreadsheetId: string, tabName: string, header: string[], headerRange: string): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')
	await gapi.client.sheets.spreadsheets.batchUpdate({
		spreadsheetId,
		resource: { requests: [{ addSheet: { properties: { title: tabName } } }] },
	})
	await gapi.client.sheets.spreadsheets.values.update({
		spreadsheetId, range: headerRange, valueInputOption: 'RAW', resource: { values: [header] },
	})
}

export function verifyMealItemsTab(spreadsheetId: string): Promise<boolean> {
	return verifyTab(spreadsheetId, MEAL_ITEMS_TAB_NAME)
}

export function createMealItemsTab(spreadsheetId: string): Promise<void> {
	return createTab(spreadsheetId, MEAL_ITEMS_TAB_NAME, MEAL_ITEMS_HEADER, `'${MEAL_ITEMS_TAB_NAME}'!A1:H1`)
}

export function verifyMealLogTab(spreadsheetId: string): Promise<boolean> {
	return verifyTab(spreadsheetId, MEAL_LOG_TAB_NAME)
}

export function createMealLogTab(spreadsheetId: string): Promise<void> {
	return createTab(spreadsheetId, MEAL_LOG_TAB_NAME, MEAL_LOG_HEADER, MEAL_LOG_HEADER_RANGE)
}

export async function readMealItems(spreadsheetId: string): Promise<MealItem[]> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')
	const response = await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId, range: MEAL_ITEMS_RANGE })
	return (response.result.values ?? []).slice(1).map(parseMealItemRow).filter((item): item is MealItem => item !== null)
}

export async function writeMealItems(spreadsheetId: string, items: MealItem[]): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')
	await gapi.client.sheets.spreadsheets.values.clear({ spreadsheetId, range: MEAL_ITEMS_RANGE })
	await gapi.client.sheets.spreadsheets.values.update({
		spreadsheetId, range: MEAL_ITEMS_RANGE, valueInputOption: 'RAW',
		resource: { values: [MEAL_ITEMS_HEADER, ...items.map(mealItemToRow)] },
	})
}

export async function readMealLog(spreadsheetId: string): Promise<MealLogEntry[]> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')
	const response = await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId, range: MEAL_LOG_READ_RANGE })
	return (response.result.values ?? []).map(parseMealLogRow).filter((entry): entry is MealLogEntry => entry !== null)
}

export async function appendMealLogEntry(spreadsheetId: string, entry: MealLogEntry): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')
	await gapi.client.sheets.spreadsheets.values.append({
		spreadsheetId, range: MEAL_LOG_APPEND_RANGE, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
		resource: { values: [mealLogEntryToRow(entry)] },
	})
}

/**
 * Delete a single logged meal entry by its id. Finds the meal log tab's
 * numeric sheetId, reads all raw rows to locate the matching row(s), then
 * issues a batchUpdate with deleteDimension requests (processed in reverse
 * order to keep indices stable).
 */
export async function deleteMealLogEntry(spreadsheetId: string, id: string): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')
	const metaResponse = await gapi.client.sheets.spreadsheets.get({ spreadsheetId })
	const logSheet = (metaResponse.result.sheets ?? []).find((s) => s.properties.title === MEAL_LOG_TAB_NAME)
	if (!logSheet) return
	const sheetId = logSheet.properties.sheetId
	const response = await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId, range: MEAL_LOG_READ_RANGE })
	const rawRows = response.result.values
	if (!rawRows || rawRows.length === 0) return
	const requests = rawRows
		.map((raw, index) => ({ raw, index }))
		.filter(({ raw }) => (raw[1] ?? '').trim() === id)
		.map(({ index }) => index)
		.sort((a, b) => b - a)
		.map((rawIdx) => ({
			// Sheet row = rawIdx + 2 (header is row 1); deleteDimension is 0-indexed.
			deleteDimension: { range: { sheetId, dimension: 'ROWS' as const, startIndex: rawIdx + 1, endIndex: rawIdx + 2 } },
		}))
	if (requests.length === 0) return
	await gapi.client.sheets.spreadsheets.batchUpdate({ spreadsheetId, resource: { requests } })
}

/* ------------------------------------------------------------------ */
/*  Strava tab – constants                                             */
/* ------------------------------------------------------------------ */

/** A1 range for the Strava tab (open-ended rows, 10 columns). */
export const STRAVA_SYNC_RANGE = `'${STRAVA_TAB_NAME}'!A:J`

/** A1 range for the Strava tab header (row 1). */
const STRAVA_HEADER_RANGE = `'${STRAVA_TAB_NAME}'!A1:J1`

/** A1 range for reading Strava data (row 2 onward, open-ended). */
const STRAVA_READ_RANGE = `'${STRAVA_TAB_NAME}'!A2:J`

export const STRAVA_HEADER: string[] = [
	'date',
	'stravaId',
	'activityType',
	'name',
	'duration',
	'distance',
	'elevationGain',
	'calories',
	'avgHR',
	'maxHR',
]

/* ------------------------------------------------------------------ */
/*  Strava tab – serialization                                         */
/* ------------------------------------------------------------------ */

/** Convert a {@link StravaActivity} to a spreadsheet row. */
export function stravaActivityToRow(activity: StravaActivity): string[] {
	return [
		activity.date,
		activity.stravaId,
		activity.activityType,
		activity.name,
		String(activity.duration),
		String(activity.distance),
		String(activity.elevationGain),
		String(activity.calories),
		String(activity.avgHR),
		String(activity.maxHR),
	]
}

/**
 * Parse a single raw Strava row (string array) into a {@link StravaActivity}.
 * Returns `null` for incomplete or invalid rows.
 */
export function parseStravaRow(row: string[]): StravaActivity | null {
	if (!row || row.length < 10) return null

	const date = (row[0] ?? '').trim()
	const stravaId = (row[1] ?? '').trim()
	const activityType = (row[2] ?? '').trim()
	const name = (row[3] ?? '').trim()
	const rawDuration = (row[4] ?? '').trim()
	const rawDistance = (row[5] ?? '').trim()
	const rawElevationGain = (row[6] ?? '').trim()
	const rawCalories = (row[7] ?? '').trim()
	const rawAvgHR = (row[8] ?? '').trim()
	const rawMaxHR = (row[9] ?? '').trim()

	if (!date || !stravaId || !activityType) return null
	// Basic date format validation: YYYY-MM-DD
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null

	const duration = Number(rawDuration)
	const distance = Number(rawDistance)
	const elevationGain = Number(rawElevationGain)
	const calories = Number(rawCalories)
	const avgHR = Number(rawAvgHR)
	const maxHR = Number(rawMaxHR)

	if (!Number.isFinite(duration) || duration < 0) return null
	if (!Number.isFinite(distance) || distance < 0) return null
	if (!Number.isFinite(elevationGain) || elevationGain < 0) return null
	if (!Number.isFinite(calories) || calories < 0) return null
	if (!Number.isFinite(avgHR) || avgHR < 0) return null
	if (!Number.isFinite(maxHR) || maxHR < 0) return null

	return { date, stravaId, activityType, name, duration, distance, elevationGain, calories, avgHR, maxHR }
}

/* ------------------------------------------------------------------ */
/*  Strava tab – read/write                                            */
/* ------------------------------------------------------------------ */

/**
 * Check if the Strava tab exists in the spreadsheet.
 */
export async function verifyStravaTab(
	spreadsheetId: string,
): Promise<boolean> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const response = await gapi.client.sheets.spreadsheets.get({
		spreadsheetId,
	})
	const sheets = response.result.sheets ?? []
	return sheets.some(
		(s) => s.properties.title === STRAVA_TAB_NAME,
	)
}

/**
 * Create the Strava tab inside the given spreadsheet and write the header row.
 */
export async function createStravaTab(
	spreadsheetId: string,
): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	await gapi.client.sheets.spreadsheets.batchUpdate({
		spreadsheetId,
		resource: {
			requests: [{ addSheet: { properties: { title: STRAVA_TAB_NAME } } }],
		},
	})

	// Write header to row 1
	await gapi.client.sheets.spreadsheets.values.update({
		spreadsheetId,
		range: STRAVA_HEADER_RANGE,
		valueInputOption: 'RAW',
		resource: { values: [STRAVA_HEADER] },
	})
}

/**
 * Read the Strava tab and return parsed activities.
 * Returns an empty array if no valid rows exist.
 */
export async function readStravaActivities(
	spreadsheetId: string,
): Promise<StravaActivity[]> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const response = await gapi.client.sheets.spreadsheets.values.get({
		spreadsheetId,
		range: STRAVA_READ_RANGE,
	})

	const rawRows = response.result.values
	if (!rawRows || rawRows.length === 0) return []

	return rawRows
		.map(parseStravaRow)
		.filter((r): r is StravaActivity => r !== null)
}

/* ------------------------------------------------------------------ */
/*  Withings tab – constants                                           */
/* ------------------------------------------------------------------ */

/** A1 range for the Withings tab (open-ended rows, 10 columns). */
export const WITHINGS_SYNC_RANGE = `'${WITHINGS_TAB_NAME}'!A:J`

/** A1 range for the Withings tab header (row 1). */
const WITHINGS_HEADER_RANGE = `'${WITHINGS_TAB_NAME}'!A1:J1`

/** A1 range for reading Withings data (row 2 onward, open-ended). */
const WITHINGS_READ_RANGE = `'${WITHINGS_TAB_NAME}'!A2:J`

export const WITHINGS_HEADER: string[] = [
	'date',
	'grpId',
	'weight',
	'fatMass',
	'fatRatio',
	'muscleMass',
	'boneMass',
	'hydration',
	'fatFreeMass',
	'heartRate',
]

/* ------------------------------------------------------------------ */
/*  Withings tab – serialization                                       */
/* ------------------------------------------------------------------ */

/** Serialize an optional numeric field: null → empty cell. */
function optionalNumToCell(v: number | null): string {
	return v == null ? '' : String(v)
}

/** Convert a {@link WithingsMeasurement} to a spreadsheet row. */
export function withingsMeasurementToRow(m: WithingsMeasurement): string[] {
	return [
		m.date,
		m.grpId,
		String(m.weight),
		optionalNumToCell(m.fatMass),
		optionalNumToCell(m.fatRatio),
		optionalNumToCell(m.muscleMass),
		optionalNumToCell(m.boneMass),
		optionalNumToCell(m.hydration),
		optionalNumToCell(m.fatFreeMass),
		optionalNumToCell(m.heartRate),
	]
}

/**
 * Parse an optional numeric cell. Blank/whitespace → null. An invalid or
 * negative number is treated as absent (null) rather than failing the row,
 * since body-composition fields are secondary to weight.
 */
function parseOptionalNum(raw: string): number | null {
	const trimmed = (raw ?? '').trim()
	if (!trimmed) return null
	const n = Number(trimmed)
	if (!Number.isFinite(n) || n < 0) return null
	return n
}

/**
 * Parse a single raw Withings row (string array) into a {@link WithingsMeasurement}.
 * Returns `null` for incomplete or invalid rows (missing date/grpId, bad date
 * format, or a missing/invalid weight — weight is the one required metric).
 */
export function parseWithingsRow(row: string[]): WithingsMeasurement | null {
	if (!row || row.length < 3) return null

	const date = (row[0] ?? '').trim()
	const grpId = (row[1] ?? '').trim()
	const rawWeight = (row[2] ?? '').trim()

	if (!date || !grpId) return null
	// Basic date format validation: YYYY-MM-DD
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null

	const weight = Number(rawWeight)
	if (!Number.isFinite(weight) || weight <= 0) return null

	return {
		date,
		grpId,
		weight,
		fatMass: parseOptionalNum(row[3]),
		fatRatio: parseOptionalNum(row[4]),
		muscleMass: parseOptionalNum(row[5]),
		boneMass: parseOptionalNum(row[6]),
		hydration: parseOptionalNum(row[7]),
		fatFreeMass: parseOptionalNum(row[8]),
		heartRate: parseOptionalNum(row[9]),
	}
}

/* ------------------------------------------------------------------ */
/*  Withings tab – read/write                                          */
/* ------------------------------------------------------------------ */

/**
 * Check if the Withings tab exists in the spreadsheet.
 */
export async function verifyWithingsTab(
	spreadsheetId: string,
): Promise<boolean> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const response = await gapi.client.sheets.spreadsheets.get({
		spreadsheetId,
	})
	const sheets = response.result.sheets ?? []
	return sheets.some(
		(s) => s.properties.title === WITHINGS_TAB_NAME,
	)
}

/**
 * Create the Withings tab inside the given spreadsheet and write the header row.
 */
export async function createWithingsTab(
	spreadsheetId: string,
): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	await gapi.client.sheets.spreadsheets.batchUpdate({
		spreadsheetId,
		resource: {
			requests: [{ addSheet: { properties: { title: WITHINGS_TAB_NAME } } }],
		},
	})

	// Write header to row 1
	await gapi.client.sheets.spreadsheets.values.update({
		spreadsheetId,
		range: WITHINGS_HEADER_RANGE,
		valueInputOption: 'RAW',
		resource: { values: [WITHINGS_HEADER] },
	})
}

/**
 * Read the Withings tab and return parsed measurements.
 * Returns an empty array if no valid rows exist.
 */
export async function readWithingsMeasurements(
	spreadsheetId: string,
): Promise<WithingsMeasurement[]> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const response = await gapi.client.sheets.spreadsheets.values.get({
		spreadsheetId,
		range: WITHINGS_READ_RANGE,
	})

	const rawRows = response.result.values
	if (!rawRows || rawRows.length === 0) return []

	return rawRows
		.map(parseWithingsRow)
		.filter((r): r is WithingsMeasurement => r !== null)
}


/* ------------------------------------------------------------------ */
/*  Settings tab – constants                                           */
/* ------------------------------------------------------------------ */

/** A1 range for the settings tab (open-ended rows, 2 columns). */
const SETTINGS_RANGE = `'${SETTINGS_TAB_NAME}'!A:B`

const SETTINGS_HEADER: string[] = ['key', 'value']

/* ------------------------------------------------------------------ */
/*  Settings tab – CRUD                                                */
/* ------------------------------------------------------------------ */

/** Check whether the settings tab exists in the spreadsheet. */
export async function verifySettingsTab(
	spreadsheetId: string,
): Promise<boolean> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const response = await gapi.client.sheets.spreadsheets.get({
		spreadsheetId,
	})
	const sheets = response.result.sheets ?? []
	return sheets.some(
		(s: { properties?: { title?: string } }) =>
			s.properties?.title === SETTINGS_TAB_NAME,
	)
}

/** Create the settings tab. Header row is written on first save via {@link writeSettings}. */
export async function createSettingsTab(
	spreadsheetId: string,
): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	await gapi.client.sheets.spreadsheets.batchUpdate({
		spreadsheetId,
		resource: {
			requests: [{ addSheet: { properties: { title: SETTINGS_TAB_NAME } } }],
		},
	})
}

/**
 * Read all settings from the settings tab as a key/value map.
 * Returns an empty map if the tab is empty or has only a header.
 * Rows with empty keys or values are skipped.
 */
export async function readSettings(
	spreadsheetId: string,
): Promise<Map<string, string>> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const response = await gapi.client.sheets.spreadsheets.values.get({
		spreadsheetId,
		range: SETTINGS_RANGE,
	})

	const allRows = response.result.values
	if (!allRows || allRows.length <= 1) return new Map()

	const result = new Map<string, string>()
	for (const row of allRows.slice(1)) {
		if (!row || row.length < 2) continue
		const key = (row[0] ?? '').trim()
		const value = (row[1] ?? '').trim()
		if (key && value) {
			result.set(key, value)
		}
	}
	return result
}

/**
 * Write all settings to the settings tab (full overwrite).
 * Clears existing data first, then writes header + rows.
 */
export async function writeSettings(
	spreadsheetId: string,
	settings: Map<string, string>,
): Promise<void> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const allRows: string[][] = [
		SETTINGS_HEADER,
		...[...settings.entries()].map(([key, value]) => [key, value]),
	]

	await gapi.client.sheets.spreadsheets.values.clear({
		spreadsheetId,
		range: SETTINGS_RANGE,
	})

	await gapi.client.sheets.spreadsheets.values.update({
		spreadsheetId,
		range: SETTINGS_RANGE,
		valueInputOption: 'RAW',
		resource: { values: allRows },
	})
}

/* ------------------------------------------------------------------ */
/*  Settings tab – goal helpers                                        */
/* ------------------------------------------------------------------ */

/** Key prefix used for goal entries in the settings tab. */
const GOAL_KEY_PREFIX = 'goal.'

/** Valid goal metric values. */
const VALID_GOAL_METRICS = new Set(['distance', 'elevationGain', 'duration'])

/**
 * Extract {@link StravaGoal} entries from a settings map.
 * Goal keys use the format `goal.<metric>` (e.g. `goal.distance`).
 */
export function goalsFromSettings(settings: Map<string, string>): StravaGoal[] {
	const goals: StravaGoal[] = []
	for (const [key, raw] of settings) {
		if (!key.startsWith(GOAL_KEY_PREFIX)) continue
		const metric = key.slice(GOAL_KEY_PREFIX.length)
		if (!VALID_GOAL_METRICS.has(metric)) continue
		const value = Number(raw)
		if (!isFinite(value) || value <= 0) continue
		goals.push({ metric: metric as StravaMetric, value })
	}
	return goals
}

/**
 * Merge {@link StravaGoal} entries into a settings map.
 * Removes any existing `goal.*` keys and replaces them with the new goals.
 * Returns the updated map (mutates the input).
 */
export function goalsToSettings(
	goals: StravaGoal[],
	settings: Map<string, string>,
): Map<string, string> {
	// Remove old goal keys
	for (const key of [...settings.keys()]) {
		if (key.startsWith(GOAL_KEY_PREFIX)) {
			settings.delete(key)
		}
	}
	// Add new goal keys
	for (const g of goals) {
		settings.set(`${GOAL_KEY_PREFIX}${g.metric}`, String(g.value))
	}
	return settings
}

/* ------------------------------------------------------------------ */
/*  Settings tab – Withings goal helpers                               */
/* ------------------------------------------------------------------ */

/** Key prefix used for Withings body-composition goal entries. */
const BODY_GOAL_KEY_PREFIX = 'bodyGoal.'

/** Valid Withings goal metric values. */
const VALID_BODY_GOAL_METRICS = new Set([
	'weight',
	'fatMass',
	'fatRatio',
	'muscleMass',
	'boneMass',
	'hydration',
	'fatFreeMass',
	'heartRate',
])

/**
 * Extract {@link WithingsGoal} entries from a settings map.
 * Goal keys use the format `bodyGoal.<metric>` (e.g. `bodyGoal.weight`).
 */
export function bodyGoalsFromSettings(settings: Map<string, string>): WithingsGoal[] {
	const goals: WithingsGoal[] = []
	for (const [key, raw] of settings) {
		if (!key.startsWith(BODY_GOAL_KEY_PREFIX)) continue
		const metric = key.slice(BODY_GOAL_KEY_PREFIX.length)
		if (!VALID_BODY_GOAL_METRICS.has(metric)) continue
		const value = Number(raw)
		if (!isFinite(value) || value <= 0) continue
		goals.push({ metric: metric as WithingsMetric, value })
	}
	return goals
}

/**
 * Merge {@link WithingsGoal} entries into a settings map.
 * Removes any existing `bodyGoal.*` keys and replaces them with the new goals.
 * Returns the updated map (mutates the input).
 */
export function bodyGoalsToSettings(
	goals: WithingsGoal[],
	settings: Map<string, string>,
): Map<string, string> {
	for (const key of [...settings.keys()]) {
		if (key.startsWith(BODY_GOAL_KEY_PREFIX)) {
			settings.delete(key)
		}
	}
	for (const g of goals) {
		settings.set(`${BODY_GOAL_KEY_PREFIX}${g.metric}`, String(g.value))
	}
	return settings
}

/* ------------------------------------------------------------------ */
/*  Settings tab – lift goal helpers                                    */
/* ------------------------------------------------------------------ */

/** Key prefix used for lift goal entries in the settings tab. */
const LIFT_GOAL_KEY_PREFIX = 'liftGoal.'

/** The four main barbell lifts that support goals. */
const VALID_LIFT_GOAL_IDS = new Set(['squat', 'bench-press', 'deadlift', 'overhead-press'])

/** A weight goal for one of the Big 4 barbell lifts. */
export interface LiftGoal {
	liftId: string;
	weight: number;
}

/**
 * Extract {@link LiftGoal} entries from a settings map.
 * Goal keys use the format `liftGoal.<liftId>` (e.g. `liftGoal.squat`).
 */
export function liftGoalsFromSettings(settings: Map<string, string>): LiftGoal[] {
	const goals: LiftGoal[] = []
	for (const [key, raw] of settings) {
		if (!key.startsWith(LIFT_GOAL_KEY_PREFIX)) continue
		const liftId = key.slice(LIFT_GOAL_KEY_PREFIX.length)
		if (!VALID_LIFT_GOAL_IDS.has(liftId)) continue
		const weight = Number(raw)
		if (!isFinite(weight) || weight <= 0) continue
		goals.push({ liftId, weight })
	}
	return goals
}

/**
 * Merge {@link LiftGoal} entries into a settings map.
 * Removes any existing `liftGoal.*` keys and replaces them with the new goals.
 * Returns the updated map (mutates the input).
 */
export function liftGoalsToSettings(
	goals: LiftGoal[],
	settings: Map<string, string>,
): Map<string, string> {
	for (const key of [...settings.keys()]) {
		if (key.startsWith(LIFT_GOAL_KEY_PREFIX)) {
			settings.delete(key)
		}
	}
	for (const g of goals) {
		settings.set(`${LIFT_GOAL_KEY_PREFIX}${g.liftId}`, String(g.weight))
	}
	return settings
}

/* ------------------------------------------------------------------ */
/*  Settings tab – app settings helpers                                */
/* ------------------------------------------------------------------ */

/** Default app settings (all features enabled). */
export const DEFAULT_APP_SETTINGS: AppSettings = {
	showRestTimer: true,
	showSetComments: true,
	keepScreenOn: true,
	withingsDipThresholdPercent: 2,
	progressDipThresholdPercent: 10,
}

/** Settings key prefix for app-level settings. */
const APP_SETTING_PREFIX = 'app.'

/** Map of app setting keys to their AppSettings field names. */
const APP_SETTING_BOOL_KEYS: Record<string, AppBooleanSettingKey> = {
	'app.showRestTimer': 'showRestTimer',
	'app.showSetComments': 'showSetComments',
	'app.keepScreenOn': 'keepScreenOn',
}

const APP_SETTING_PERCENT_KEYS: Record<string, AppPercentSettingKey> = {
	'app.withingsDipThresholdPercent': 'withingsDipThresholdPercent',
	'app.progressDipThresholdPercent': 'progressDipThresholdPercent',
}

/**
 * Extract {@link AppSettings} from a settings map.
 * Missing keys default to the values in {@link DEFAULT_APP_SETTINGS}.
 */
export function appSettingsFromMap(settings: Map<string, string>): AppSettings {
	const result = { ...DEFAULT_APP_SETTINGS }
	for (const [key, field] of Object.entries(APP_SETTING_BOOL_KEYS)) {
		const raw = settings.get(key)
		if (raw !== undefined) {
			result[field] = raw === 'true'
		}
	}
	for (const [key, field] of Object.entries(APP_SETTING_PERCENT_KEYS)) {
		const raw = settings.get(key)
		if (raw === undefined) continue
		const value = Number(raw)
		if (isFinite(value) && value > 0 && value <= 100) {
			result[field] = value
		}
	}
	return result
}

/**
 * Merge {@link AppSettings} into a settings map.
 * Removes any existing `app.*` keys and replaces them.
 * Returns the updated map (mutates the input).
 */
export function appSettingsToMap(
	appSettings: AppSettings,
	settings: Map<string, string>,
): Map<string, string> {
	// Remove old app setting keys
	for (const key of [...settings.keys()]) {
		if (key.startsWith(APP_SETTING_PREFIX)) {
			settings.delete(key)
		}
	}
	// Add new app setting keys
	for (const [key, field] of Object.entries(APP_SETTING_BOOL_KEYS)) {
		settings.set(key, String(appSettings[field]))
	}
	for (const [key, field] of Object.entries(APP_SETTING_PERCENT_KEYS)) {
		settings.set(key, String(appSettings[field]))
	}
	return settings
}
