import assert from 'node:assert/strict'
import test from 'node:test'
import {
	buildMigrationPlan,
	decodeWeightBasis,
	logDocumentId,
	parseExerciseRow,
	parseScheduleRow,
	scheduleDocumentId,
} from './firebase-migrate.mjs'

test('exercise parser preserves current fields and legacy warmup default', () => {
	assert.deepEqual(
		parseExerciseRow(['squat', 'Squat', '300', '250', '5', '45', '5', '45', 'barbell', '2.5']),
		{
			id: 'squat',
			name: 'Squat',
			topSetWeight: 300,
			backoffWeight: 250,
			increment: 5,
			minimumWeight: 45,
			roundingFactor: 5,
			warmupRoundingFactor: 2.5,
			barWeight: 45,
			gear: 'barbell',
		},
	)
	assert.equal(
		parseExerciseRow(['row', 'Row', '100', '90', '5', '0', '5', '0', 'other']).warmupRoundingFactor,
		5,
	)
})

test('workout weight bases match the application model', () => {
	assert.deepEqual(decodeWeightBasis('barWeight'), { kind: 'barWeight' })
	assert.deepEqual(decodeWeightBasis('relative:backoff:-20'), {
		kind: 'relative',
		reference: 'backoff',
		offset: -20,
	})
	assert.deepEqual(decodeWeightBasis('crossReference:bench'), {
		kind: 'crossReference',
		liftId: 'bench',
	})
})

