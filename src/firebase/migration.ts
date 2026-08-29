import type {
	CardioActivity,
	DayFlagEntry,
	FoodItem,
	GarminWellnessEntry,
	LiftConfig,
	MealItem,
	MealLogEntry,
	WithingsMeasurement,
	WorkoutScheduleEntry,
} from '../model/index.ts'
import type { StravaActivity } from '../model/types.ts'
import type { WorkoutDefinition } from '../data/sample-workouts.ts'
import type { ParsedLogRow } from '../google/sheets.ts'
import {
	authorizeSheetsImport,
	clearGoogleApiAuthorization,
	extractSheetId,
	readCardioActivities as readSheetCardio,
	readConfigZone as readSheetConfigs,
	readFlags as readSheetFlags,
	readGarminActivities as readSheetGarmin,
	readGarminWellnessEntries as readSheetWellness,
	readLogZone as readSheetLogs,
	readMealFavorites as readSheetFavorites,
	readMealItems as readSheetMealItems,
	readMealLog as readSheetMealLog,
	readMealRecents as readSheetRecents,
	readSettings as readSheetSettings,
	readStravaActivities as readSheetStrava,
	readWithingsMeasurements as readSheetWithings,
	readWorkoutDefs as readSheetWorkouts,
	readWorkoutSchedule as readSheetSchedule,
	verifySheetAccess,
} from '../google/index.ts'
import {
	readConfigZone,
	readLogZone,
	readWorkoutDefs,
	recordMigration,
	writeCardioActivities,
	writeConfigValues,
	writeFlags,
	writeGarminActivities,
	writeGarminWellnessEntries,
	writeMealFavorites,
	writeMealItems,
	writeMealLog,
	writeMealRecents,
	writeSettings,
	writeStravaActivities,
	writeWithingsMeasurements,
	writeWorkoutDefs,
	writeWorkoutSchedule,
	writeLogRows,
} from './store.ts'

interface MigrationData {
	configs: LiftConfig[]
	workouts: WorkoutDefinition[]
	logs: ParsedLogRow[]
	flags: DayFlagEntry[]
	schedule: WorkoutScheduleEntry[]
	cardio: CardioActivity[]
	mealItems: MealItem[]
	mealLog: MealLogEntry[]
	favorites: FoodItem[]
	recents: FoodItem[]
	strava: StravaActivity[]
	garmin: StravaActivity[]
	wellness: GarminWellnessEntry[]
	withings: WithingsMeasurement[]
	settings: Map<string, string>
}

export interface MigrationPreview {
	spreadsheetId: string
	counts: Record<string, number>
	warnings: string[]
	data: MigrationData
}

async function optional<T>(reader: () => Promise<T>, fallback: T, warnings: string[], label: string): Promise<T> {
	try {
		return await reader()
	} catch {
		warnings.push(`${label} could not be read and will be skipped.`)
		return fallback
	}
}

export async function previewSheetMigration(sheetUrl: string): Promise<MigrationPreview> {
	const spreadsheetId = extractSheetId(sheetUrl)
	if (!spreadsheetId) throw new Error('Enter a valid Google Sheets URL.')
	await authorizeSheetsImport()
	const warnings: string[] = []
	try {
		await verifySheetAccess(spreadsheetId)
		const configs = await readSheetConfigs(spreadsheetId) ?? []
		const liftNames = new Map(configs.map((item) => [item.id, item.name]))
		const data: MigrationData = {
			configs,
			workouts: await optional(() => readSheetWorkouts(spreadsheetId, liftNames).then((items) => items ?? []), [], warnings, 'Workouts'),
			logs: await optional(() => readSheetLogs(spreadsheetId), [], warnings, 'Workout log'),
			flags: await optional(() => readSheetFlags(spreadsheetId), [], warnings, 'Day flags'),
			schedule: await optional(() => readSheetSchedule(spreadsheetId), [], warnings, 'Schedule'),
			cardio: await optional(() => readSheetCardio(spreadsheetId).then((items) => items ?? []), [], warnings, 'Cardio'),
			mealItems: await optional(() => readSheetMealItems(spreadsheetId), [], warnings, 'Meal items'),
			mealLog: await optional(() => readSheetMealLog(spreadsheetId), [], warnings, 'Meal log'),
			favorites: await optional(() => readSheetFavorites(spreadsheetId), [], warnings, 'Favorite foods'),
			recents: await optional(() => readSheetRecents(spreadsheetId), [], warnings, 'Recent foods'),
			strava: await optional(() => readSheetStrava(spreadsheetId), [], warnings, 'Strava'),
			garmin: await optional(() => readSheetGarmin(spreadsheetId), [], warnings, 'Garmin'),
			wellness: await optional(() => readSheetWellness(spreadsheetId), [], warnings, 'Garmin wellness'),
			withings: await optional(() => readSheetWithings(spreadsheetId), [], warnings, 'Withings'),
			settings: await optional(() => readSheetSettings(spreadsheetId), new Map(), warnings, 'Settings'),
		}
		const counts = Object.fromEntries(Object.entries(data).map(([name, value]) => [
			name,
			value instanceof Map ? value.size : value.length,
		]))
		return { spreadsheetId, counts, warnings, data }
	} finally {
		clearGoogleApiAuthorization()
	}
}

export async function importSheetMigration(
	uid: string,
	preview: MigrationPreview,
	replace = false,
): Promise<void> {
	if (!replace) {
		const [configs, workouts, logs] = await Promise.all([
			readConfigZone(uid),
			readWorkoutDefs(uid),
			readLogZone(uid),
		])
		if ((configs?.length ?? 0) + (workouts?.length ?? 0) + logs.length > 0) {
			throw new Error('This account already contains data. Enable Replace existing data to continue.')
		}
	}

	const migrationId = `sheet-${preview.spreadsheetId}`
	await recordMigration(uid, migrationId, {
		sourceSpreadsheetId: preview.spreadsheetId,
		status: 'running',
		counts: preview.counts,
		warnings: preview.warnings,
		startedAt: new Date().toISOString(),
	})
	try {
		const data = preview.data
		await writeConfigValues(uid, data.configs)
		await writeWorkoutDefs(uid, data.workouts)
		await writeLogRows(uid, data.logs)
		await writeFlags(uid, data.flags)
		await writeWorkoutSchedule(uid, data.schedule)
		await writeCardioActivities(uid, data.cardio)
		await writeMealItems(uid, data.mealItems)
		await writeMealLog(uid, data.mealLog)
		await writeMealFavorites(uid, data.favorites)
		await writeMealRecents(uid, data.recents)
		await writeStravaActivities(uid, data.strava)
		await writeGarminActivities(uid, data.garmin)
		await writeGarminWellnessEntries(uid, data.wellness)
		await writeWithingsMeasurements(uid, data.withings)
		await writeSettings(uid, data.settings)
		await recordMigration(uid, migrationId, {
			status: 'complete',
			completedAt: new Date().toISOString(),
		})
	} catch (error) {
		await recordMigration(uid, migrationId, {
			status: 'failed',
			error: error instanceof Error ? error.message : String(error),
		})
		throw error
	}
}
