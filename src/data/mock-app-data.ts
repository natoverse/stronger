import type {
	AppSettings,
	CardioActivity,
	DayFlagEntry,
	GarminWellnessEntry,
	LiftConfig,
	Workout,
	WorkoutScheduleEntry,
	WithingsMeasurement,
} from '../model/index.js'
import type { StravaActivity, StravaGoal } from '../model/strava.js'
import type { WithingsGoal } from '../model/withings.js'
import type { LiftGoal, ParsedLogRow } from '../google/index.js'
import { DEFAULT_APP_SETTINGS } from '../google/index.js'
import {
	buildWorkoutsFromConfigs,
	type WorkoutDefinition,
} from './sample-workouts.js'

export interface MockAppData {
	configs: LiftConfig[]
	workoutDefinitions: WorkoutDefinition[]
	workouts: Workout[]
	workoutSchedule: WorkoutScheduleEntry[]
	dayFlags: DayFlagEntry[]
	logRows: ParsedLogRow[]
	cardioActivities: CardioActivity[]
	garminActivities: StravaActivity[]
	garminWellness: GarminWellnessEntry[]
	withingsMeasurements: WithingsMeasurement[]
	stravaGoals: StravaGoal[]
	withingsGoals: WithingsGoal[]
	liftGoals: LiftGoal[]
	appSettings: AppSettings
}

function localDateOffset(offset: number, anchor = new Date()): string {
	const value = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + offset)
	return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function wellnessEntry(date: string, index: number): GarminWellnessEntry {
	return {
		date,
		hrvWeeklyAvg: 48 + index,
		hrvStatus: index < 2 ? 'UNBALANCED' : 'BALANCED',
		sleepDurationSec: (7 * 60 + 10 + index * 4) * 60,
		sleepDeepSec: 72 * 60,
		sleepLightSec: 250 * 60,
		sleepRemSec: 105 * 60,
		sleepAwakeSec: 24 * 60,
		sleepScore: 78 + index,
		bodyBatteryHigh: 72 + index * 3,
		bodyBatteryLow: 18 + index,
		readinessScore: 62 + index * 4,
		trainingStatus: index < 3 ? 'MAINTAINING' : 'PRODUCTIVE',
		trainingAcuteLoad: 430 + index * 12,
		trainingChronicLoad: 405 + index * 7,
		steps: 7200 + index * 650,
		floors: 6 + index,
		restingHR: 54 - Math.floor(index / 3),
		vo2Max: 47.2 + index * 0.1,
		intensityMinModerate: 18 + index * 2,
		intensityMinVigorous: index % 2 === 0 ? 12 : 5,
		hillScore: 58 + index,
		enduranceScore: 6100 + index * 25,
		heatAcclimationPct: 42 + index * 3,
		altitudeAcclimationPct: 900,
		currentAltitude: 120,
		activeCalories: 480 + index * 35,
		bmrCalories: 1880,
		avgStress: 31 - index,
		loadFocusAerobicLow: 280 + index * 5,
		loadFocusAerobicLowMin: 240,
		loadFocusAerobicLowMax: 360,
		loadFocusAerobicHigh: 190 + index * 8,
		loadFocusAerobicHighMin: 160,
		loadFocusAerobicHighMax: 270,
		loadFocusAnaerobic: 95 + index * 4,
		loadFocusAnaerobicMin: 80,
		loadFocusAnaerobicMax: 150,
		hrvBaselineMin: 45,
		hrvBaselineMax: 58,
	}
}

