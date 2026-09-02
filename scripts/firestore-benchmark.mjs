/**
 * Google Sheets vs Firestore route cold-load benchmark.
 *
 * Required environment variables:
 *   GOOGLE_SERVICE_ACCOUNT_KEY
 *   FIREBASE_SERVICE_ACCOUNT_KEY
 *   SPREADSHEET_ID
 *   FIREBASE_USER_ID
 *
 * Optional:
 *   ITERATIONS=<n> (default 3)
 *   TABS=list,calendar,... (default lib/firebase-load-plan.json benchmarkRoutes)
 */

import { appendFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const FIRESTORE_API_BASE = 'https://firestore.googleapis.com/v1'
const FIRESTORE_PAGE_SIZE = 300
const AUTH_SCHEME = 'Bearer'

export const LOAD_PLAN = JSON.parse(
	readFileSync(new URL('../lib/firebase-load-plan.json', import.meta.url), 'utf8'),
)

export const DATASETS = {
	exercises: { label: 'Exercises', tab: 'Stronger - Exercises', range: 'A:J', headerRows: 1, collection: 'exercises' },
	workouts: { label: 'Workouts', tab: 'Stronger - Workouts', range: 'A:M', headerRows: 1, collection: 'workouts' },
	cardioActivities: { label: 'Cardio', tab: 'Stronger - Cardio', range: 'A:B', headerRows: 1, collection: 'cardioActivities' },
	schedule: { label: 'Workout schedule', tab: 'Stronger - Workout Schedule', range: 'A2:E10000', collection: 'schedule', entryField: 'events' },
	dayFlags: { label: 'Day flags', tab: 'Stronger - Schedule', range: 'A2:G10000', collection: 'dayFlags' },
	workoutSessions: { label: 'Workout log', tab: 'Stronger - Log', range: 'A2:M', collection: 'workoutSessions', entryField: 'entries' },
	settings: { label: 'Settings', tab: 'Stronger - Settings', range: 'A:B', headerRows: 1, collection: 'settings' },
	garminActivities: { label: 'Garmin activities', tab: 'Stronger - Garmin', range: 'A2:Q', collection: 'garminActivities', entryField: 'entries' },
	garminWellness: { label: 'Garmin wellness', tab: 'Stronger - Garmin Wellness', range: 'A2:AN', collection: 'garminWellness', entryField: 'entries' },
	withingsMeasurements: { label: 'Withings', tab: 'Stronger - Withings', range: 'A2:K', collection: 'withingsMeasurements', entryField: 'entries' },
	mealItems: { label: 'Meal items', tab: 'Stronger - Meal Items', range: 'A:J', headerRows: 1, collection: 'mealItems' },
	mealLog: { label: 'Meal log', tab: 'Stronger - Meal Log', range: 'A2:K', collection: 'mealLog' },
	favoriteFoods: { label: 'Favorite foods', tab: 'Stronger - Meal Favorites', range: 'A:J', headerRows: 1, collection: 'favoriteFoods' },
	recentFoods: { label: 'Recent foods', tab: 'Stronger - Meal Recents', range: 'A:J', headerRows: 1, collection: 'recentFoods' },
}

function validateLoadPlan() {
	const missing = LOAD_PLAN.datasetOrder.filter((name) => !(name in DATASETS))
	if (missing.length) throw new Error(`Load plan contains undefined dataset(s): ${missing.join(', ')}`)
	for (const [route, datasets] of Object.entries(LOAD_PLAN.routes)) {
		const undefinedDatasets = datasets.filter((name) => !(name in DATASETS))
		if (undefinedDatasets.length) {
			throw new Error(`Load plan route ${route} contains undefined dataset(s): ${undefinedDatasets.join(', ')}`)
		}
	}
}

validateLoadPlan()

export function parseIterations(value, defaultValue = 3) {
	const parsed = Number(String(value ?? '').trim())
	if (!Number.isFinite(parsed) || parsed < 1) return defaultValue
	return Math.min(Math.floor(parsed), 20)
}

export function selectRoutes(value) {
	const routes = String(value ?? '')
		.split(',')
		.map((name) => name.trim())
		.filter(Boolean)
	if (routes.length === 0) return [...LOAD_PLAN.benchmarkRoutes]
	const unknown = routes.filter((name) => !LOAD_PLAN.benchmarkRoutes.includes(name))
	if (unknown.length) throw new Error(`Unknown benchmark route(s): ${unknown.join(', ')}`)
	return routes
}

export function getRouteDatasets(route) {
	const datasets = LOAD_PLAN.routes[route]
	if (!datasets) throw new Error(`Unknown route: ${route}`)
	return [...datasets]
}

export function median(values) {
	if (values.length === 0) return null
	const sorted = [...values].sort((left, right) => left - right)
	const middle = Math.floor(sorted.length / 2)
	return sorted.length % 2 === 1
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2
}

export async function timed(operation) {
	const start = performance.now()
	const result = await operation()
	return { ...result, ms: performance.now() - start }
}

export function summarize(samples) {
	const measurements = samples.filter((sample) => sample.error == null)
	const durations = measurements.map((sample) => sample.ms)
	return {
		medianMs: median(durations),
		minMs: durations.length ? Math.min(...durations) : null,
		maxMs: durations.length ? Math.max(...durations) : null,
		count: measurements.at(-1)?.count ?? null,
		documents: measurements.at(-1)?.documents ?? null,
		bytes: measurements.at(-1)?.bytes ?? null,
		error: measurements.length ? null : samples.at(-1)?.error ?? 'no samples',
	}
}

function formatMs(value) {
	return value == null ? '—' : `${value.toFixed(0)} ms`
}

function formatCount(value) {
	return value == null ? '—' : String(value)
}

function formatRatio(sheets, firestore) {
	if (sheets?.medianMs == null || firestore?.medianMs == null || firestore.medianMs === 0) return '—'
	return `${(sheets.medianMs / firestore.medianMs).toFixed(2)}x`
}

function formatResult(result) {
	return result.error ? `error: ${result.error}` : formatMs(result.medianMs)
}

export function renderReport({ tabs, datasets, iterations }) {
	const lines = [
		`# Sheets vs Firestore cold-load benchmark (${iterations} iteration${iterations === 1 ? '' : 's'})`,
		'',
		'| Tab | Sheets cold load | Firestore cold load | Sheets records | Firestore documents |',
		'| --- | --- | --- | --- | --- |',
	]
	for (const tab of tabs) {
		lines.push(`| ${tab.label} | ${formatResult(tab.sheets)} | ${formatResult(tab.firestore)} | ${formatCount(tab.sheets.count)} | ${formatCount(tab.firestore.documents)} |`)
	}

	lines.push(
		'',
		'## Per-dataset detail',
		'',
		'| Dataset | Sheets median | Firestore median | Speedup | Sheets records | Firestore records | Firestore docs |',
		'| --- | --- | --- | --- | --- | --- | --- |',
	)
	for (const row of datasets) {
		lines.push(`| ${row.label} | ${formatResult(row.sheets)} | ${formatResult(row.firestore)} | ${formatRatio(row.sheets, row.firestore)} | ${formatCount(row.sheets.count)} | ${formatCount(row.firestore.count)} | ${formatCount(row.firestore.documents)} |`)
	}
	return lines.join('\n')
}

function authHeaders(token) {
	return { Authorization: `${AUTH_SCHEME} ${token}` }
}

export function countSheetRecords(values, headerRows = 0) {
	return Math.max(0, values.length - headerRows)
}

async function readSheetRange(spreadsheetId, token, dataset) {
	const target = encodeURIComponent(`'${dataset.tab}'!${dataset.range}`)
	const response = await fetch(`${SHEETS_API_BASE}/${spreadsheetId}/values/${target}`, {
		headers: authHeaders(token),
	})
	const body = await response.text()
	if (!response.ok) throw new Error(`Sheets request failed (${response.status})`)
	const data = JSON.parse(body)
	return {
		count: countSheetRecords(data.values ?? [], dataset.headerRows),
		bytes: body.length,
	}
}

export function countFirestoreRecords(documents, entryField) {
	if (!entryField) return documents.length
	return documents.reduce((total, document) => {
		const entries = document.fields?.[entryField]?.arrayValue?.values
		if (!Array.isArray(entries)) {
			throw new Error(`Firestore document ${document.name ?? '(unknown)'} is missing ${entryField}`)
		}
		const rawCount = document.fields?.count?.integerValue
		const declaredCount = rawCount == null ? null : Number(rawCount)
		if (declaredCount != null && (!Number.isInteger(declaredCount) || declaredCount !== entries.length)) {
			throw new Error(`Firestore document ${document.name ?? '(unknown)'} has an invalid count`)
		}
		return total + (declaredCount ?? entries.length)
	}, 0)
}

async function readFirestoreCollection(projectId, token, uid, collection, entryField) {
	const base = `${FIRESTORE_API_BASE}/projects/${projectId}/databases/(default)/documents`
		+ `/users/${encodeURIComponent(uid)}/${collection}`
	let pageToken = ''
	let count = 0
	let documents = 0
	let bytes = 0
	do {
		const params = new URLSearchParams({ pageSize: String(FIRESTORE_PAGE_SIZE), showMissing: 'false' })
		if (pageToken) params.set('pageToken', pageToken)
		const response = await fetch(`${base}?${params}`, {
			headers: authHeaders(token),
		})
		const body = await response.text()
		if (!response.ok) throw new Error(`Firestore request failed (${response.status})`)
		const data = JSON.parse(body)
		const pageDocuments = data.documents ?? []
		count += countFirestoreRecords(pageDocuments, entryField)
		documents += pageDocuments.length
		bytes += body.length
		pageToken = data.nextPageToken ?? ''
	} while (pageToken)
	return { count, documents, bytes }
}

async function sample(operation) {
	try {
		return await timed(operation)
	} catch (error) {
		return { error: error.message, ms: null, count: null, documents: null, bytes: null }
	}
}

export async function sampleConcurrentBatch(datasetNames, readDataset) {
	const batch = await timed(async () => ({
		entries: await Promise.all(datasetNames.map(async (name) => [
			name,
			await sample(() => readDataset(name)),
		])),
	}))
	const results = Object.fromEntries(batch.entries)
	const failures = batch.entries
		.filter(([, result]) => result.error)
		.map(([name, result]) => `${name}: ${result.error}`)
	const successes = batch.entries.filter(([, result]) => !result.error).map(([, result]) => result)
	return {
		ms: batch.ms,
		count: successes.reduce((total, result) => total + (result.count ?? 0), 0),
		documents: successes.reduce((total, result) => total + (result.documents ?? 0), 0),
		bytes: successes.reduce((total, result) => total + (result.bytes ?? 0), 0),
		error: failures.length ? failures.join('; ') : null,
		results,
	}
}

export async function runBenchmark({ iterations, routes, readSheets, readFirestore }) {
	const tabSamples = Object.fromEntries(routes.map((route) => [route, { sheets: [], firestore: [] }]))
	const selectedDatasets = [...new Set(routes.flatMap(getRouteDatasets))]
	const datasetSamples = Object.fromEntries(selectedDatasets.map((name) => [name, { sheets: [], firestore: [] }]))

	for (let iteration = 0; iteration < iterations; iteration += 1) {
		for (const route of routes) {
			const datasetNames = getRouteDatasets(route)
			const sheetsBatch = await sampleConcurrentBatch(datasetNames, readSheets)
			const firestoreBatch = await sampleConcurrentBatch(datasetNames, readFirestore)
			tabSamples[route].sheets.push(sheetsBatch)
			tabSamples[route].firestore.push(firestoreBatch)
			for (const name of datasetNames) {
				datasetSamples[name].sheets.push(sheetsBatch.results[name])
				datasetSamples[name].firestore.push(firestoreBatch.results[name])
			}
		}
	}

	return {
		iterations,
		tabs: routes.map((route) => ({
			name: route,
			label: LOAD_PLAN.labels[route] ?? route,
			datasetNames: getRouteDatasets(route),
			sheets: summarize(tabSamples[route].sheets),
			firestore: summarize(tabSamples[route].firestore),
		})),
		datasets: selectedDatasets.map((name) => ({
			name,
			label: DATASETS[name].label,
			sheets: summarize(datasetSamples[name].sheets),
			firestore: summarize(datasetSamples[name].firestore),
		})),
	}
}

async function main() {
	const { getAccessToken, parseServiceAccount, required } = await import('./firebase-migrate.mjs')
	const iterations = parseIterations(process.env.ITERATIONS)
	const routes = selectRoutes(process.env.TABS)
	const spreadsheetId = required(process.env.SPREADSHEET_ID, 'SPREADSHEET_ID')
	const uid = required(process.env.FIREBASE_USER_ID, 'FIREBASE_USER_ID')
	const googleServiceAccount = parseServiceAccount(
		required(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'GOOGLE_SERVICE_ACCOUNT_KEY'),
		'GOOGLE_SERVICE_ACCOUNT_KEY',
	)
	const firebaseServiceAccount = parseServiceAccount(
		required(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'FIREBASE_SERVICE_ACCOUNT_KEY'),
		'FIREBASE_SERVICE_ACCOUNT_KEY',
	)

	const [sheetsToken, firestoreToken] = await Promise.all([
		getAccessToken(googleServiceAccount, ['https://www.googleapis.com/auth/spreadsheets.readonly']),
		getAccessToken(firebaseServiceAccount, ['https://www.googleapis.com/auth/cloud-platform']),
	])

	console.log(`Benchmarking ${routes.length} tab(s) over ${iterations} iteration(s)...`)
	const report = await runBenchmark({
		iterations,
		routes,
		readSheets: (name) => readSheetRange(spreadsheetId, sheetsToken, DATASETS[name]),
		readFirestore: (name) => readFirestoreCollection(
			firebaseServiceAccount.project_id,
			firestoreToken,
			uid,
			DATASETS[name].collection,
			DATASETS[name].entryField,
		),
	})

	const output = renderReport(report)
	console.log(`\n${output}\n`)
	if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${output}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error('Benchmark failed:', error.message)
		process.exit(1)
	})
}
