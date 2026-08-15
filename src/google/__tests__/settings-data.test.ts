import { describe, it, expect } from 'vitest'
import {
	goalsFromSettings,
	goalsToSettings,
	DEFAULT_APP_SETTINGS,
	appSettingsFromMap,
	appSettingsToMap,
} from '../sheets.ts'

/* ------------------------------------------------------------------ */
/*  goalsFromSettings                                                   */
/* ------------------------------------------------------------------ */

describe('goalsFromSettings', () => {
	it('extracts goals from settings map', () => {
		const settings = new Map([
			['goal.distance', '1000'],
			['goal.elevationGain', '200000'],
			['goal.duration', '500'],
		])
		expect(goalsFromSettings(settings)).toEqual([
			{ metric: 'distance', value: 1000 },
			{ metric: 'elevationGain', value: 200000 },
			{ metric: 'duration', value: 500 },
		])
	})

	it('ignores non-goal keys', () => {
		const settings = new Map([
			['theme', 'dark'],
			['goal.distance', '1000'],
			['language', 'en'],
		])
		expect(goalsFromSettings(settings)).toEqual([
			{ metric: 'distance', value: 1000 },
		])
	})

	it('returns empty array for empty settings', () => {
		expect(goalsFromSettings(new Map())).toEqual([])
	})

	it('skips invalid metric names', () => {
		const settings = new Map([
			['goal.speed', '100'],
			['goal.distance', '500'],
		])
		expect(goalsFromSettings(settings)).toEqual([
			{ metric: 'distance', value: 500 },
		])
	})

	it('skips non-numeric values', () => {
		const settings = new Map([
			['goal.distance', 'abc'],
		])
		expect(goalsFromSettings(settings)).toEqual([])
	})

	it('skips zero values', () => {
		const settings = new Map([
			['goal.distance', '0'],
		])
		expect(goalsFromSettings(settings)).toEqual([])
	})

	it('skips negative values', () => {
		const settings = new Map([
			['goal.distance', '-100'],
		])
		expect(goalsFromSettings(settings)).toEqual([])
	})

	it('handles decimal values', () => {
		const settings = new Map([
			['goal.duration', '500.5'],
		])
		expect(goalsFromSettings(settings)).toEqual([
			{ metric: 'duration', value: 500.5 },
		])
	})
})

/* ------------------------------------------------------------------ */
/*  goalsToSettings                                                     */
/* ------------------------------------------------------------------ */

describe('goalsToSettings', () => {
	it('writes goals into an empty settings map', () => {
		const settings = new Map<string, string>()
		goalsToSettings(
			[{ metric: 'distance', value: 1000 }],
			settings,
		)
		expect(settings.get('goal.distance')).toBe('1000')
	})

	it('preserves non-goal settings', () => {
		const settings = new Map([
			['theme', 'dark'],
			['language', 'en'],
		])
		goalsToSettings(
			[{ metric: 'distance', value: 1000 }],
			settings,
		)
		expect(settings.get('theme')).toBe('dark')
		expect(settings.get('language')).toBe('en')
		expect(settings.get('goal.distance')).toBe('1000')
	})

	it('removes old goals when replacing', () => {
		const settings = new Map([
			['goal.distance', '500'],
			['goal.elevationGain', '100000'],
		])
		goalsToSettings(
			[{ metric: 'distance', value: 1000 }],
			settings,
		)
		expect(settings.get('goal.distance')).toBe('1000')
		expect(settings.has('goal.elevationGain')).toBe(false)
	})

	it('clears all goals when given empty array', () => {
		const settings = new Map([
			['goal.distance', '500'],
			['theme', 'dark'],
		])
		goalsToSettings([], settings)
		expect(settings.has('goal.distance')).toBe(false)
		expect(settings.get('theme')).toBe('dark')
	})

	it('round-trips through goalsFromSettings', () => {
		const goals = [
			{ metric: 'distance' as const, value: 1000 },
			{ metric: 'elevationGain' as const, value: 200000 },
		]
		const settings = new Map<string, string>()
		goalsToSettings(goals, settings)
		expect(goalsFromSettings(settings)).toEqual(goals)
	})

	it('returns the mutated settings map', () => {
		const settings = new Map<string, string>()
		const result = goalsToSettings(
			[{ metric: 'duration', value: 500 }],
			settings,
		)
		expect(result).toBe(settings)
	})
})

/* ------------------------------------------------------------------ */
/*  appSettingsFromMap / appSettingsToMap                              */
/* ------------------------------------------------------------------ */

