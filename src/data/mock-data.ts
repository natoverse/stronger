import type { WorkoutDefinition } from './sample-workouts.js'
import {
	defaultCardioActivities,
	defaultLiftConfigs,
	workoutDefinitions,
} from './sample-workouts.js'
import type {
	AppSettings,
	CardioActivity,
	DayFlagEntry,
	GarminWellnessEntry,
	LiftConfig,
	WithingsMeasurement,
	WorkoutScheduleEntry,
} from '../model/index.js'
import type { StravaActivity, StravaGoal } from '../model/strava.js'
import type { WithingsGoal } from '../model/withings.js'
import type { LiftGoal, ParsedLogRow } from '../google/index.js'

export const MOCK_USER_ID = 'mock-user'

export interface MockData {
	configs: LiftConfig[]
	definitions: WorkoutDefinition[]
	cardioActivities: CardioActivity[]
	workoutSchedule: WorkoutScheduleEntry[]
	dayFlags: DayFlagEntry[]
	logRows: ParsedLogRow[]
	settings: Map<string, string>
	appSettings: AppSettings
	stravaGoals: StravaGoal[]
	liftGoals: LiftGoal[]
	withingsGoals: WithingsGoal[]
	garminActivities: StravaActivity[]
	wellnessEntries: GarminWellnessEntry[]
	withingsMeasurements: WithingsMeasurement[]
}

