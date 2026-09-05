/**
 * Withings Sync — Withings → Firestore pipeline.
 *
 * Fetches body-composition measurements from the Withings API and merges them
 * into yearly Firestore bucket documents.
 *
 * Unlike Strava, Withings ROTATES its refresh token on every refresh: each
 * call invalidates the previous token (it dies 8h later) and returns a new
 * one. The current refresh token is persisted in an administrator-only
 * /syncState/{uid} Firestore document. WITHINGS_REFRESH_TOKEN is only the
 * initial seed used when Firestore has no stored token.
 *
 * Environment variables (all required):
 *   WITHINGS_CLIENT_ID         – Withings API application client ID
 *   WITHINGS_CLIENT_SECRET     – Withings API application client secret
 *   WITHINGS_REFRESH_TOKEN     – seed refresh token (required only on first run)
 *   FIREBASE_SERVICE_ACCOUNT_KEY – Firebase administrative service account
 *   FIREBASE_USER_ID             – destination UID below /users/{uid}
 *
 * Usage:
 *   node scripts/withings-sync.mjs [--backfill] [--overwrite]
 *
 * Flags:
 *   --backfill   One-time import of full history since BACKFILL_START
 *                (2021-01-01) instead of the rolling 60-day window. Implies
 *                --overwrite.
 *   --overwrite  Replace matching grpIds inside yearly bucket documents.
 */

import { pathToFileURL } from 'node:url'
import {
	createFirestoreClient,
	mergeYearBucketEntries,
	readSyncState,
	writeSyncState,
} from './firestore-sync.mjs'
import { requestWithingsToken } from './withings-oauth.mjs'

const WITHINGS_MEASURE_URL = 'https://wbsapi.withings.net/measure'
const REFRESH_TOKEN_FIELD = 'withingsRefreshToken'

// Withings meastype codes → our column keys. See:
// https://developer.withings.com/developer-guide/v3/data-api/all-available-health-data/
const MEASTYPE = {
	weight: 1,
	fatMass: 8,
	fatRatio: 6,
	muscleMass: 76,
	boneMass: 88,
	hydration: 77,
	fatFreeMass: 5,
	heartRate: 11,
	visceralFat: 170,
}
// Order matters — this is the column order after date/grpId.
const METRIC_KEYS = ['weight', 'fatMass', 'fatRatio', 'muscleMass', 'boneMass', 'hydration', 'fatFreeMass', 'heartRate', 'visceralFat']
const MEASTYPES_PARAM = METRIC_KEYS.map((k) => MEASTYPE[k]).join(',')

// How far back to fetch on each run. Withings measurements are sparse (one
// weigh-in per day at most), so 60 days is plenty of overlap for idempotency
// while keeping the payload small.
const LOOKBACK_DAYS = 60

// One-time backfill window (used only with the --backfill flag): 2021-01-01 UTC.
// Matches the earliest year selectable in the in-app year picker.
const BACKFILL_START = Math.floor(Date.UTC(2021, 0, 1) / 1000)

// ---------------------------------------------------------------------------
// Withings OAuth2 (rotating refresh token)
// ---------------------------------------------------------------------------

export async function refreshAccessToken(clientId, clientSecret, refreshToken) {
	const data = await requestWithingsToken(clientId, clientSecret, {
		grant_type: 'refresh_token',
		refresh_token: refreshToken,
	})
	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token, // rotated — must be persisted
	}
}

// ---------------------------------------------------------------------------
// Withings Measurements
// ---------------------------------------------------------------------------

export async function fetchMeasurements(accessToken, startdate) {
	const res = await fetch(WITHINGS_MEASURE_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			action: 'getmeas',
			meastypes: MEASTYPES_PARAM,
			category: '1', // real measures (not user objectives)
			startdate: String(startdate),
		}),
	})
	if (!res.ok) {
		const text = await res.text()
		throw new Error(`Withings getmeas failed (${res.status}): ${text}`)
	}
	const data = await res.json()
	if (data.status !== 0) {
		throw new Error(`Withings getmeas returned status ${data.status}: ${JSON.stringify(data)}`)
	}
	return data.body?.measuregrps ?? []
}

/** Decode a Withings measure: real value = value * 10^unit. */
function decodeMeasure(measure) {
	return measure.value * Math.pow(10, measure.unit)
}

/**
 * Convert one measuregrp into the Firestore model. Each group is a single
 * weigh-in event with a unix `date` and a `grpid` used for deduplication.
 */
