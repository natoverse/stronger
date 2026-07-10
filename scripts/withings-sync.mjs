/**
 * Withings Sync — Withings → Google Sheets pipeline.
 *
 * Fetches body-composition measurements from the Withings API and appends
 * new daily rows to the "Stronger - Withings" tab in a Google Sheet. Uses a
 * service account for Sheets access and a Withings refresh token for API auth.
 *
 * Unlike Strava, Withings ROTATES its refresh token on every refresh: each
 * call invalidates the previous token (it dies 8h later) and returns a new
 * one. A stateless GitHub Actions cron reading a fixed secret would therefore
 * work once and then break. To survive, we persist the current refresh token
 * in a "Stronger - Infra" tab in the same spreadsheet — read it at the start
 * of each run, write the rotated token back at the end. The WITHINGS_REFRESH_TOKEN
 * secret is only the initial seed (used when the Infra tab has no token yet).
 *
 * Environment variables (all required):
 *   WITHINGS_CLIENT_ID         – Withings API application client ID
 *   WITHINGS_CLIENT_SECRET     – Withings API application client secret
 *   WITHINGS_REFRESH_TOKEN     – seed refresh token (only used on first run)
 *   GOOGLE_SERVICE_ACCOUNT_KEY – JSON key for the Google service account
 *   SPREADSHEET_ID             – Google Sheets spreadsheet ID
 *
 * Usage:
 *   node scripts/withings-sync.mjs
 */

const WITHINGS_TOKEN_URL = 'https://wbsapi.withings.net/v2/oauth2'
const WITHINGS_MEASURE_URL = 'https://wbsapi.withings.net/measure'
const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

const TAB_NAME = 'Stronger - Withings'
const HEADER = ['date', 'grpId', 'weight', 'fatMass', 'fatRatio', 'muscleMass', 'boneMass', 'hydration', 'fatFreeMass', 'heartRate']
const COLUMN_COUNT = HEADER.length // 10 → columns A:J

// Infra tab: internal key/value store for rotating credentials.
const INFRA_TAB_NAME = 'Stronger - Infra'
const INFRA_TOKEN_KEY = 'withings_refresh_token'

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
}
// Order matters — this is the column order after date/grpId.
const METRIC_KEYS = ['weight', 'fatMass', 'fatRatio', 'muscleMass', 'boneMass', 'hydration', 'fatFreeMass', 'heartRate']
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

async function refreshAccessToken(clientId, clientSecret, refreshToken) {
	const res = await fetch(WITHINGS_TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			action: 'requesttoken',
			client_id: clientId,
			client_secret: clientSecret,
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
		}),
	})
	if (!res.ok) {
		const text = await res.text()
		throw new Error(`Withings token refresh failed (${res.status}): ${text}`)
	}
	const data = await res.json()
	// Withings wraps everything in { status, body } — status 0 means success.
	if (data.status !== 0) {
		throw new Error(`Withings token refresh returned status ${data.status}: ${JSON.stringify(data)}`)
	}
	return {
		accessToken: data.body.access_token,
		refreshToken: data.body.refresh_token, // rotated — must be persisted
	}
}

// ---------------------------------------------------------------------------
// Withings Measurements
// ---------------------------------------------------------------------------