export function createMockAppData(anchor = new Date()): MockAppData {
	const configs: LiftConfig[] = [
		{
			id: 'bench-press',
			name: 'Bench Press',
			topSetWeight: 205,
			backoffWeight: 175,
			increment: 2.5,
			minimumWeight: 95,
			roundingFactor: 5,
			warmupRoundingFactor: 5,
			barWeight: 45,
			gear: 'barbell',
		},
		{
			id: 'squat',
			name: 'Squat',
			topSetWeight: 305,
			backoffWeight: 260,
			increment: 5,
			minimumWeight: 95,
			roundingFactor: 5,
			warmupRoundingFactor: 5,
			barWeight: 45,
			gear: 'barbell',
		},
		{
			id: 'overhead-press',
			name: 'Overhead Press',
			topSetWeight: 140,
			backoffWeight: 120,
			increment: 2.5,
			minimumWeight: 65,
			roundingFactor: 2.5,
			warmupRoundingFactor: 5,
			barWeight: 45,
			gear: 'barbell',
		},
		{
			id: 'deadlift',
			name: 'Deadlift',
			topSetWeight: 365,
			backoffWeight: 315,
			increment: 5,
			minimumWeight: 135,
			roundingFactor: 5,
			warmupRoundingFactor: 5,
			barWeight: 45,
			gear: 'barbell',
		},
	]

	const workSets = (liftId: string, name: string) => ({
		liftId,
		name,
		role: 'primary' as const,
		sets: [
			{
				setType: 'warmup' as const,
				percentage: 0.5,
				weightBasis: { kind: 'topSet' as const },
				minReps: 5,
				maxReps: 5,
				amrap: false,
			},
			{
				setType: 'work' as const,
				percentage: 1,
				weightBasis: { kind: 'topSet' as const },
				minReps: 3,
				maxReps: 5,
				amrap: false,
				comment: 'Add weight after five clean reps.',
			},
			{
				setType: 'backoff' as const,
				percentage: 1,
				weightBasis: { kind: 'backoff' as const },
				minReps: 6,
				maxReps: 8,
				amrap: true,
			},
		],
	})

	const workoutDefinitions: WorkoutDefinition[] = [
		{
			id: 'mock-upper',
			name: 'Upper Strength',
			favorite: true,
			templates: [
				workSets('bench-press', 'Bench Press'),
				{ ...workSets('overhead-press', 'Overhead Press'), role: 'secondary' },
			],
		},
		{
			id: 'mock-lower',
			name: 'Lower Strength',
			favorite: true,
			templates: [
				workSets('squat', 'Squat'),
				{ ...workSets('deadlift', 'Deadlift'), role: 'secondary' },
			],
		},
	]

	const today = localDateOffset(0, anchor)
	const yesterday = localDateOffset(-1, anchor)
	const twoDaysAgo = localDateOffset(-2, anchor)
	const threeDaysAgo = localDateOffset(-3, anchor)
	const tomorrow = localDateOffset(1, anchor)
	const workouts = buildWorkoutsFromConfigs(configs, workoutDefinitions)
	const cardioActivities: CardioActivity[] = [
		{ id: 'run', name: 'Run' },
		{ id: 'hike', name: 'Hike' },
		{ id: 'bike', name: 'Bike' },
	]

	return {
		configs,
		workoutDefinitions,
		workouts,
		cardioActivities,
		workoutSchedule: [
			{ date: today, workoutId: 'blocker', label: 'Morning appointment' },
			{ date: today, workoutId: 'cardio:run', label: 'Easy neighborhood run' },
			{ date: today, workoutId: 'mock-upper', strongerId: 'mock-schedule-upper' },
			{ date: tomorrow, workoutId: 'mock-lower', strongerId: 'mock-schedule-lower' },
			{ date: localDateOffset(2, anchor), workoutId: 'rest' },
		],
		dayFlags: [
			{
				date: today,
				flags: {
					home: true,
					elsewhere: false,
					travel: false,
					visitors: false,
					alcohol: false,
					blocked: false,
				},
			},
			{
				date: tomorrow,
				flags: {
					home: false,
					elsewhere: false,
					travel: true,
					visitors: false,
					alcohol: false,
					blocked: false,
				},
			},
		],
		logRows: [
			{
				date: today,
				startTime: '07:00',
				endTime: '07:45',
				workoutId: 'mock-upper',
				exerciseName: 'Bench Press',
				liftId: 'bench-press',
				setNumber: 1,
				setType: 'work',
				plannedWeight: 205,
				plannedReps: 5,
				actualWeight: 205,
				actualReps: 5,
				completed: true,
			},
			{
				date: threeDaysAgo,
				startTime: '17:30',
				endTime: '18:20',
				workoutId: 'mock-lower',
				exerciseName: 'Squat',
				liftId: 'squat',
				setNumber: 1,
				setType: 'work',
				plannedWeight: 300,
				plannedReps: 5,
				actualWeight: 300,
				actualReps: 5,
				completed: true,
			},
			{
				date: localDateOffset(-10, anchor),
				startTime: '17:30',
				endTime: '18:15',
				workoutId: 'mock-lower',
				exerciseName: 'Squat',
				liftId: 'squat',
				setNumber: 1,
				setType: 'work',
				plannedWeight: 295,
				plannedReps: 5,
				actualWeight: 295,
				actualReps: 5,
				completed: true,
			},
		],
		garminActivities: [
			{
				date: yesterday,
				stravaId: 'mock-run',
				activityType: 'Run',
				name: 'River Trail Run',
				duration: 2580,
				distance: 7200,
				elevationGain: 135,
				elevationLoss: 132,
				calories: 610,
			},
			{
				date: twoDaysAgo,
				stravaId: 'mock-bike',
				activityType: 'Cycling',
				name: 'Lunch Ride',
				duration: 4100,
				distance: 28500,
				elevationGain: 420,
				elevationLoss: 416,
				calories: 820,
			},
			{
				date: localDateOffset(-6, anchor),
				stravaId: 'mock-hike',
				activityType: 'Hiking',
				name: 'Ridge Hike',
				duration: 7200,
				distance: 10800,
				elevationGain: 760,
				elevationLoss: 755,
				calories: 1040,
			},
		],
		garminWellness: Array.from({ length: 7 }, (_, index) =>
			wellnessEntry(localDateOffset(index - 6, anchor), index)),
		withingsMeasurements: Array.from({ length: 7 }, (_, index) => ({
			date: localDateOffset(index - 6, anchor),
			grpId: `mock-weight-${index}`,
			weight: 83.8 - index * 0.15,
			fatMass: 15.9 - index * 0.08,
			fatRatio: 19 - index * 0.08,
			muscleMass: 64.1 + index * 0.05,
			boneMass: 3.35,
			hydration: 45.7 + index * 0.04,
			fatFreeMass: 67.9 + index * 0.02,
			heartRate: 57 - Math.floor(index / 3),
			visceralFat: 4.2 - index * 0.05,
		})),
		stravaGoals: [
			{ metric: 'distance', value: 500 },
			{ metric: 'elevationGain', value: 60_000 },
			{ metric: 'duration', value: 120 },
		],
		withingsGoals: [
			{ metric: 'weight', value: 180 },
			{ metric: 'fatRatio', value: 17 },
		],
		liftGoals: [
			{ liftId: 'bench-press', weight: 250 },
			{ liftId: 'squat', weight: 365 },
		],
		appSettings: {
			...DEFAULT_APP_SETTINGS,
			showCalendarTab: true,
			showGarminTab: true,
			garminDailyStepsGoal: 10_000,
			garminDailyFloorsGoal: 10,
			garminDailySleepHoursGoal: 8,
			garminWeeklyIntensityMinGoal: 150,
		},
	}
}
