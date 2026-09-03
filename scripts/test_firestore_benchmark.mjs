import assert from 'node:assert/strict'
import test from 'node:test'
import {
	DATASETS,
	LOAD_PLAN,
	addDays,
	countFirestoreRecords,
	countSheetRecords,
	firestoreReadScope,
	getRouteDatasets,
	median,
	parseIterations,
	renderReport,
	runBenchmark,
	selectRoutes,
	summarize,
} from './firestore-benchmark.mjs'

test('dataset catalog covers the shared load plan', () => {
	assert.deepEqual(Object.keys(DATASETS), LOAD_PLAN.datasetOrder)
	assert.deepEqual(DATASETS.mealItems, {
		label: 'Meal items',
		tab: 'Stronger - Meal Items',
		range: 'A:J',
		headerRows: 1,
		collection: 'mealItems',
	})
	assert.equal(DATASETS.mealLog.range, 'A2:K')
	assert.equal(DATASETS.mealLog.headerRows, undefined)
	assert.equal(DATASETS.favoriteFoods.collection, 'favoriteFoods')
	assert.equal(DATASETS.favoriteFoods.headerRows, 1)
	assert.equal(DATASETS.recentFoods.tab, 'Stronger - Meal Recents')
	assert.equal(DATASETS.exercises.headerRows, 1)
	assert.equal(DATASETS.schedule.headerRows, undefined)
	assert.equal(DATASETS.workoutSessions.entryField, 'entries')
	assert.equal(DATASETS.schedule.entryField, 'events')
	assert.equal(DATASETS.garminWellness.entryField, 'entries')
	assert.deepEqual(LOAD_PLAN.yearBucketDatasets, [
		'workoutSessions',
		'garminActivities',
		'garminWellness',
		'withingsMeasurements',
	])
	assert.deepEqual(LOAD_PLAN.dateWindowDatasets, ['schedule', 'dayFlags'])
	assert.equal(LOAD_PLAN.initialDateWindowDays, 60)
	assert.equal(LOAD_PLAN.initialDateWindowAnchor, 'monthStart')
	assert.equal(LOAD_PLAN.dateWindowIncrementDays, 30)
	assert.equal(LOAD_PLAN.benchmarkRoutes.includes('nutrition'), false)
})

test('cold loads target current buckets and the initial schedule window', () => {
	assert.equal(firestoreReadScope('workoutSessions'), 'currentYear')
	assert.equal(firestoreReadScope('garminActivities'), 'currentYear')
	assert.equal(firestoreReadScope('garminWellness'), 'currentYear')
	assert.equal(firestoreReadScope('withingsMeasurements'), 'currentYear')
	assert.equal(firestoreReadScope('schedule'), 'initialWindow')
	assert.equal(firestoreReadScope('dayFlags'), 'initialWindow')
	assert.equal(firestoreReadScope('exercises'), 'all')
})

test('date windows use calendar-day boundaries', () => {
	assert.equal(addDays('2026-09-02', 60), '2026-11-01')
	assert.equal(addDays('2026-12-15', 30), '2027-01-14')
	assert.equal(addDays('2028-02-01', 29), '2028-03-01')
})

test('Garmin activities and calendar use the exact shared route datasets', () => {
	assert.deepEqual(getRouteDatasets('garmin-activities'), ['garminActivities', 'settings'])
	assert.equal(getRouteDatasets('garmin-activities')[0], 'garminActivities')
	assert.deepEqual(getRouteDatasets('calendar'), [
		'schedule',
		'dayFlags',
		'workoutSessions',
		'exercises',
		'workouts',
		'cardioActivities',
		'settings',
	])
})

test('iteration count is clamped to a sane range', () => {
	assert.equal(parseIterations(undefined), 3)
	assert.equal(parseIterations(''), 3)
	assert.equal(parseIterations('0'), 3)
	assert.equal(parseIterations('abc'), 3)
	assert.equal(parseIterations('5'), 5)
	assert.equal(parseIterations('500'), 20)
})

test('route selection defaults to benchmark tabs and rejects unknown routes', () => {
	assert.deepEqual(selectRoutes(''), LOAD_PLAN.benchmarkRoutes)
	assert.deepEqual(selectRoutes('calendar, garmin-activities'), ['calendar', 'garmin-activities'])
	assert.throws(() => selectRoutes('calendar,bogus'), /Unknown benchmark route\(s\): bogus/)
})

test('median handles odd and even sample counts', () => {
	assert.equal(median([]), null)
	assert.equal(median([5, 1, 3]), 3)
	assert.equal(median([4, 2]), 3)
})

test('summaries ignore failed samples and report the failure when all fail', () => {
	assert.deepEqual(
		summarize([
			{ ms: 10, count: 2, documents: 1, bytes: 20 },
			{ ms: 30, count: 2, documents: 1, bytes: 20 },
			{ error: 'boom', ms: null, count: null, documents: null, bytes: null },
		]),
		{ medianMs: 20, minMs: 10, maxMs: 30, count: 2, documents: 1, bytes: 20, error: null },
	)
	assert.equal(
		summarize([{ error: 'missing collection', ms: null, count: null, documents: null, bytes: null }]).error,
		'missing collection',
	)
})