async function fetchMeasurements(accessToken, startdate) {
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
 * Convert one measuregrp into a sheet row, or null if it has none of the
 * metrics we track. Each group is a single weigh-in event with a unix `date`
 * and a `grpid` used for deduplication.
 */
function groupToRow(grp) {
	const grpId = grp.grpid != null ? String(grp.grpid) : ''
	if (!grpId || grp.date == null) return null

	// Build a type→value map from this group's measures.
	const byType = new Map()
	for (const m of grp.measures ?? []) {
		byType.set(m.type, decodeMeasure(m))
	}

	// Keep only groups that carry at least one tracked metric.
	const hasAny = METRIC_KEYS.some((k) => byType.has(MEASTYPE[k]))
	if (!hasAny) return null

	const date = new Date(grp.date * 1000)
	const dateStr = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`

	const cell = (key) => {
		const v = byType.get(MEASTYPE[key])
		return v == null ? '' : String(Math.round(v * 100) / 100)
	}

	return [dateStr, grpId, ...METRIC_KEYS.map(cell)]
}

// ---------------------------------------------------------------------------
// Google Sheets (service account via REST)
// ---------------------------------------------------------------------------

async function getGoogleAccessToken(serviceAccountKey) {
	// Build a JWT and exchange it for an access token.
	// We use the Web Crypto API (available in Node 20+) to sign the JWT.
	const key = typeof serviceAccountKey === 'string'
		? JSON.parse(serviceAccountKey)
		: serviceAccountKey

	const now = Math.floor(Date.now() / 1000)
	const header = { alg: 'RS256', typ: 'JWT' }
	const payload = {
		iss: key.client_email,
		scope: 'https://www.googleapis.com/auth/spreadsheets',
		aud: 'https://oauth2.googleapis.com/token',
		iat: now,
		exp: now + 3600,
	}

	const enc = new TextEncoder()
	const b64url = (buf) =>
		Buffer.from(buf).toString('base64url')

	const headerB64 = b64url(enc.encode(JSON.stringify(header)))
	const payloadB64 = b64url(enc.encode(JSON.stringify(payload)))
	const unsignedToken = `${headerB64}.${payloadB64}`

	// Import the PEM private key
	const pemBody = key.private_key
		.replace(/-----BEGIN PRIVATE KEY-----/, '')
		.replace(/-----END PRIVATE KEY-----/, '')
		.replace(/\s/g, '')
	const binaryKey = Buffer.from(pemBody, 'base64')
	const cryptoKey = await crypto.subtle.importKey(
		'pkcs8',
		binaryKey,
		{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
		false,
		['sign'],
	)
	const signature = await crypto.subtle.sign(
		'RSASSA-PKCS1-v1_5',
		cryptoKey,
		enc.encode(unsignedToken),
	)
	const jwt = `${unsignedToken}.${b64url(new Uint8Array(signature))}`

	const res = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion: jwt,
		}),
	})
	if (!res.ok) {
		const text = await res.text()
		throw new Error(`Google token exchange failed (${res.status}): ${text}`)
	}
	const data = await res.json()
	return data.access_token
}

async function listSheetTitles(spreadsheetId, googleToken) {
	const metaRes = await fetch(
		`${SHEETS_API_BASE}/${spreadsheetId}?fields=sheets.properties.title`,
		{ headers: { Authorization: `Bearer ${googleToken}` } },
	)
	if (!metaRes.ok) {
		const text = await metaRes.text()
		throw new Error(`Sheets metadata fetch failed (${metaRes.status}): ${text}`)
	}
	const meta = await metaRes.json()
	return (meta.sheets ?? []).map((s) => s.properties?.title).filter(Boolean)
}

async function addSheet(spreadsheetId, googleToken, title) {
	const createRes = await fetch(
		`${SHEETS_API_BASE}/${spreadsheetId}:batchUpdate`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${googleToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				requests: [{ addSheet: { properties: { title } } }],
			}),
		},
	)
	if (!createRes.ok) {
		const text = await createRes.text()
		throw new Error(`Tab creation failed for "${title}" (${createRes.status}): ${text}`)
	}
}

async function writeRange(spreadsheetId, googleToken, range, values) {
	const encoded = encodeURIComponent(range)
	const res = await fetch(
		`${SHEETS_API_BASE}/${spreadsheetId}/values/${encoded}?valueInputOption=RAW`,
		{
			method: 'PUT',
			headers: {
				Authorization: `Bearer ${googleToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ values }),
		},
	)
	if (!res.ok) {
		const text = await res.text()
		throw new Error(`Range write failed (${res.status}): ${text}`)
	}
}

async function readRange(spreadsheetId, googleToken, range) {
	const encoded = encodeURIComponent(range)
	const res = await fetch(
		`${SHEETS_API_BASE}/${spreadsheetId}/values/${encoded}`,
		{ headers: { Authorization: `Bearer ${googleToken}` } },
	)
	if (!res.ok) {
		const text = await res.text()
		throw new Error(`Range read failed (${res.status}): ${text}`)
	}
	const data = await res.json()
	return data.values ?? []
}

async function ensureWithingsTab(spreadsheetId, googleToken, existingTitles) {
	if (existingTitles.includes(TAB_NAME)) return
	await addSheet(spreadsheetId, googleToken, TAB_NAME)
	const colLetter = String.fromCharCode(64 + COLUMN_COUNT)
	await writeRange(spreadsheetId, googleToken, `'${TAB_NAME}'!A1:${colLetter}1`, [HEADER])
	console.log(`Created "${TAB_NAME}" tab with header row.`)
}

async function ensureInfraTab(spreadsheetId, googleToken, existingTitles) {
	if (existingTitles.includes(INFRA_TAB_NAME)) return
	await addSheet(spreadsheetId, googleToken, INFRA_TAB_NAME)
	await writeRange(spreadsheetId, googleToken, `'${INFRA_TAB_NAME}'!A1:B1`, [['key', 'value']])
	console.log(`Created "${INFRA_TAB_NAME}" tab.`)
}

/** Read a value from the Infra key/value tab, or null if absent. */
async function readInfraValue(spreadsheetId, googleToken, wantKey) {
	const rows = await readRange(spreadsheetId, googleToken, `'${INFRA_TAB_NAME}'!A2:B`)
	for (const row of rows) {
		if ((row[0] ?? '').trim() === wantKey) return (row[1] ?? '').trim() || null
	}
	return null
}

