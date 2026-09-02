/**
 * Google Sheets vs Firestore read benchmark.
 *
 * Replicates the reads the application performs when it loads (exercises,
 * workouts, workout log, schedules, cardio, Garmin, Withings, settings) against
 * both backends and prints their response times side by side.
 *
 * Required environment variables:
 *   GOOGLE_SERVICE_ACCOUNT_KEY
 *   FIREBASE_SERVICE_ACCOUNT_KEY
 *   SPREADSHEET_ID
 *   FIREBASE_USER_ID
 *
 * Optional:
 *   ITERATIONS=<n> (default 3)
 *   DATASETS=exercises,workouts,... (default all)
 */

import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { getAccessToken, parseServiceAccount, required } from './firebase-migrate.mjs'

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const FIRESTORE_API_BASE = 'https://firestore.googleapis.com/v1'
const FIRESTORE_PAGE_SIZE = 300
const AUTH_SCHEME = 'Bearer'

export const DATASETS = {
	exercises: { label: 'Exercises', tab: 'Stronger - Exercises', range: 'A:J', collection: 'exercises' },
	workouts: { label: 'Workouts', tab: 'Stronger - Workouts', range: 'A:M', collection: 'workouts' },
	workoutSessions: { label: 'Workout log', tab: 'Stronger - Log', range: 'A2:M', collection: 'workoutSessions', entryField: 'entries' },
	dayFlags: { label: 'Day flags', tab: 'Stronger - Schedule', range: 'A2:G10000', collection: 'dayFlags' },
	schedule: { label: 'Workout schedule', tab: 'Stronger - Workout Schedule', range: 'A2:E10000', collection: 'schedule', entryField: 'events' },
	cardioActivities: { label: 'Cardio', tab: 'Stronger - Cardio', range: 'A:B', collection: 'cardioActivities' },
	garminActivities: { label: 'Garmin activities', tab: 'Stronger - Garmin', range: 'A2:Q', collection: 'garminActivities', entryField: 'entries' },
	garminWellness: { label: 'Garmin wellness', tab: 'Stronger - Garmin Wellness', range: 'A2:AN', collection: 'garminWellness', entryField: 'entries' },
	withingsMeasurements: { label: 'Withings', tab: 'Stronger - Withings', range: 'A2:K', collection: 'withingsMeasurements', entryField: 'entries' },
	settings: { label: 'Settings', tab: 'Stronger - Settings', range: 'A:B', collection: 'settings' },
}

export function parseIterations(value, defaultValue = 3) {
	const parsed = Number(String(value ?? '').trim())
	if (!Number.isFinite(parsed) || parsed < 1) return defaultValue
	return Math.min(Math.floor(parsed), 20)
}

export function selectDatasets(value) {
	const names = String(value ?? '')
		.split(',')
		.map((name) => name.trim())
		.filter(Boolean)
	if (names.length === 0) return Object.keys(DATASETS)
	const unknown = names.filter((name) => !(name in DATASETS))
	if (unknown.length) throw new Error(`Unknown dataset(s): ${unknown.join(', ')}`)
	return names
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
	const ratio = sheets.medianMs / firestore.medianMs
	return `${ratio.toFixed(2)}x`
}

export function renderReport({ rows, totals, iterations }) {
	const lines = [
		`# Sheets vs Firestore read benchmark (${iterations} iteration${iterations === 1 ? '' : 's'})`,
		'',
		'| Dataset | Sheets median | Firestore median | Speedup | Sheets rows | Firestore records | Firestore docs |',
		'| --- | --- | --- | --- | --- | --- | --- |',
	]
	for (const row of rows) {
		lines.push([
			'',
			row.label,
			row.sheets.error ? `error: ${row.sheets.error}` : formatMs(row.sheets.medianMs),
			row.firestore.error ? `error: ${row.firestore.error}` : formatMs(row.firestore.medianMs),
			formatRatio(row.sheets, row.firestore),
			formatCount(row.sheets.count),
			formatCount(row.firestore.count),
			formatCount(row.firestore.documents),
			'',
		].join(' | ').trim())
	}
	lines.push([
		'',
		'**Full load (all datasets)**',
		formatMs(totals.sheets.medianMs),
		formatMs(totals.firestore.medianMs),
		formatRatio(totals.sheets, totals.firestore),
		formatCount(totals.sheets.count),
		formatCount(totals.firestore.count),
		formatCount(totals.firestore.documents),
		'',
	].join(' | ').trim())
	return lines.join('\n')
}

function authHeaders(token) {
	return { Authorization: `${AUTH_SCHEME} ${token}` }
}

async function readSheetRange(spreadsheetId, token, tab, range) {
	const target = encodeURIComponent(`'${tab}'!${range}`)
	const response = await fetch(`${SHEETS_API_BASE}/${spreadsheetId}/values/${target}`, {
		headers: authHeaders(token),
	})
	const body = await response.text()
	if (!response.ok) throw new Error(`Sheets request failed (${response.status})`)
	const data = JSON.parse(body)
	return { count: (data.values ?? []).length, bytes: body.length }
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

export async function runBenchmark({ iterations, datasets, readSheets, readFirestore }) {
	const samples = Object.fromEntries(datasets.map((name) => [name, { sheets: [], firestore: [] }]))
	const totals = { sheets: [], firestore: [] }
	for (let iteration = 0; iteration < iterations; iteration += 1) {
		let sheetsTotal = 0
		let firestoreTotal = 0
		let sheetsRows = 0
		let firestoreRecords = 0
		let firestoreDocs = 0
		for (const name of datasets) {
			const sheetsSample = await sample(() => readSheets(name))
			const firestoreSample = await sample(() => readFirestore(name))
			samples[name].sheets.push(sheetsSample)
			samples[name].firestore.push(firestoreSample)
			sheetsTotal += sheetsSample.ms ?? 0
			firestoreTotal += firestoreSample.ms ?? 0
			sheetsRows += sheetsSample.count ?? 0
			firestoreRecords += firestoreSample.count ?? 0
			firestoreDocs += firestoreSample.documents ?? 0
		}
		totals.sheets.push({ ms: sheetsTotal, count: sheetsRows })
		totals.firestore.push({ ms: firestoreTotal, count: firestoreRecords, documents: firestoreDocs })
	}
	return {
		iterations,
		rows: datasets.map((name) => ({
			name,
			label: DATASETS[name].label,
			sheets: summarize(samples[name].sheets),
			firestore: summarize(samples[name].firestore),
		})),
		totals: {
			sheets: summarize(totals.sheets),
			firestore: summarize(totals.firestore),
		},
	}
}

async function main() {
	const iterations = parseIterations(process.env.ITERATIONS)
	const datasets = selectDatasets(process.env.DATASETS)
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

	console.log(`Benchmarking ${datasets.length} dataset(s) over ${iterations} iteration(s)...`)
	const report = await runBenchmark({
		iterations,
		datasets,
		readSheets: (name) => readSheetRange(
			spreadsheetId,
			sheetsToken,
			DATASETS[name].tab,
			DATASETS[name].range,
		),
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
	if (process.env.GITHUB_STEP_SUMMARY) {
		appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${output}\n`)
	}
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error('Benchmark failed:', error.message)
		process.exit(1)
	})
}
