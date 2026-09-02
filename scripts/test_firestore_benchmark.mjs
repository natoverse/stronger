import assert from 'node:assert/strict'
import test from 'node:test'
import {
	DATASETS,
	countFirestoreRecords,
	median,
	parseIterations,
	renderReport,
	runBenchmark,
	selectDatasets,
	summarize,
} from './firestore-benchmark.mjs'

test('dataset catalog covers the tabs the application loads', () => {
	assert.deepEqual(Object.keys(DATASETS), [
		'exercises',
		'workouts',
		'workoutSessions',
		'dayFlags',
		'schedule',
		'cardioActivities',
		'garminActivities',
		'garminWellness',
		'withingsMeasurements',
		'settings',
	])
	assert.equal(DATASETS.workoutSessions.tab, 'Stronger - Log')
	assert.equal(DATASETS.workoutSessions.range, 'A2:M')
	assert.equal(DATASETS.workoutSessions.entryField, 'entries')
	assert.equal(DATASETS.schedule.entryField, 'events')
	assert.equal(DATASETS.garminWellness.range, 'A2:AN')
	assert.equal(DATASETS.garminWellness.entryField, 'entries')
})

test('iteration count is clamped to a sane range', () => {
	assert.equal(parseIterations(undefined), 3)
	assert.equal(parseIterations(''), 3)
	assert.equal(parseIterations('0'), 3)
	assert.equal(parseIterations('abc'), 3)
	assert.equal(parseIterations('5'), 5)
	assert.equal(parseIterations('500'), 20)
})

test('dataset selection defaults to everything and rejects unknown names', () => {
	assert.deepEqual(selectDatasets(''), Object.keys(DATASETS))
	assert.deepEqual(selectDatasets('workouts, schedule'), ['workouts', 'schedule'])
	assert.throws(() => selectDatasets('workouts,bogus'), /Unknown dataset\(s\): bogus/)
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
	const failed = summarize([{ error: 'missing collection', ms: null, count: null, documents: null, bytes: null }])
	assert.equal(failed.medianMs, null)
	assert.equal(failed.error, 'missing collection')
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
	assert.equal(countFirestoreRecords([
		{
			name: 'schedule/2026-09-02',
			fields: {
				events: { arrayValue: { values: [{ mapValue: {} }, { mapValue: {} }] } },
			},
		},
	], 'events'), 2)
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

test('benchmark runs every dataset once per iteration and totals each backend', async () => {
	const calls = { sheets: [], firestore: [] }
	const report = await runBenchmark({
		iterations: 2,
		datasets: ['exercises', 'workouts'],
		readSheets: async (name) => {
			calls.sheets.push(name)
			return { count: 3 }
		},
		readFirestore: async (name) => {
			calls.firestore.push(name)
			if (name === 'workouts') throw new Error('collection missing')
			return { count: 4, documents: 1 }
		},
	})

	assert.deepEqual(calls.sheets, ['exercises', 'workouts', 'exercises', 'workouts'])
	assert.deepEqual(calls.firestore, ['exercises', 'workouts', 'exercises', 'workouts'])
	assert.equal(report.rows.length, 2)
	assert.equal(report.rows[0].sheets.count, 3)
	assert.equal(report.rows[0].firestore.count, 4)
	assert.equal(report.rows[0].firestore.documents, 1)
	assert.equal(report.rows[1].firestore.error, 'collection missing')
	assert.equal(report.totals.sheets.count, 6)
	assert.equal(report.totals.firestore.count, 4)
	assert.equal(report.totals.firestore.documents, 1)
	assert.ok(report.totals.sheets.medianMs >= 0)
})

test('report renders a side-by-side table with a full-load row', () => {
	const output = renderReport({
		iterations: 3,
		rows: [
			{
				label: 'Exercises',
				sheets: { medianMs: 400, count: 20, error: null },
				firestore: { medianMs: 100, count: 20, documents: 2, error: null },
			},
			{
				label: 'Workouts',
				sheets: { medianMs: 300, count: 50, error: null },
				firestore: { medianMs: null, count: null, documents: null, error: 'collection missing' },
			},
		],
		totals: {
			sheets: { medianMs: 700, count: 70, error: null },
			firestore: { medianMs: 100, count: 20, documents: 2, error: null },
		},
	})

	assert.match(output, /3 iterations/)
	assert.match(output, /\| Exercises \| 400 ms \| 100 ms \| 4\.00x \| 20 \| 20 \| 2 \|/)
	assert.match(output, /\| Workouts \| 300 ms \| error: collection missing \| — \| 50 \| — \| — \|/)
	assert.match(output, /\*\*Full load \(all datasets\)\*\* \| 700 ms \| 100 ms \| 7\.00x \| 70 \| 20 \| 2 \|/)
})