/** Upsert a value in the Infra key/value tab. */
async function writeInfraValue(spreadsheetId, googleToken, wantKey, value) {
	const rows = await readRange(spreadsheetId, googleToken, `'${INFRA_TAB_NAME}'!A2:B`)
	let rowIndex = -1
	for (let i = 0; i < rows.length; i++) {
		if ((rows[i][0] ?? '').trim() === wantKey) {
			rowIndex = i
			break
		}
	}
	if (rowIndex >= 0) {
		// Overwrite existing row (row 2 is the first data row).
		await writeRange(spreadsheetId, googleToken, `'${INFRA_TAB_NAME}'!A${rowIndex + 2}:B${rowIndex + 2}`, [[wantKey, value]])
	} else {
		// Append after the last existing data row.
		const nextRow = rows.length + 2
		await writeRange(spreadsheetId, googleToken, `'${INFRA_TAB_NAME}'!A${nextRow}:B${nextRow}`, [[wantKey, value]])
	}
}

async function readExistingGroupIds(spreadsheetId, googleToken) {
	// grpId is column B, starting from row 2.
	const rows = await readRange(spreadsheetId, googleToken, `'${TAB_NAME}'!B2:B`)
	const ids = new Set()
	for (const row of rows) {
		if (row[0]) ids.add(row[0].trim())
	}
	return ids
}

async function appendRows(spreadsheetId, googleToken, rows) {
	if (rows.length === 0) return
	const colLetter = String.fromCharCode(64 + COLUMN_COUNT)
	const range = encodeURIComponent(`'${TAB_NAME}'!A:${colLetter}`)
	const res = await fetch(
		`${SHEETS_API_BASE}/${spreadsheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${googleToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ values: rows }),
		},
	)
	if (!res.ok) {
		const text = await res.text()
		throw new Error(`Append rows failed (${res.status}): ${text}`)
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
		GOOGLE_SERVICE_ACCOUNT_KEY,
		SPREADSHEET_ID,
	} = process.env

	if (!WITHINGS_CLIENT_ID || !WITHINGS_CLIENT_SECRET || !WITHINGS_REFRESH_TOKEN) {
		throw new Error('Missing Withings environment variables (WITHINGS_CLIENT_ID, WITHINGS_CLIENT_SECRET, WITHINGS_REFRESH_TOKEN)')
	}
	if (!GOOGLE_SERVICE_ACCOUNT_KEY) {
		throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_KEY environment variable')
	}
	if (!SPREADSHEET_ID) {
		throw new Error('Missing SPREADSHEET_ID environment variable')
	}

	// 1. Authenticate with Google Sheets (needed early to read the stored token).
	console.log('Authenticating with Google Sheets...')
	const googleToken = await getGoogleAccessToken(GOOGLE_SERVICE_ACCOUNT_KEY)

	// 2. Ensure both tabs exist.
	const titles = await listSheetTitles(SPREADSHEET_ID, googleToken)
	await ensureInfraTab(SPREADSHEET_ID, googleToken, titles)
	await ensureWithingsTab(SPREADSHEET_ID, googleToken, titles)

	// 3. Resolve the refresh token: prefer the rotated one stored in the sheet,
	//    falling back to the seed secret on the very first run.
	const storedToken = await readInfraValue(SPREADSHEET_ID, googleToken, INFRA_TOKEN_KEY)
	const refreshToken = storedToken ?? WITHINGS_REFRESH_TOKEN
	console.log(storedToken ? 'Using stored Withings refresh token.' : 'Using seed Withings refresh token (first run).')

	// 4. Refresh the Withings access token and immediately persist the rotated
	//    refresh token, so a later failure in this run never strands us with a
	//    dead token.
	console.log('Refreshing Withings access token...')
	const { accessToken, refreshToken: rotatedToken } = await refreshAccessToken(
		WITHINGS_CLIENT_ID,
		WITHINGS_CLIENT_SECRET,
		refreshToken,
	)
	await writeInfraValue(SPREADSHEET_ID, googleToken, INFRA_TOKEN_KEY, rotatedToken)
	console.log('Persisted rotated refresh token to Infra tab.')

	// 5. Fetch measurements. Normally a rolling 60-day window (ample overlap for
	//    idempotency); with --backfill, everything since BACKFILL_START instead,
	//    for a one-time import of full history. Dedup by grpId makes both safe.
	const backfill = process.argv.includes('--backfill')
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

	// 6. Read existing group IDs for deduplication.
	const existingIds = await readExistingGroupIds(SPREADSHEET_ID, googleToken)
	console.log(`Found ${existingIds.size} existing measurements in sheet.`)

	// 7. Convert and filter new groups.
	const newRows = groups
		.map(groupToRow)
		.filter((row) => row !== null && !existingIds.has(row[1])) // row[1] = grpId

	if (newRows.length === 0) {
		console.log('No new measurements to sync.')
		return
	}

	// 8. Append new rows (oldest first for readability).
	newRows.reverse()
	console.log(`Appending ${newRows.length} new measurements...`)
	await appendRows(SPREADSHEET_ID, googleToken, newRows)
	console.log(`Done — synced ${newRows.length} new measurements.`)
}

main().catch((err) => {
	console.error('Withings sync failed:', err.message)
	process.exit(1)
})
