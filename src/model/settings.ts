import type { AppSettings, AppBooleanSettingKey, AppNumericSettingKey } from './types.ts'
import type { StravaGoal, StravaMetric } from './strava.ts'
import type { WithingsGoal, WithingsMetric } from './withings.ts'

const GOAL_KEY_PREFIX = 'goal.'
const VALID_GOAL_METRICS = new Set(['distance', 'elevationGain', 'duration'])

/** Extract activity goals using `goal.<metric>` settings keys. */
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

/** Replace activity goals in the input map, preserving unrelated settings. */
export function goalsToSettings(
	goals: StravaGoal[],
	settings: Map<string, string>,
): Map<string, string> {
	for (const key of [...settings.keys()]) {
		if (key.startsWith(GOAL_KEY_PREFIX)) {
			settings.delete(key)
		}
	}
	for (const g of goals) {
		settings.set(`${GOAL_KEY_PREFIX}${g.metric}`, String(g.value))
	}
	return settings
}

const BODY_GOAL_KEY_PREFIX = 'bodyGoal.'
const VALID_BODY_GOAL_METRICS = new Set([
	'weight',
	'fatMass',
	'fatRatio',
	'muscleMass',
	'boneMass',
	'hydration',
	'fatFreeMass',
	'heartRate',
	'visceralFat',
])

/** Extract body-composition goals using `bodyGoal.<metric>` settings keys. */
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

/** Replace body-composition goals in the input map, preserving unrelated settings. */
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

const LIFT_GOAL_KEY_PREFIX = 'liftGoal.'
const VALID_LIFT_GOAL_IDS = new Set(['squat', 'bench-press', 'deadlift', 'overhead-press'])

/** A weight goal for one of the Big 4 barbell lifts. */
export interface LiftGoal {
	liftId: string
	weight: number
}

/** Extract lift goals using `liftGoal.<liftId>` settings keys. */
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

/** Replace lift goals in the input map, preserving unrelated settings. */
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

export const DEFAULT_APP_SETTINGS: AppSettings = {
	showRestTimer: true,
	showSetComments: true,
	keepScreenOn: true,
	roundWarmupPlateMath: false,
	showGarminTab: false,
	showCalendarTab: true,
	withingsDipThresholdPercent: 2,
	progressDipThresholdPercent: 10,
	skipProgressDips: true,
	skipBodyCompDips: true,
	garminDailyStepsGoal: 0,
	garminDailyFloorsGoal: 0,
	garminDailySleepHoursGoal: 0,
	garminWeeklyIntensityMinGoal: 0,
}

const APP_SETTING_PREFIX = 'app.'

const APP_SETTING_BOOL_KEYS: Record<string, AppBooleanSettingKey> = {
	'app.showRestTimer': 'showRestTimer',
	'app.showSetComments': 'showSetComments',
	'app.keepScreenOn': 'keepScreenOn',
	'app.roundWarmupPlateMath': 'roundWarmupPlateMath',
	'app.showGarminTab': 'showGarminTab',
	'app.showCalendarTab': 'showCalendarTab',
	'app.skipProgressDips': 'skipProgressDips',
	'app.skipBodyCompDips': 'skipBodyCompDips',
}

const APP_SETTING_NUMBER_KEYS: Record<string, { field: AppNumericSettingKey; min: number; max: number }> = {
	'app.withingsDipThresholdPercent': { field: 'withingsDipThresholdPercent', min: 0.1, max: 100 },
	'app.progressDipThresholdPercent': { field: 'progressDipThresholdPercent', min: 0.1, max: 100 },
	'app.garminDailyStepsGoal': { field: 'garminDailyStepsGoal', min: 0, max: 100000 },
	'app.garminDailyFloorsGoal': { field: 'garminDailyFloorsGoal', min: 0, max: 500 },
	'app.garminDailySleepHoursGoal': { field: 'garminDailySleepHoursGoal', min: 0, max: 24 },
	'app.garminWeeklyIntensityMinGoal': { field: 'garminWeeklyIntensityMinGoal', min: 0, max: 10000 },
}

/** Read app settings, falling back to defaults for missing or invalid values. */
export function appSettingsFromMap(settings: Map<string, string>): AppSettings {
	const result = { ...DEFAULT_APP_SETTINGS }
	for (const [key, field] of Object.entries(APP_SETTING_BOOL_KEYS)) {
		const raw = settings.get(key)
		if (raw !== undefined) {
			result[field] = raw === 'true'
		}
	}
	for (const [key, { field, min, max }] of Object.entries(APP_SETTING_NUMBER_KEYS)) {
		const raw = settings.get(key)
		if (raw === undefined) continue
		const value = Number(raw)
		if (isFinite(value) && value >= min && value <= max) {
			result[field] = value
		}
	}
	return result
}

/** Replace app settings in the input map, preserving unrelated settings. */
export function appSettingsToMap(
	appSettings: AppSettings,
	settings: Map<string, string>,
): Map<string, string> {
	for (const key of [...settings.keys()]) {
		if (key.startsWith(APP_SETTING_PREFIX)) {
			settings.delete(key)
		}
	}
	for (const [key, field] of Object.entries(APP_SETTING_BOOL_KEYS)) {
		settings.set(key, String(appSettings[field]))
	}
	for (const [key, { field }] of Object.entries(APP_SETTING_NUMBER_KEYS)) {
		settings.set(key, String(appSettings[field]))
	}
	return settings
}
