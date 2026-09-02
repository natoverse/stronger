import assert from 'node:assert/strict'
import test from 'node:test'
import {
	buildMigrationPlan,
	decodeWeightBasis,
	groupScheduleDays,
	groupWorkoutSessions,
	parseExerciseRow,
	parseScheduleRow,
	readSheetData,
	scheduleDayDocumentId,
	workoutSessionDocumentId,
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

test('schedule rows collapse into one document per day', () => {
	const entry = parseScheduleRow(['2026-09-01', 'hiking', '', '', "Angel's Rest Trail"])
	assert.deepEqual(entry, {
		date: '2026-09-01',
		workoutId: 'hiking',
		label: "Angel's Rest Trail",
	})
	const days = groupScheduleDays([
		entry,
		{ date: '2026-09-01', workoutId: 'strength-a', strongerId: 'stronger-1' },
		{ date: '2026-09-02', workoutId: 'strength-b' },
	])
	assert.equal(days.length, 2)
	assert.equal(scheduleDayDocumentId(days[0]), '2026-09-01')
	assert.deepEqual(days[0].events, [
		{ workoutId: 'hiking', label: "Angel's Rest Trail" },
		{ workoutId: 'strength-a', strongerId: 'stronger-1' },
	])
})

test('workout session ids are deterministic and distinguish sessions', () => {
	const session = {
		date: '2026-09-01',
		startTime: '2026-09-01T12:00:00.000Z',
		workoutId: 'A',
	}
	assert.equal(workoutSessionDocumentId(session), workoutSessionDocumentId({ ...session }))
	assert.notEqual(
		workoutSessionDocumentId(session),
		workoutSessionDocumentId({ ...session, workoutId: 'B' }),
	)
	assert.match(workoutSessionDocumentId(session), /2026-09-01T12%3A00%3A00/)
})

test('workout log rows collapse into ordered session documents', () => {
	const base = {
		date: '2026-09-01',
		startTime: '2026-09-01T12:00:00.000Z',
		endTime: '2026-09-01T13:00:00.000Z',
		workoutId: 'A',
		liftId: 'bench',
		exerciseName: 'Bench Press',
		setType: 'work',
		plannedWeight: 200,
		plannedReps: 5,
		actualWeight: 205,
		actualReps: 5,
		completed: true,
	}
	const sessions = groupWorkoutSessions([
		{ ...base, setNumber: 1 },
		{ ...base, setNumber: 2, actualReps: 4 },
		{ ...base, liftId: 'row', exerciseName: 'Row', setNumber: 1 },
		{ ...base, setNumber: 1, actualWeight: 210 },
		{ ...base, startTime: '2026-09-02T12:00:00.000Z', date: '2026-09-02', setNumber: 1 },
	])

	assert.equal(sessions.length, 2)
	assert.equal(sessions[0].exercises.length, 3)
	assert.equal(sessions[0].exercises[0].sets.length, 2)
	assert.equal(sessions[0].exercises[0].sets[1].actualReps, 4)
	assert.equal(sessions[0].exercises[2].sets[0].actualWeight, 210)
	assert.equal(sessions[1].date, '2026-09-02')
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
	assert.equal(plan.schedule[0].id, '2026-09-01')
	assert.equal(plan.schedule[0].data.events[0].label, 'Heavy day')
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
	assert.equal(plan.workoutSessions[0].data.exercises[0].sets[0].actualWeight, 0)
	assert.equal('stravaActivities' in plan, false)
	assert.equal('mealItems' in plan, false)
	assert.equal('mealLog' in plan, false)
	assert.equal('favoriteFoods' in plan, false)
	assert.equal('recentFoods' in plan, false)
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

test('collection-scoped plans do not require unrelated tabs', () => {
	const rows = {
		exercises: null,
		workouts: null,
		logs: null,
		dayFlags: null,
		schedule: null,
		cardio: null,
		mealItems: null,
		mealLog: null,
		favoriteFoods: null,
		recentFoods: null,
		strava: null,
		garmin: [['2026-09-01', '42', 'running', 'Run', '3600', '', '10000', '100', '90', '140', '170']],
		garminWellness: null,
		withings: null,
		settings: null,
	}
	const { plan } = buildMigrationPlan(rows, [], ['garminActivities'])
	assert.deepEqual(Object.keys(plan), ['garminActivities'])
	assert.equal(plan.garminActivities[0].id, '42')
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

test('sheet reader skips every optional tab when only workout tabs exist', async () => {
	const originalFetch = globalThis.fetch
	globalThis.fetch = async (url) => {
		const requestUrl = String(url)
		const body = requestUrl.includes('fields=sheets.properties.title')
			? {
				sheets: [
					{ properties: { title: 'Stronger - Exercises' } },
					{ properties: { title: 'Stronger - Workouts' } },
				],
			}
			: requestUrl.includes('Exercises')
				? {
					values: [
						['id', 'name', 'topSetWeight', 'backoffWeight', 'increment', 'minimumWeight', 'roundingFactor'],
						['bench', 'Bench', '100', '80', '5', '45', '5'],
					],
				}
				: {
					values: [
						['workoutId', 'workoutName', 'exerciseOrder', 'exerciseRole', 'liftId', 'setType', 'percentage', 'weightBasis', 'minReps', 'maxReps', 'amrap'],
						['A', 'A', '1', 'primary', 'bench', 'work', '1', 'topSet', '5', '5', 'FALSE'],
					],
				}
		return {
			ok: true,
			status: 200,
			json: async () => body,
			text: async () => JSON.stringify(body),
		}
	}

	try {
		const { rows, warnings } = await readSheetData('sheet-id', 'token')
		const { plan } = buildMigrationPlan(rows, warnings)

		assert.deepEqual(Object.keys(plan), ['exercises', 'workouts'])
		assert.ok(warnings.some((warning) => warning.includes('Stronger - Garmin is missing')))
		assert.ok(!warnings.some((warning) => warning.includes('Stronger - Meal Log')))
		assert.ok(!warnings.some((warning) => warning.includes('Stronger - Strava')))
	} finally {
		globalThis.fetch = originalFetch
	}
})
