import { describe, it, expect } from 'vitest'
import {
	goalsFromSettings,
	goalsToSettings,
	bodyGoalsFromSettings,
	bodyGoalsToSettings,
	liftGoalsFromSettings,
	liftGoalsToSettings,
	DEFAULT_APP_SETTINGS,
	appSettingsFromMap,
	appSettingsToMap,
} from '../settings.ts'

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

describe('bodyGoalsFromSettings / bodyGoalsToSettings', () => {
	it('extracts body goals with the bodyGoal. prefix', () => {
		const settings = new Map<string, string>([
			['bodyGoal.weight', '75'],
			['bodyGoal.fatRatio', '15'],
			['bodyGoal.visceralFat', '8'],
			['goal.distance', '1500'],
			['unrelated', 'x'],
		])
		expect(bodyGoalsFromSettings(settings)).toEqual([
			{ metric: 'weight', value: 75 },
			{ metric: 'fatRatio', value: 15 },
			{ metric: 'visceralFat', value: 8 },
		])
	})

	it('ignores invalid metrics and non-positive values', () => {
		const settings = new Map<string, string>([
			['bodyGoal.bogus', '10'],
			['bodyGoal.weight', '0'],
			['bodyGoal.muscleMass', '-5'],
			['bodyGoal.fatRatio', 'NaN'],
		])
		expect(bodyGoalsFromSettings(settings)).toEqual([])
	})

	it('does not collide with activity goal keys', () => {
		const settings = new Map<string, string>([['goal.distance', '1500']])
		bodyGoalsToSettings([{ metric: 'weight', value: 75 }], settings)
		expect(settings.get('goal.distance')).toBe('1500')
		expect(settings.get('bodyGoal.weight')).toBe('75')
	})

	it('replaces existing body goals', () => {
		const settings = new Map<string, string>([['bodyGoal.weight', '80']])
		bodyGoalsToSettings([{ metric: 'fatRatio', value: 15 }], settings)
		expect(settings.has('bodyGoal.weight')).toBe(false)
		expect(settings.get('bodyGoal.fatRatio')).toBe('15')
	})
})

describe('liftGoalsFromSettings / liftGoalsToSettings', () => {
	it('round-trips goals for all four main lifts without changing unrelated settings', () => {
		const goals = ['squat', 'bench-press', 'deadlift', 'overhead-press']
			.map((liftId) => ({ liftId, weight: 200 }))
		const settings = new Map([['calendar.syncCalendarId', 'calendar-id']])
		expect(liftGoalsToSettings(goals, settings)).toBe(settings)
		expect(liftGoalsFromSettings(settings)).toEqual(goals)
		expect(settings.get('calendar.syncCalendarId')).toBe('calendar-id')
	})

	it('ignores invalid lift IDs and invalid weights', () => {
		expect(liftGoalsFromSettings(new Map([
			['liftGoal.curl', '100'],
			['liftGoal.squat', '0'],
			['liftGoal.bench-press', '-1'],
			['liftGoal.deadlift', 'NaN'],
			['liftGoal.overhead-press', 'Infinity'],
		]))).toEqual([])
	})

	it('replaces or clears lift goals without removing other goals', () => {
		const settings = new Map([
			['liftGoal.squat', '300'],
			['bodyGoal.weight', '75'],
			['goal.distance', '1000'],
		])
		liftGoalsToSettings([{ liftId: 'deadlift', weight: 400 }], settings)
		expect(settings.has('liftGoal.squat')).toBe(false)
		expect(liftGoalsFromSettings(settings)).toEqual([{ liftId: 'deadlift', weight: 400 }])
		liftGoalsToSettings([], settings)
		expect([...settings]).toEqual([['bodyGoal.weight', '75'], ['goal.distance', '1000']])
	})
})

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
			['app.showCalendarTab', 'false'],
			['app.skipProgressDips', 'false'],
			['app.skipBodyCompDips', 'false'],
			['app.withingsDipThresholdPercent', '2.5'],
			['app.progressDipThresholdPercent', '7.5'],
			['app.garminDailySleepHoursGoal', '8.5'],
		])
		expect(appSettingsFromMap(settings)).toEqual({
			showRestTimer: false,
			showSetComments: false,
			keepScreenOn: true,
			roundWarmupPlateMath: false,
			showGarminTab: true,
			showCalendarTab: false,
			skipProgressDips: false,
			skipBodyCompDips: false,
			withingsDipThresholdPercent: 2.5,
			progressDipThresholdPercent: 7.5,
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
			showCalendarTab: false,
			skipProgressDips: false,
			skipBodyCompDips: true,
			withingsDipThresholdPercent: 3,
			progressDipThresholdPercent: 6,
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
		expect(settings.get('app.showCalendarTab')).toBe('false')
		expect(settings.get('app.skipProgressDips')).toBe('false')
		expect(settings.get('app.skipBodyCompDips')).toBe('true')
		expect(settings.get('app.withingsDipThresholdPercent')).toBe('3')
		expect(settings.get('app.progressDipThresholdPercent')).toBe('6')
		expect(settings.get('app.garminDailyStepsGoal')).toBe('0')
		expect(settings.get('app.garminDailyFloorsGoal')).toBe('0')
		expect(settings.get('app.garminDailySleepHoursGoal')).toBe('8')
		expect(settings.get('app.garminWeeklyIntensityMinGoal')).toBe('0')
	})
})