test('schedule parser and id retain custom labels', () => {
	const entry = parseScheduleRow(['2026-09-01', 'hiking', '', '', "Angel's Rest Trail"])
	assert.deepEqual(entry, {
		date: '2026-09-01',
		workoutId: 'hiking',
		label: "Angel's Rest Trail",
	})
	assert.match(scheduleDocumentId(entry), /Angel's%20Rest%20Trail/)
	assert.notEqual(
		scheduleDocumentId(entry),
		scheduleDocumentId({ ...entry, workoutId: 'strength-a' }),
	)
})

test('log ids are deterministic and distinguish exercises', () => {
	const row = {
		startTime: '2026-09-01T12:00:00.000Z',
		liftId: 'bench.press',
		exerciseName: 'Bench Press',
		setNumber: 1,
	}
	assert.equal(logDocumentId(row), logDocumentId({ ...row }))
	assert.notEqual(logDocumentId(row), logDocumentId({ ...row, exerciseName: 'Close Grip Bench' }))
	assert.match(logDocumentId(row), /bench%2Epress/)
	assert.notEqual(
		logDocumentId({ ...row, _migrationSourceRow: 2 }),
		logDocumentId({ ...row, _migrationSourceRow: 3 }),
	)
})

test('migration plan groups workout rows and reports invalid rows', () => {
	const emptyRows = {
		exercises: [
			['id', 'name', 'topSetWeight', 'backoffWeight', 'increment', 'minimumWeight', 'roundingFactor', 'barWeight', 'gear', 'warmupRoundingFactor'],
			['bench', 'Bench Press', '225', '185', '5', '45', '5', '45', 'barbell', '5'],
		],
		workouts: [
			['workoutId', 'workoutName', 'exerciseOrder', 'exerciseRole', 'liftId', 'setType', 'percentage', 'weightBasis', 'minReps', 'maxReps', 'amrap', 'comment', 'favorite'],
			['A', 'Workout A', '1', 'primary', 'bench', 'work', '1', 'topSet', '5', '5', 'TRUE', 'Top set', 'TRUE'],
			['A', 'Workout A', '1', 'primary', 'bench', 'backoff', '0.8', 'backoff', '8', '10', 'FALSE', '', 'TRUE'],
			['broken'],
		],
		logs: [],
		dayFlags: [],
		schedule: [['2026-09-01', 'A', '', 'stronger-1', 'Heavy day']],
		cardio: [],
		mealItems: [],
		mealLog: [],
		favoriteFoods: [],
		recentFoods: [],
		strava: [],
		garmin: [],
		garminWellness: [],
		withings: [],
		settings: [['key', 'value'], ['roundWarmupPlateMath', 'true']],
	}
	const { plan, warnings } = buildMigrationPlan(emptyRows)
	assert.equal(plan.exercises[0].data.warmupRoundingFactor, 5)
	assert.equal(plan.workouts[0].data.templates[0].name, 'Bench Press')
	assert.equal(plan.workouts[0].data.templates[0].sets.length, 2)
	assert.equal(plan.workouts[0].data.favorite, true)
	assert.equal(plan.schedule[0].data.label, 'Heavy day')
	assert.deepEqual(plan.settings[0].data.values, { roundWarmupPlateMath: 'true' })
	assert.ok(warnings.some((warning) => warning.includes('Workouts: skipped 1 invalid row')))
})

test('migration plan rejects empty required tabs', () => {
	const rows = {
		exercises: [['id', 'name']],
		workouts: [['workoutId', 'workoutName']],
		logs: [],
		dayFlags: [],
		schedule: [],
		cardio: [],
		mealItems: [],
		mealLog: [],
		favoriteFoods: [],
		recentFoods: [],
		strava: [],
		garmin: [],
		garminWellness: [],
		withings: [],
		settings: [],
	}
	assert.throws(() => buildMigrationPlan(rows), /Exercises contains no valid data rows/)
})

test('blank sheet numeric cells follow current parser defaults', () => {
	const rows = {
		exercises: [
			['id', 'name', 'topSetWeight', 'backoffWeight', 'increment', 'minimumWeight', 'roundingFactor'],
			['bench', 'Bench', '100', '80', '5', '45', '5'],
		],
		workouts: [
			['workoutId', 'workoutName', 'exerciseOrder', 'exerciseRole', 'liftId', 'setType', 'percentage', 'weightBasis', 'minReps', 'maxReps', 'amrap'],
			['A', 'A', '1', 'primary', 'bench', 'work', '1', 'topSet', '5', '5', 'FALSE'],
		],
		logs: [['2026-09-01', 'start', '', 'A', 'Bench', 'bench', '1', 'work', '', '', '', '', 'FALSE']],
		dayFlags: [],
		schedule: [],
		cardio: [],
		mealItems: [],
		mealLog: [],
		favoriteFoods: [],
		recentFoods: [],
		strava: [['2026-09-01', '1', 'Run', 'Run', '', '', '', '', '', '']],
		garmin: [],
		garminWellness: [],
		withings: [],
		settings: [],
	}
	const { plan } = buildMigrationPlan(rows)
	assert.equal(plan.workoutSessions[0].data.actualWeight, 0)
	assert.equal(plan.stravaActivities[0].data.duration, 0)
})

test('missing optional tabs are excluded instead of cleared', () => {
	const rows = {
		exercises: [
			['id', 'name', 'topSetWeight', 'backoffWeight', 'increment', 'minimumWeight', 'roundingFactor'],
			['bench', 'Bench', '100', '80', '5', '45', '5'],
		],
		workouts: [
			['workoutId', 'workoutName', 'exerciseOrder', 'exerciseRole', 'liftId', 'setType', 'percentage', 'weightBasis', 'minReps', 'maxReps', 'amrap'],
			['A', 'A', '1', 'primary', 'bench', 'work', '1', 'topSet', '5', '5', 'FALSE'],
		],
		logs: null,
		dayFlags: null,
		schedule: null,
		cardio: null,
		mealItems: null,
		mealLog: null,
		favoriteFoods: null,
		recentFoods: null,
		strava: null,
		garmin: null,
		garminWellness: null,
		withings: null,
		settings: null,
	}
	const { plan } = buildMigrationPlan(rows)
	assert.deepEqual(Object.keys(plan), ['exercises', 'workouts'])
})

test('date-keyed collections keep the last row for duplicate dates', () => {
	const rows = {
		exercises: [
			['id', 'name', 'topSetWeight', 'backoffWeight', 'increment', 'minimumWeight', 'roundingFactor'],
			['bench', 'Bench', '100', '80', '5', '45', '5'],
		],
		workouts: [
			['workoutId', 'workoutName', 'exerciseOrder', 'exerciseRole', 'liftId', 'setType', 'percentage', 'weightBasis', 'minReps', 'maxReps', 'amrap'],
			['A', 'A', '1', 'primary', 'bench', 'work', '1', 'topSet', '5', '5', 'FALSE'],
		],
		logs: [],
		dayFlags: [
			['2026-08-17', 'TRUE', '', '', '', '', ''],
			['2026-08-17', '', 'TRUE', '', '', '', ''],
		],
		schedule: [],
		cardio: [],
		mealItems: [],
		mealLog: [],
		favoriteFoods: [],
		recentFoods: [],
		strava: [],
		garmin: [],
		garminWellness: [
			['2026-08-17', '40', 'LOW'],
			['2026-08-17', '50', 'BALANCED'],
		],
		withings: [],
		settings: [],
	}

	const { plan, warnings } = buildMigrationPlan(rows)

	assert.equal(plan.dayFlags.length, 1)
	assert.deepEqual(plan.dayFlags[0].data.flags, {
		home: false,
		elsewhere: true,
		travel: false,
		visitors: false,
		alcohol: false,
		blocked: false,
	})
	assert.equal(plan.garminWellness.length, 1)
	assert.equal(plan.garminWellness[0].data.hrvWeeklyAvg, 50)
	assert.ok(warnings.some((warning) => warning.startsWith('Day flags: collapsed 1 duplicate row')))
	assert.ok(warnings.some((warning) => warning.startsWith('Garmin wellness: collapsed 1 duplicate row')))
})