describe('appSettingsFromMap / appSettingsToMap', () => {
	it('uses defaults when settings are missing', () => {
		expect(appSettingsFromMap(new Map())).toEqual(DEFAULT_APP_SETTINGS)
	})

	it('reads booleans and dip thresholds from settings', () => {
		const settings = new Map<string, string>([
			['app.showRestTimer', 'false'],
			['app.showSetComments', 'false'],
			['app.keepScreenOn', 'true'],
			['app.showGarminTab', 'true'],
			['app.showNutritionTab', 'true'],
			['app.skipProgressDips', 'false'],
			['app.skipBodyCompDips', 'false'],
			['app.withingsDipThresholdPercent', '2.5'],
			['app.progressDipThresholdPercent', '7.5'],
			['app.dailyCalorieGoal', '2500'],
			['app.dailyProteinGoalGrams', '180'],
			['app.garminDailySleepHoursGoal', '8.5'],
		])
		expect(appSettingsFromMap(settings)).toEqual({
			showRestTimer: false,
			showSetComments: false,
			keepScreenOn: true,
			roundWarmupPlateMath: false,
			showGarminTab: true,
			showNutritionTab: true,
			skipProgressDips: false,
			skipBodyCompDips: false,
			withingsDipThresholdPercent: 2.5,
			progressDipThresholdPercent: 7.5,
			dailyCalorieGoal: 2500,
			dailyProteinGoalGrams: 180,
			dailyFiberGoalGrams: 0,
			drinksPerDayGoal: 0,
			garminDailyStepsGoal: 0,
			garminDailyFloorsGoal: 0,
			garminDailySleepHoursGoal: 8.5,
			garminWeeklyIntensityMinGoal: 0,
		})
	})

	it('falls back to defaults for invalid dip-threshold values', () => {
		const settings = new Map<string, string>([
			['app.withingsDipThresholdPercent', '-1'],
			['app.progressDipThresholdPercent', '0'],
			['app.dailyCalorieGoal', '-100'],
			['app.dailyProteinGoalGrams', '2000'],
		])
		expect(appSettingsFromMap(settings)).toEqual(DEFAULT_APP_SETTINGS)
	})

	it('writes app settings and replaces existing app.* keys', () => {
		const settings = new Map<string, string>([
			['theme', 'dark'],
			['app.showRestTimer', 'true'],
			['app.withingsDipThresholdPercent', '5'],
			['app.progressDipThresholdPercent', '10'],
		])
		const appSettings = {
			showRestTimer: false,
			showSetComments: true,
			keepScreenOn: false,
			roundWarmupPlateMath: false,
			showGarminTab: true,
			showNutritionTab: true,
			skipProgressDips: false,
			skipBodyCompDips: true,
			withingsDipThresholdPercent: 3,
			progressDipThresholdPercent: 6,
			dailyCalorieGoal: 2200,
			dailyProteinGoalGrams: 160,
			dailyFiberGoalGrams: 0,
			drinksPerDayGoal: 2,
			garminDailyStepsGoal: 0,
			garminDailyFloorsGoal: 0,
			garminDailySleepHoursGoal: 8,
			garminWeeklyIntensityMinGoal: 0,
		}
		appSettingsToMap(appSettings, settings)
		expect(settings.get('theme')).toBe('dark')
		expect(settings.get('app.showRestTimer')).toBe('false')
		expect(settings.get('app.showSetComments')).toBe('true')
		expect(settings.get('app.keepScreenOn')).toBe('false')
		expect(settings.get('app.showGarminTab')).toBe('true')
		expect(settings.get('app.showNutritionTab')).toBe('true')
		expect(settings.get('app.skipProgressDips')).toBe('false')
		expect(settings.get('app.skipBodyCompDips')).toBe('true')
		expect(settings.get('app.withingsDipThresholdPercent')).toBe('3')
		expect(settings.get('app.progressDipThresholdPercent')).toBe('6')
		expect(settings.get('app.dailyCalorieGoal')).toBe('2200')
		expect(settings.get('app.dailyProteinGoalGrams')).toBe('160')
		expect(settings.get('app.drinksPerDayGoal')).toBe('2')
		expect(settings.get('app.garminDailyStepsGoal')).toBe('0')
		expect(settings.get('app.garminDailyFloorsGoal')).toBe('0')
		expect(settings.get('app.garminDailySleepHoursGoal')).toBe('8')
		expect(settings.get('app.garminWeeklyIntensityMinGoal')).toBe('0')
	})
})