function localDate(value: Date): string {
	return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function dateFrom(baseDate: Date, offsetDays: number): string {
	const value = new Date(baseDate)
	value.setDate(value.getDate() + offsetDays)
	return localDate(value)
}

function sessionRows(
	date: string,
	sessionNumber: number,
	definition: WorkoutDefinition,
	configs: LiftConfig[],
): ParsedLogRow[] {
	const startTime = `${date}T17:00:00.000Z`
	const endTime = `${date}T18:00:00.000Z`
	return definition.templates.slice(0, 2).map((template, index) => {
		const config = configs.find((item) => item.id === template.liftId)
		const weight = Math.max(0, (config?.topSetWeight ?? 100) - (3 - sessionNumber) * 5)
		return {
			date,
			startTime,
			endTime,
			workoutId: definition.id,
			exerciseName: template.name,
			liftId: template.liftId,
			setNumber: index + 1,
			setType: 'work',
			plannedWeight: weight,
			plannedReps: 5,
			actualWeight: weight,
			actualReps: 5 + (sessionNumber % 2),
			completed: true,
		}
	})
}

function wellnessEntry(date: string, index: number): GarminWellnessEntry {
	return {
		date,
		hrvWeeklyAvg: 48 + index,
		hrvStatus: index < 2 ? 'BALANCED' : 'UNBALANCED',
		sleepDurationSec: (7 * 60 + 15 + index * 5) * 60,
		sleepDeepSec: (70 + index * 2) * 60,
		sleepLightSec: (250 + index * 3) * 60,
		sleepRemSec: (105 + index * 2) * 60,
		sleepAwakeSec: 25 * 60,
		sleepScore: 78 + index,
		bodyBatteryHigh: 82 + index,
		bodyBatteryLow: 24 + index,
		readinessScore: 70 + index,
		trainingStatus: index < 3 ? 'PRODUCTIVE' : 'MAINTAINING',
		trainingAcuteLoad: 540 + index * 12,
		trainingChronicLoad: 510 + index * 8,
		steps: 8_500 + index * 650,
		floors: 8 + index,
		restingHR: 52 - Math.floor(index / 2),
		vo2Max: 48 + index * 0.2,
		intensityMinModerate: 18 + index * 2,
		intensityMinVigorous: 8 + index,
		hillScore: 58 + index,
		enduranceScore: 6100 + index * 30,
		heatAcclimationPct: 40 + index * 3,
		altitudeAcclimationPct: 500,
		currentAltitude: 150,
		activeCalories: 520 + index * 35,
		bmrCalories: 1850,
		avgStress: 31 + index,
		loadFocusAerobicLow: 280 + index * 4,
		loadFocusAerobicLowMin: 250,
		loadFocusAerobicLowMax: 400,
		loadFocusAerobicHigh: 330 + index * 5,
		loadFocusAerobicHighMin: 275,
		loadFocusAerobicHighMax: 425,
		loadFocusAnaerobic: 145 + index * 3,
		loadFocusAnaerobicMin: 125,
		loadFocusAnaerobicMax: 250,
		hrvBaselineMin: 42,
		hrvBaselineMax: 58,
	}
}

export function isMockMode(search = typeof window === 'undefined' ? '' : window.location.search): boolean {
	const value = new URLSearchParams(search).get('mock')
	return value === 'true' || value === '1'
}

export function createMockData(baseDate = new Date()): MockData {
	const definitions = workoutDefinitions.slice(0, 2)
	const liftIds = new Set(
		definitions.flatMap((definition) => definition.templates.map((template) => template.liftId)),
	)
	const configs = defaultLiftConfigs.filter((config) => liftIds.has(config.id))
	const cardioActivities = defaultCardioActivities.slice(0, 3)
	const logRows = [-90, -60, -30, -7].flatMap((offset, index) => (
		sessionRows(dateFrom(baseDate, offset), index, definitions[index % definitions.length], configs)
	))
	const settings = new Map<string, string>([
		['app.showRestTimer', 'true'],
		['app.showSetComments', 'true'],
		['app.keepScreenOn', 'false'],
		['app.roundWarmupPlateMath', 'true'],
		['app.showGarminTab', 'true'],
		['app.showCalendarTab', 'true'],
		['app.skipProgressDips', 'true'],
		['app.skipBodyCompDips', 'true'],
		['app.withingsDipThresholdPercent', '2'],
		['app.progressDipThresholdPercent', '10'],
		['app.garminDailyStepsGoal', '10000'],
		['app.garminDailyFloorsGoal', '10'],
		['app.garminDailySleepHoursGoal', '8'],
		['app.garminWeeklyIntensityMinGoal', '150'],
		['goal.distance', '500'],
		['goal.elevationGain', '75000'],
		['goal.duration', '250'],
		['bodyGoal.weight', '175'],
		['bodyGoal.fatRatio', '15'],
		['liftGoal.bench-press', '225'],
		['liftGoal.squat', '315'],
	])

	return {
		configs,
		definitions,
		cardioActivities,
		workoutSchedule: [
			{ date: dateFrom(baseDate, 0), workoutId: definitions[0].id, strongerId: 'mock-strength' },
			{ date: dateFrom(baseDate, 1), workoutId: cardioActivities[0].id, strongerId: 'mock-cardio', label: 'Easy neighborhood run' },
			{ date: dateFrom(baseDate, 2), workoutId: 'rest', strongerId: 'mock-rest' },
			{ date: dateFrom(baseDate, 3), workoutId: 'blocker', strongerId: 'mock-blocker', label: 'Travel day' },
		],
		dayFlags: [
			{
				date: dateFrom(baseDate, 0),
				flags: { home: true, elsewhere: false, travel: false, visitors: false, alcohol: false, blocked: false },
			},
			{
				date: dateFrom(baseDate, 3),
				flags: { home: false, elsewhere: true, travel: true, visitors: false, alcohol: false, blocked: true },
			},
		],
		logRows,
		settings,
		appSettings: {
			showRestTimer: true,
			showSetComments: true,
			keepScreenOn: false,
			roundWarmupPlateMath: true,
			showGarminTab: true,
			showCalendarTab: true,
			withingsDipThresholdPercent: 2,
			progressDipThresholdPercent: 10,
			skipProgressDips: true,
			skipBodyCompDips: true,
			garminDailyStepsGoal: 10000,
			garminDailyFloorsGoal: 10,
			garminDailySleepHoursGoal: 8,
			garminWeeklyIntensityMinGoal: 150,
		},
		stravaGoals: [
			{ metric: 'distance', value: 500 },
			{ metric: 'elevationGain', value: 75_000 },
			{ metric: 'duration', value: 250 },
		],
		liftGoals: [
			{ liftId: 'bench-press', weight: 225 },
			{ liftId: 'squat', weight: 315 },
		],
		withingsGoals: [
			{ metric: 'weight', value: 175 },
			{ metric: 'fatRatio', value: 15 },
		],
		garminActivities: [
			{ date: dateFrom(baseDate, -2), stravaId: 'mock-activity-1', activityType: 'Run', name: 'Morning Run', duration: 2700, distance: 7200, elevationGain: 85, elevationLoss: 82, calories: 520 },
			{ date: dateFrom(baseDate, -8), stravaId: 'mock-activity-2', activityType: 'Hike', name: 'Ridge Trail', duration: 8100, distance: 13500, elevationGain: 720, elevationLoss: 710, calories: 1100 },
			{ date: dateFrom(baseDate, -20), stravaId: 'mock-activity-3', activityType: 'Cycling', name: 'River Loop', duration: 5400, distance: 38000, elevationGain: 310, elevationLoss: 305, calories: 900 },
			{ date: dateFrom(baseDate, -45), stravaId: 'mock-activity-4', activityType: 'Strength Training', name: 'Gym Session', duration: 3600, distance: 0, elevationGain: 0, calories: 450 },
		],
		wellnessEntries: Array.from({ length: 7 }, (_, index) => wellnessEntry(dateFrom(baseDate, -index), 6 - index)),
		withingsMeasurements: [
			{ date: dateFrom(baseDate, -90), grpId: 'mock-weight-1', weight: 82.6, fatMass: 15.7, fatRatio: 19, muscleMass: 62.4, boneMass: 3.2, hydration: 47.1, fatFreeMass: 66.9, heartRate: 58, visceralFat: 8 },
			{ date: dateFrom(baseDate, -60), grpId: 'mock-weight-2', weight: 81.9, fatMass: 15.1, fatRatio: 18.4, muscleMass: 62.5, boneMass: 3.2, hydration: 47.3, fatFreeMass: 66.8, heartRate: 57, visceralFat: 8 },
			{ date: dateFrom(baseDate, -30), grpId: 'mock-weight-3', weight: 81.2, fatMass: 14.5, fatRatio: 17.9, muscleMass: 62.7, boneMass: 3.2, hydration: 47.6, fatFreeMass: 66.7, heartRate: 55, visceralFat: 7 },
			{ date: dateFrom(baseDate, -3), grpId: 'mock-weight-4', weight: 80.7, fatMass: 14.1, fatRatio: 17.5, muscleMass: 62.8, boneMass: 3.2, hydration: 47.8, fatFreeMass: 66.6, heartRate: 54, visceralFat: 7 },
		],
	}
}