test('Firestore record counts expand bucket and schedule arrays', () => {
	assert.equal(countFirestoreRecords([
		{
			name: 'workoutSessions/2025',
			fields: {
				count: { integerValue: '2' },
				entries: { arrayValue: { values: [{ mapValue: {} }, { mapValue: {} }] } },
			},
		},
		{
			name: 'workoutSessions/2026',
			fields: {
				count: { integerValue: '1' },
				entries: { arrayValue: { values: [{ mapValue: {} }] } },
			},
		},
	], 'entries'), 3)
	assert.equal(countFirestoreRecords([{
		name: 'schedule/2026-09-02',
		fields: {
			events: { arrayValue: { values: [{ mapValue: {} }, { mapValue: {} }] } },
		},
	}], 'events'), 2)
	assert.equal(countFirestoreRecords([{ fields: {} }, { fields: {} }]), 2)
	assert.throws(
		() => countFirestoreRecords([{ name: 'garminWellness/2026', fields: {} }], 'entries'),
		/missing entries/,
	)
	assert.throws(
		() => countFirestoreRecords([{
			name: 'garminActivities/2026',
			fields: {
				count: { integerValue: '3' },
				entries: { arrayValue: { values: [{ mapValue: {} }] } },
			},
		}], 'entries'),
		/invalid count/,
	)
})

test('Sheets record counts exclude configured header rows', () => {
	assert.equal(countSheetRecords([['id'], ['one'], ['two']], 1), 2)
	assert.equal(countSheetRecords([['one'], ['two']]), 2)
	assert.equal(countSheetRecords([], 1), 0)
	assert.equal(countSheetRecords([['id']], 1), 0)
})

function concurrentReader(expectedNames, backend, calls) {
	const started = new Set()
	return async (name) => {
		calls.push(`${backend}:start:${name}`)
		started.add(name)
		await Promise.resolve()
		assert.deepEqual([...started], expectedNames)
		calls.push(`${backend}:end:${name}`)
		return backend === 'sheets' ? { count: 2 } : { count: 2, documents: 1 }
	}
}

test('each tab times one concurrent batch per backend with identical datasets', async () => {
	const expected = getRouteDatasets('calendar')
	const calls = []
	const report = await runBenchmark({
		iterations: 1,
		routes: ['calendar'],
		readSheets: concurrentReader(expected, 'sheets', calls),
		readFirestore: concurrentReader(expected, 'firestore', calls),
	})

	assert.deepEqual(calls.slice(0, expected.length), expected.map((name) => `sheets:start:${name}`))
	const firestoreStart = calls.indexOf(`firestore:start:${expected[0]}`)
	assert.ok(calls.slice(0, firestoreStart).every((call) => call.startsWith('sheets:')))
	assert.deepEqual(
		calls.slice(firestoreStart, firestoreStart + expected.length),
		expected.map((name) => `firestore:start:${name}`),
	)
	assert.deepEqual(report.tabs[0].datasetNames, expected)
	assert.equal(report.tabs[0].sheets.count, expected.length * 2)
	assert.equal(report.tabs[0].firestore.count, expected.length * 2)
	assert.equal(report.tabs[0].firestore.documents, expected.length)
})

test('report renders one comparison row for every tab', () => {
	const output = renderReport({
		iterations: 3,
		tabs: [{
			label: 'Calendar',
			datasetNames: ['schedule', 'dayFlags'],
			sheets: { medianMs: 400, count: 20, error: null },
			firestore: { medianMs: 100, count: 20, documents: 2, error: null },
		}],
		datasets: [{
			label: 'Workout schedule',
			sheets: { medianMs: 300, count: 10, error: null },
			firestore: { medianMs: 75, count: 10, documents: 1, error: null },
		}],
	})

	assert.match(output, /3 iterations/)
	assert.match(output, /Firestore cold loads read only the \d{4} document for yearly datasets and/)
	assert.match(output, /for schedule data; Sheets retains its current full-range read/)
	assert.match(output, /\| Tab \| Sheets cold load \| Firestore cold load \| Sheets records \| Firestore documents \|/)
	assert.match(output, /\| Calendar \| 400 ms \| 100 ms \| 20 \| 2 \|/)
	assert.doesNotMatch(output, /\| Calendar \| Sheets \|/)
	assert.match(output, /## Per-dataset detail/)
	assert.match(output, /\| Dataset \| Sheets median \| Firestore median \| Speedup \| Sheets records \|/)
	assert.match(output, /\| Workout schedule \| 300 ms \| 75 ms \| 4\.00x \| 10 \| 10 \| 1 \|/)
})