export function groupToMeasurement(grp) {
	const grpId = grp.grpid != null ? String(grp.grpid) : ''
	if (!grpId || grp.date == null) return null

	// Build a type→value map from this group's measures.
	const byType = new Map()
	for (const m of grp.measures ?? []) {
		byType.set(m.type, decodeMeasure(m))
	}

	const weight = byType.get(MEASTYPE.weight)
	if (!Number.isFinite(weight) || weight <= 0) return null

	const date = new Date(grp.date * 1000)
	const dateStr = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`

	const metric = (key) => {
		const v = byType.get(MEASTYPE[key])
		return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null
	}

	return {
		date: dateStr,
		grpId,
		weight: metric('weight'),
		fatMass: metric('fatMass'),
		fatRatio: metric('fatRatio'),
		muscleMass: metric('muscleMass'),
		boneMass: metric('boneMass'),
		hydration: metric('hydration'),
		fatFreeMass: metric('fatFreeMass'),
		heartRate: metric('heartRate'),
		visceralFat: metric('visceralFat'),
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const {
		WITHINGS_CLIENT_ID,
		WITHINGS_CLIENT_SECRET,
		WITHINGS_REFRESH_TOKEN,
		FIREBASE_SERVICE_ACCOUNT_KEY,
		FIREBASE_USER_ID,
	} = process.env

	if (!WITHINGS_CLIENT_ID || !WITHINGS_CLIENT_SECRET) {
		throw new Error('Missing Withings environment variables (WITHINGS_CLIENT_ID, WITHINGS_CLIENT_SECRET)')
	}

	// 1. Authenticate with Firestore and resolve the current rotating token.
	console.log('Authenticating with Firestore...')
	const firestore = await createFirestoreClient(
		FIREBASE_SERVICE_ACCOUNT_KEY,
		FIREBASE_USER_ID,
	)

	const storedToken = await readSyncState(firestore, REFRESH_TOKEN_FIELD)
	const refreshToken = storedToken ?? WITHINGS_REFRESH_TOKEN
	if (!refreshToken) {
		throw new Error('Missing WITHINGS_REFRESH_TOKEN and no token exists in Firestore sync state')
	}
	console.log(storedToken ? 'Using stored Withings refresh token.' : 'Using seed Withings refresh token (first run).')

	// 2. Refresh the Withings access token and immediately persist the rotated
	//    refresh token, so a later failure in this run never strands us with a
	//    dead token.
	console.log('Refreshing Withings access token...')
	const { accessToken, refreshToken: rotatedToken } = await refreshAccessToken(
		WITHINGS_CLIENT_ID,
		WITHINGS_CLIENT_SECRET,
		refreshToken,
	)
	await writeSyncState(firestore, { [REFRESH_TOKEN_FIELD]: rotatedToken })
	console.log('Persisted rotated refresh token to Firestore sync state.')

	// 3. Fetch measurements. Normally a rolling 60-day window (ample overlap for
	//    idempotency); with --backfill, everything since BACKFILL_START instead,
	//    for a one-time import of full history. Dedup by grpId makes both safe.
	const backfill = process.argv.includes('--backfill')
	// Backfill implies overwrite so a full re-sync also refreshes edited weigh-ins.
	const overwrite = backfill || process.argv.includes('--overwrite')
	const startdate = backfill
		? BACKFILL_START
		: Math.floor(Date.now() / 1000) - LOOKBACK_DAYS * 86400
	console.log(
		backfill
			? `Backfilling all measurements since ${new Date(BACKFILL_START * 1000).toISOString().slice(0, 10)}...`
			: `Fetching measurements from Withings (last ${LOOKBACK_DAYS} days)...`,
	)
	const groups = await fetchMeasurements(accessToken, startdate)
	console.log(`Fetched ${groups.length} measurement groups from Withings.`)

	// 4. Convert groups to the migrated Firestore model.
	const measurements = groups
		.map(groupToMeasurement)
		.filter((measurement) => measurement !== null)
		.reverse()
	if (measurements.length === 0) {
		console.log('No valid measurements to sync.')
		return
	}

	const result = await mergeYearBucketEntries(
		firestore,
		'withingsMeasurements',
		measurements,
		'grpId',
		overwrite,
	)
	console.log(`Done — added ${result.added}, updated ${result.updated} Withings measurements in Firestore.`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error('Withings sync failed:', err.message)
		process.exit(1)
	})
}
