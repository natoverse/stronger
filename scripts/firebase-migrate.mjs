/**
 * One-time Google Sheets -> Firestore migration.
 *
 * Required environment variables:
 *   GOOGLE_SERVICE_ACCOUNT_KEY
 *   FIREBASE_SERVICE_ACCOUNT_KEY
 *   SPREADSHEET_ID
 *   FIREBASE_USER_ID (required unless DRY_RUN=true)
 *
 * Optional:
 *   DRY_RUN=true|false (default true)
 *   REPLACE_EXISTING=true|false (default false)
 */

import { pathToFileURL } from 'node:url'

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const FIRESTORE_API_BASE = 'https://firestore.googleapis.com/v1'
const SCHEMA_VERSION = 2
const BATCH_SIZE = 400

const TABS = {
	exercises: { title: 'Stronger - Exercises', range: 'A:J', required: true },
	workouts: { title: 'Stronger - Workouts', range: 'A:M', required: true },
	logs: { title: 'Stronger - Log', range: 'A2:M' },
	dayFlags: { title: 'Stronger - Schedule', range: 'A2:G10000' },
	schedule: { title: 'Stronger - Workout Schedule', range: 'A2:E10000' },
	cardio: { title: 'Stronger - Cardio', range: 'A:B' },
	garmin: { title: 'Stronger - Garmin', range: 'A2:Q' },
	garminWellness: { title: 'Stronger - Garmin Wellness', range: 'A2:AN' },
	withings: { title: 'Stronger - Withings', range: 'A2:K' },
	settings: { title: 'Stronger - Settings', range: 'A:B' },
}

const COLLECTION_TABS = {
	exercises: ['exercises'],
	workouts: ['exercises', 'workouts'],
	workoutSessions: ['logs'],
	dayFlags: ['dayFlags'],
	schedule: ['schedule'],
	cardioActivities: ['cardio'],
	garminActivities: ['garmin'],
	garminWellness: ['garminWellness'],
	withingsMeasurements: ['withings'],
	settings: ['settings'],
}

const GARMIN_WELLNESS_FIELDS = [
	'date',
	'hrvWeeklyAvg', 'hrvStatus',
	'sleepDurationSec', 'sleepDeepSec', 'sleepLightSec',
	'sleepRemSec', 'sleepAwakeSec', 'sleepScore',
	'bodyBatteryHigh', 'bodyBatteryLow',
	'readinessScore',
	'trainingStatus', 'trainingAcuteLoad', 'trainingChronicLoad',
	'steps', 'floors', 'restingHR', 'vo2Max',
	'intensityMinModerate', 'intensityMinVigorous',
	'hillScore', 'enduranceScore',
	'heatAcclimationPct', 'altitudeAcclimationPct', 'currentAltitude',
	'activeCalories', 'bmrCalories',
	'avgStress',
	'loadFocusAerobicLow', 'loadFocusAerobicLowMin', 'loadFocusAerobicLowMax',
	'loadFocusAerobicHigh', 'loadFocusAerobicHighMin', 'loadFocusAerobicHighMax',
	'loadFocusAnaerobic', 'loadFocusAnaerobicMin', 'loadFocusAnaerobicMax',
	'hrvBaselineMin', 'hrvBaselineMax',
]

const TRAINING_STATUS_CODE_MAP = {
	0: 'NO_STATUS',
	1: 'DETRAINING',
	2: 'UNPRODUCTIVE',
	4: 'MAINTAINING',
	5: 'RECOVERY',
	6: 'PEAKING',
	7: 'PRODUCTIVE',
	8: 'STRAINED',
}

export function required(value, name) {
	if (!value) throw new Error(`Missing ${name} environment variable`)
	return value
}

function boolEnv(value, defaultValue) {
	if (value == null || value === '') return defaultValue
	return value.toLowerCase() === 'true'
}

export function parseServiceAccount(raw, name) {
	try {
		const value = JSON.parse(raw)
		if (!value.client_email || !value.private_key || !value.project_id) {
			throw new Error('missing client_email, private_key, or project_id')
		}
		return value
	} catch (error) {
		throw new Error(`${name} is not valid service-account JSON: ${error.message}`)
	}
}

export async function getAccessToken(serviceAccount, scopes) {
	const now = Math.floor(Date.now() / 1000)
	const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
	const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
		iss: serviceAccount.client_email,
		scope: scopes.join(' '),
		aud: 'https://oauth2.googleapis.com/token',
		iat: now,
		exp: now + 3600,
	})}`
	const pem = serviceAccount.private_key
		.replace(/-----BEGIN PRIVATE KEY-----/, '')
		.replace(/-----END PRIVATE KEY-----/, '')
		.replace(/\s/g, '')
	const key = await crypto.subtle.importKey(
		'pkcs8',
		Buffer.from(pem, 'base64'),
		{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
		false,
		['sign'],
	)
	const signature = await crypto.subtle.sign(
		'RSASSA-PKCS1-v1_5',
		key,
		new TextEncoder().encode(unsigned),
	)
	const jwt = `${unsigned}.${Buffer.from(signature).toString('base64url')}`
	const response = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion: jwt,
		}),
	})
	if (!response.ok) throw new Error(`Google token exchange failed (${response.status}): ${await response.text()}`)
	return (await response.json()).access_token
}

async function fetchJson(url, token, options = {}) {
	const response = await fetch(url, {
		...options,
		headers: {
			Authorization: `Bearer ${token}`,
			...(options.body ? { 'Content-Type': 'application/json' } : {}),
			...options.headers,
		},
	})
	if (!response.ok) throw new Error(`Request failed (${response.status}) ${url}: ${await response.text()}`)
	return response.status === 204 ? null : response.json()
}

export async function readSheetData(
	spreadsheetId,
	token,
	requestedCollections = Object.keys(COLLECTION_TABS),
) {
	const metadata = await fetchJson(
		`${SHEETS_API_BASE}/${spreadsheetId}?fields=sheets.properties.title`,
		token,
	)
	const titles = new Set((metadata.sheets ?? []).map((sheet) => sheet.properties?.title).filter(Boolean))
	const warnings = []
	const rows = {}
	const requestedTabs = new Set(requestedCollections.flatMap((collection) => COLLECTION_TABS[collection]))
	for (const [key, tab] of Object.entries(TABS)) {
		if (!requestedTabs.has(key)) {
			rows[key] = null
			continue
		}
		if (!titles.has(tab.title)) {
			const message = `${tab.title} is missing and will be skipped.`
			if (tab.required) throw new Error(`Required tab: ${message}`)
			warnings.push(message)
			rows[key] = null
			continue
		}
		const range = encodeURIComponent(`'${tab.title}'!${tab.range}`)
		const data = await fetchJson(`${SHEETS_API_BASE}/${spreadsheetId}/values/${range}`, token)
		rows[key] = data.values ?? []
	}
	return { rows, warnings }
}

function text(value) {
	return String(value ?? '').trim()
}

function number(value) {
	const raw = text(value)
	if (!raw) return null
	const parsed = Number(raw)
	return Number.isFinite(parsed) ? parsed : null
}

function nonNegative(value, fallback = null) {
	const parsed = number(value)
	return parsed != null && parsed >= 0 ? parsed : fallback
}

function sheetNonNegative(value) {
	const parsed = Number(text(value))
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function positive(value, fallback = null) {
	const parsed = number(value)
	return parsed != null && parsed > 0 ? parsed : fallback
}

function truthy(value) {
	return text(value).toUpperCase() === 'TRUE'
}

function date(value) {
	const parsed = text(value)
	return /^\d{4}-\d{2}-\d{2}$/.test(parsed) ? parsed : null
}

export function idPart(value) {
	return encodeURIComponent(String(value)).replaceAll('.', '%2E')
}

function workoutSessionKey(session) {
	return `${session.date}:${session.startTime}:${session.workoutId}`
}

export function groupWorkoutSessions(rows) {
	const sessions = new Map()
	for (const row of rows) {
		const sessionId = workoutSessionKey(row)
		if (!sessions.has(sessionId)) {
			sessions.set(sessionId, {
				date: row.date,
				startTime: row.startTime,
				endTime: row.endTime,
				workoutId: row.workoutId,
				exercises: [],
			})
		}

		const session = sessions.get(sessionId)
		if (row.endTime) session.endTime = row.endTime
		const previousExercise = session.exercises.at(-1)
		const previousSet = previousExercise?.sets.at(-1)
		const sameExercise = previousExercise
			&& previousExercise.liftId === row.liftId
			&& previousExercise.exerciseName === row.exerciseName
			&& row.setNumber > previousSet.setNumber
		const exercise = sameExercise
			? previousExercise
			: {
				liftId: row.liftId,
				exerciseName: row.exerciseName,
				sets: [],
			}
		if (!sameExercise) session.exercises.push(exercise)
		exercise.sets.push({
			setNumber: row.setNumber,
			setType: row.setType,
			plannedWeight: row.plannedWeight,
			plannedReps: row.plannedReps,
			actualWeight: row.actualWeight,
			actualReps: row.actualReps,
			completed: row.completed,
		})
	}
	return [...sessions.values()]
}

export function yearBucketDocumentId(bucket) {
	return bucket.period
}

export function groupYearBuckets(entries) {
	const buckets = new Map()
	const ordered = [...entries].sort((left, right) =>
		`${left.date}:${left.startTime ?? ''}`.localeCompare(`${right.date}:${right.startTime ?? ''}`))
	for (const entry of ordered) {
		const period = entry.date?.slice(0, 4)
		if (!/^\d{4}$/.test(period)) throw new Error(`Cannot create year bucket for invalid date: ${entry.date}`)
		if (!buckets.has(period)) buckets.set(period, { period, count: 0, entries: [] })
		const bucket = buckets.get(period)
		bucket.entries.push(entry)
		bucket.count = bucket.entries.length
	}
	return [...buckets.values()]
}

export function scheduleDayDocumentId(day) {
	return day.date
}

export function groupScheduleDays(entries) {
	const days = new Map()
	for (const { date: entryDate, ...event } of entries) {
		if (!days.has(entryDate)) days.set(entryDate, { date: entryDate, events: [] })
		days.get(entryDate).events.push(event)
	}
	return [...days.values()]
}

export function parseExerciseRow(row) {
	if (row.length < 7) return null
	const id = text(row[0])
	const name = text(row[1])
	const values = row.slice(2, 7).map((value) => nonNegative(value))
	if (!id || !name || values.some((value) => value == null)) return null
	const [topSetWeight, backoffWeight, increment, minimumWeight, roundingFactor] = values
	const rawBarWeight = text(row[7])
	const barWeight = rawBarWeight ? nonNegative(rawBarWeight) : 0
	if (barWeight == null) return null
	const rawGear = text(row[8]).toLowerCase()
	const gear = ['barbell', 'dumbbell', 'band', 'bodyweight', 'other'].includes(rawGear) ? rawGear : 'other'
	const warmupRoundingFactor = nonNegative(row[9], 5)
	return {
		id,
		name,
		topSetWeight,
		backoffWeight,
		increment,
		minimumWeight,
		roundingFactor,
		warmupRoundingFactor,
		barWeight,
		gear,
	}
}

export function decodeWeightBasis(value) {
	const raw = text(value)
	if (raw === 'topSet' || raw === 'backoff' || raw === 'barWeight') return { kind: raw }
	if (raw.startsWith('crossReference:')) {
		const liftId = text(raw.slice('crossReference:'.length))
		return liftId ? { kind: 'crossReference', liftId } : null
	}
	if (raw.startsWith('fixed:')) {
		const weight = nonNegative(raw.slice('fixed:'.length))
		return weight == null ? null : { kind: 'fixed', weight }
	}
	if (raw.startsWith('relative:')) {
		const [, reference, rawOffset] = raw.split(':')
		const offset = number(rawOffset)
		return ['topSet', 'backoff'].includes(reference) && offset != null
			? { kind: 'relative', reference, offset }
			: null
	}
	return null
}

function parseWorkoutRow(row) {
	const workoutId = text(row[0])
	const workoutName = text(row[1])
	const exerciseOrder = positive(row[2])
	const rawRole = text(row[3]).toLowerCase()
	const exerciseRole = ['primary', 'secondary', 'assistance'].includes(rawRole) ? rawRole : 'assistance'
	const liftId = text(row[4])
	const setType = text(row[5])
	const percentage = nonNegative(row[6])
	const weightBasis = decodeWeightBasis(row[7])
	const minReps = nonNegative(row[8])
	const maxReps = nonNegative(row[9])
	if (
		!workoutId || !workoutName || exerciseOrder == null || !liftId
		|| !['warmup', 'work', 'backoff', 'joker'].includes(setType)
		|| percentage == null || !weightBasis || minReps == null || maxReps == null || maxReps < minReps
	) return null
	const comment = text(row[11])
	return {
		workoutId,
		workoutName,
		exerciseOrder,
		exerciseRole,
		liftId,
		favorite: truthy(row[12]),
		set: {
			setType,
			percentage,
			weightBasis,
			minReps,
			maxReps,
			amrap: truthy(row[10]),
			...(comment ? { comment } : {}),
		},
	}
}

export function parseWorkouts(rows, liftNames = new Map()) {
	const parsed = rows.map(parseWorkoutRow).filter(Boolean)
	const workouts = new Map()
	for (const row of parsed) {
		if (!workouts.has(row.workoutId)) {
			workouts.set(row.workoutId, {
				id: row.workoutId,
				name: row.workoutName,
				favorite: row.favorite,
				exercises: new Map(),
			})
		}
		const workout = workouts.get(row.workoutId)
		if (!workout.exercises.has(row.exerciseOrder)) {
			workout.exercises.set(row.exerciseOrder, {
				liftId: row.liftId,
				name: liftNames.get(row.liftId) ?? row.liftId,
				role: row.exerciseRole,
				sets: [],
			})
		}
		workout.exercises.get(row.exerciseOrder).sets.push(row.set)
	}
	return [...workouts.values()].map(({ exercises, ...workout }) => ({
		...workout,
		templates: [...exercises.entries()].sort(([a], [b]) => a - b).map(([, exercise]) => exercise),
	}))
}

function parseLogRow(row) {
	if (row.length < 13) return null
	const parsed = {
		date: date(row[0]),
		startTime: text(row[1]),
		endTime: text(row[2]),
		workoutId: text(row[3]),
		exerciseName: text(row[4]),
		liftId: text(row[5]),
		setNumber: positive(row[6]),
		setType: text(row[7]),
		plannedWeight: sheetNonNegative(row[8]),
		plannedReps: sheetNonNegative(row[9]),
		actualWeight: sheetNonNegative(row[10]),
		actualReps: sheetNonNegative(row[11]),
		completed: truthy(row[12]),
	}
	if (!parsed.date || !parsed.startTime || !parsed.workoutId || !parsed.exerciseName
		|| parsed.setNumber == null || parsed.actualWeight == null || parsed.actualReps == null) return null
	return parsed
}

function parseDayFlagRow(row) {
	const parsedDate = date(row[0])
	if (!parsedDate) return null
	const flags = {
		home: truthy(row[1]),
		elsewhere: truthy(row[2]),
		travel: truthy(row[3]),
		visitors: truthy(row[4]),
		alcohol: truthy(row[5]),
		blocked: truthy(row[6]),
	}
	return Object.values(flags).some(Boolean) ? { date: parsedDate, flags } : null
}

export function parseScheduleRow(row) {
	const parsedDate = date(row[0])
	const workoutId = text(row[1])
	const calendarEventId = text(row[2])
	const strongerId = text(row[3])
	const label = text(row[4])
	if (!parsedDate || (!workoutId && !calendarEventId && !strongerId)) return null
	return {
		date: parsedDate,
		workoutId,
		...(calendarEventId ? { calendarEventId } : {}),
		...(strongerId ? { strongerId } : {}),
		...(label ? { label } : {}),
	}
}

function parseCardioRow(row) {
	const id = text(row[0])
	const name = text(row[1])
	return id && name ? { id, name } : null
}

function normalizeGarminType(value) {
	const key = text(value).toLowerCase()
	if (key === 'strength_training') return 'Weight Training'
	return key.split('_').filter(Boolean).map((word) => `${word[0].toUpperCase()}${word.slice(1)}`).join(' ')
}

function parseGarminRow(row) {
	const parsedDate = date(row[0])
	const stravaId = text(row[1])
	const activityType = normalizeGarminType(row[2])
	const duration = sheetNonNegative(row[4])
	const distance = sheetNonNegative(row[6])
	const elevationGain = sheetNonNegative(row[7])
	const elevationLoss = text(row[8]) ? sheetNonNegative(row[8]) : undefined
	const avgHR = sheetNonNegative(row[9])
	const maxHR = sheetNonNegative(row[10])
	if (!parsedDate || !stravaId || !activityType
		|| [duration, distance, elevationGain, avgHR, maxHR].some((value) => value == null)
		|| (text(row[8]) && elevationLoss == null)) return null
	return {
		date: parsedDate,
		stravaId,
		activityType,
		name: text(row[3]),
		duration,
		distance,
		elevationGain,
		...(elevationLoss == null ? {} : { elevationLoss }),
		calories: 0,
		avgHR,
		maxHR,
	}
}

function normalizeTrainingStatus(value) {
	const raw = text(value)
	if (!raw) return ''
	if (/^\d+$/.test(raw)) return TRAINING_STATUS_CODE_MAP[raw] ?? raw
	const upper = raw.toUpperCase()
	if (upper.startsWith('NO_STATUS')) return 'NO_STATUS'
	for (const prefix of ['PRODUCTIVE', 'MAINTAINING', 'RECOVERY', 'RECOVERY_ACTIVE', 'UNPRODUCTIVE', 'STRAINED', 'OVERREACHING', 'DETRAINING', 'PEAKING']) {
		if (upper === prefix || upper.startsWith(`${prefix}_`)) return prefix
	}
	return upper
}

function parseGarminWellnessRow(row) {
	const parsedDate = date(row[0])
	if (!parsedDate) return null
	return Object.fromEntries(GARMIN_WELLNESS_FIELDS.map((field, index) => {
		if (field === 'date') return [field, parsedDate]
		if (field === 'hrvStatus') return [field, text(row[index])]
		if (field === 'trainingStatus') return [field, normalizeTrainingStatus(row[index])]
		return [field, number(row[index])]
	}))
}

function parseWithingsRow(row) {
	const parsedDate = date(row[0])
	const grpId = text(row[1])
	const weight = positive(row[2])
	if (!parsedDate || !grpId || weight == null) return null
	const optional = (index) => text(row[index]) ? nonNegative(row[index]) : null
	return {
		date: parsedDate,
		grpId,
		weight,
		fatMass: optional(3),
		fatRatio: optional(4),
		muscleMass: optional(5),
		boneMass: optional(6),
		hydration: optional(7),
		fatFreeMass: optional(8),
		heartRate: optional(9),
		visceralFat: optional(10),
	}
}

function documents(values, getId, { label, duplicatePolicy = 'error', warnings }) {
	const byId = new Map()
	let duplicateCount = 0
	values.forEach((data, index) => {
		const id = getId(data, index)
		if (byId.has(id)) {
			if (duplicatePolicy === 'keep-last') {
				duplicateCount += 1
			} else {
				throw new Error(`${label}: duplicate generated document ID: ${id}`)
			}
		}
		byId.set(id, data)
	})
	if (duplicateCount > 0) {
		warnings.push(
			`${label}: collapsed ${duplicateCount} duplicate row${duplicateCount === 1 ? '' : 's'} by document ID; kept the last valid row.`,
		)
	}
	return [...byId].map(([id, data]) => ({ id, data }))
}

export function buildMigrationPlan(
	rows,
	initialWarnings = [],
	requestedCollections = Object.keys(COLLECTION_TABS),
) {
	const warnings = [...initialWarnings]
	const requested = new Set(requestedCollections)
	const validRows = (source, parser, label, skipHeader = false) => {
		const input = skipHeader ? source.slice(1) : source
		const values = input.map(parser).filter(Boolean)
		const invalid = input.filter((row) => row.some((value) => text(value))).length - values.length
		if (invalid > 0) warnings.push(`${label}: skipped ${invalid} invalid row${invalid === 1 ? '' : 's'}.`)
		return values
	}

	const exercises = rows.exercises == null ? [] : validRows(rows.exercises, parseExerciseRow, 'Exercises', true)
	if ((requested.has('exercises') || requested.has('workouts')) && exercises.length === 0) {
		throw new Error('Required tab Stronger - Exercises contains no valid data rows.')
	}
	const liftNames = new Map(exercises.map((item) => [item.id, item.name]))
	const workoutRows = rows.workouts?.slice(1) ?? []
	const workouts = parseWorkouts(workoutRows, liftNames)
	if (requested.has('workouts') && workouts.length === 0) {
		throw new Error('Required tab Stronger - Workouts contains no valid data rows.')
	}
	const invalidWorkoutRows = workoutRows.filter((row) => row.some((value) => text(value))).length
		- workoutRows.map(parseWorkoutRow).filter(Boolean).length
	if (invalidWorkoutRows > 0) warnings.push(`Workouts: skipped ${invalidWorkoutRows} invalid row${invalidWorkoutRows === 1 ? '' : 's'}.`)

	const optionalRows = (key, parser, label, skipHeader = false) =>
		rows[key] == null ? null : validRows(rows[key], parser, label, skipHeader)
	const values = {
		exercises,
		workouts,
		workoutSessions: rows.logs == null ? null : validRows(
			rows.logs.map((row, index) => [...row, index + 2]),
			(row) => {
				const parsed = parseLogRow(row)
				return parsed ? { ...parsed, _migrationSourceRow: row.at(-1) } : null
			},
			'Workout log',
		).sort((left, right) => left._migrationSourceRow - right._migrationSourceRow),
		dayFlags: optionalRows('dayFlags', parseDayFlagRow, 'Day flags'),
		schedule: optionalRows('schedule', parseScheduleRow, 'Workout schedule'),
		cardioActivities: optionalRows('cardio', parseCardioRow, 'Cardio', true),
		garminActivities: optionalRows('garmin', parseGarminRow, 'Garmin'),
		garminWellness: optionalRows('garminWellness', parseGarminWellnessRow, 'Garmin wellness'),
		withingsMeasurements: optionalRows('withings', parseWithingsRow, 'Withings'),
	}
	const settings = new Map()
	for (const row of rows.settings?.slice(1) ?? []) {
		const key = text(row[0])
		const value = text(row[1])
		if (key && value) settings.set(key, value)
	}
	const planDocuments = (label, source, getId, duplicatePolicy = 'error') =>
		documents(source, getId, { label, duplicatePolicy, warnings })

	const plan = {
		...(requested.has('exercises') ? {
			exercises: planDocuments('Exercises', values.exercises, (item) => idPart(item.id)),
		} : {}),
		...(requested.has('workouts') ? {
			workouts: planDocuments('Workouts', values.workouts, (item) => idPart(item.id)),
		} : {}),
		...(!requested.has('workoutSessions') || values.workoutSessions == null ? {} : {
			workoutSessions: planDocuments(
				'Workout session years',
				groupYearBuckets(groupWorkoutSessions(values.workoutSessions)),
				yearBucketDocumentId,
			),
		}),
		...(!requested.has('dayFlags') || values.dayFlags == null ? {} : {
			dayFlags: planDocuments('Day flags', values.dayFlags, (item) => item.date, 'keep-last'),
		}),
		...(!requested.has('schedule') || values.schedule == null ? {} : {
			schedule: planDocuments(
				'Workout schedule days',
				groupScheduleDays(values.schedule),
				scheduleDayDocumentId,
			),
		}),
		...(!requested.has('cardioActivities') || values.cardioActivities == null ? {} : {
			cardioActivities: planDocuments('Cardio', values.cardioActivities, (item) => idPart(item.id)),
		}),
		...(!requested.has('garminActivities') || values.garminActivities == null ? {} : {
			garminActivities: planDocuments(
				'Garmin activity years',
				groupYearBuckets(values.garminActivities),
				yearBucketDocumentId,
			),
		}),
		...(!requested.has('garminWellness') || values.garminWellness == null ? {} : {
			garminWellness: planDocuments(
				'Garmin wellness years',
				groupYearBuckets(
					planDocuments(
						'Garmin wellness',
						values.garminWellness,
						(item) => item.date,
						'keep-last',
					).map(({ data }) => data),
				),
				yearBucketDocumentId,
			),
		}),
		...(!requested.has('withingsMeasurements') || values.withingsMeasurements == null ? {} : {
			withingsMeasurements: planDocuments(
				'Withings measurement years',
				groupYearBuckets(values.withingsMeasurements),
				yearBucketDocumentId,
			),
		}),
		...(!requested.has('settings') || rows.settings == null ? {} : {
			settings: [{ id: 'app', data: { values: Object.fromEntries(settings) } }],
		}),
	}
	return { plan, warnings }
}

function firestoreValue(value) {
	if (value === null) return { nullValue: null }
	if (typeof value === 'boolean') return { booleanValue: value }
	if (typeof value === 'number') {
		return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
	}
	if (typeof value === 'string') return { stringValue: value }
	if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } }
	if (typeof value === 'object') {
		return {
			mapValue: {
				fields: Object.fromEntries(
					Object.entries(value)
						.filter(([, child]) => child !== undefined)
						.map(([key, child]) => [key, firestoreValue(child)]),
				),
			},
		}
	}
	throw new Error(`Unsupported Firestore value type: ${typeof value}`)
}

function firestoreFields(value) {
	return Object.fromEntries(
		Object.entries(value)
			.filter(([, child]) => child !== undefined)
			.map(([key, child]) => [key, firestoreValue(child)]),
	)
}

function databasePath(projectId) {
	return `projects/${projectId}/databases/(default)/documents`
}

function documentName(projectId, uid, collection, id) {
	return `${databasePath(projectId)}/users/${uid}/${collection}/${id}`
}

async function commitWrites(projectId, token, writes) {
	for (let start = 0; start < writes.length; start += BATCH_SIZE) {
		await fetchJson(
			`${FIRESTORE_API_BASE}/projects/${projectId}/databases/(default)/documents:commit`,
			token,
			{ method: 'POST', body: JSON.stringify({ writes: writes.slice(start, start + BATCH_SIZE) }) },
		)
	}
}

async function listCollectionDocumentNames(projectId, token, uid, collection) {
	const names = []
	let pageToken = ''
	do {
		const params = new URLSearchParams({ pageSize: '1000', showMissing: 'false' })
		if (pageToken) params.set('pageToken', pageToken)
		const data = await fetchJson(
			`${FIRESTORE_API_BASE}/${databasePath(projectId)}/users/${encodeURIComponent(uid)}/${collection}?${params}`,
			token,
		)
		names.push(...(data.documents ?? []).map((document) => document.name))
		pageToken = data.nextPageToken ?? ''
	} while (pageToken)
	return names
}

async function recordDocument(projectId, token, uid, collection, id, data) {
	const name = documentName(projectId, uid, collection, id)
	await commitWrites(projectId, token, [{
		update: { name, fields: firestoreFields(data) },
	}])
}

async function recordUser(projectId, token, uid, data) {
	await commitWrites(projectId, token, [{
		update: {
			name: `${databasePath(projectId)}/users/${uid}`,
			fields: firestoreFields(data),
		},
		updateMask: { fieldPaths: Object.keys(data) },
	}])
}

async function verifyFirebaseUser(projectId, token, uid) {
	const data = await fetchJson(
		`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`,
		token,
		{ method: 'POST', body: JSON.stringify({ localId: [uid] }) },
	)
	if (!data.users?.some((user) => user.localId === uid)) {
		throw new Error(`Firebase Authentication user ${uid} does not exist in project ${projectId}.`)
	}
}

export async function writeMigration({
	projectId,
	token,
	uid,
	spreadsheetId,
	migrationId = `sheet-${idPart(spreadsheetId)}`,
	plan,
	warnings,
	replaceExisting,
}) {
	const existing = {}
	for (const collection of Object.keys(plan)) {
		existing[collection] = await listCollectionDocumentNames(projectId, token, uid, collection)
	}
	const existingCount = Object.values(existing).reduce((sum, names) => sum + names.length, 0)
	if (existingCount > 0 && !replaceExisting) {
		throw new Error(`Destination contains ${existingCount} document(s). Enable replace_existing to continue.`)
	}

	const counts = Object.fromEntries(Object.entries(plan).map(([name, docs]) => [name, docs.length]))
	await recordDocument(projectId, token, uid, 'migrations', migrationId, {
		sourceSpreadsheetId: spreadsheetId,
		status: 'running',
		counts,
		warnings,
		startedAt: new Date().toISOString(),
	})

	try {
		const updatedAt = new Date().toISOString()
		for (const [collection, docs] of Object.entries(plan)) {
			await commitWrites(projectId, token, docs.map(({ id, data }) => ({
				update: {
					name: documentName(projectId, uid, collection, id),
					fields: firestoreFields({ ...data, updatedAt }),
				},
			})))
		}
		if (replaceExisting) {
			const desiredNames = new Set(Object.entries(plan).flatMap(([collection, docs]) =>
				docs.map(({ id }) => documentName(projectId, uid, collection, id))))
			const staleNames = Object.values(existing).flat().filter((name) => !desiredNames.has(name))
			await commitWrites(projectId, token, staleNames.map((name) => ({ delete: name })))
		}
		await recordDocument(projectId, token, uid, 'migrations', migrationId, {
			sourceSpreadsheetId: spreadsheetId,
			status: 'complete',
			counts,
			warnings,
			completedAt: new Date().toISOString(),
		})
		await recordUser(projectId, token, uid, {
			schemaVersion: SCHEMA_VERSION,
			sourceSpreadsheetId: spreadsheetId,
			updatedAt: new Date().toISOString(),
		})
	} catch (error) {
		await recordDocument(projectId, token, uid, 'migrations', migrationId, {
			sourceSpreadsheetId: spreadsheetId,
			status: 'failed',
			counts,
			warnings,
			error: error.message,
			failedAt: new Date().toISOString(),
		})
		throw error
	}
	return counts
}

async function main() {
	const dryRun = boolEnv(process.env.DRY_RUN, true)
	const replaceExisting = boolEnv(process.env.REPLACE_EXISTING, false)
	const spreadsheetId = required(process.env.SPREADSHEET_ID, 'SPREADSHEET_ID')
	const googleServiceAccount = parseServiceAccount(
		required(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'GOOGLE_SERVICE_ACCOUNT_KEY'),
		'GOOGLE_SERVICE_ACCOUNT_KEY',
	)
	const firebaseServiceAccount = parseServiceAccount(
		required(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'FIREBASE_SERVICE_ACCOUNT_KEY'),
		'FIREBASE_SERVICE_ACCOUNT_KEY',
	)
	const uid = dryRun ? process.env.FIREBASE_USER_ID : required(process.env.FIREBASE_USER_ID, 'FIREBASE_USER_ID')
	const requestedCollections = process.env.MIGRATION_COLLECTIONS
		? process.env.MIGRATION_COLLECTIONS.split(',').map((value) => value.trim()).filter(Boolean)
		: Object.keys(COLLECTION_TABS)
	const unknownCollections = requestedCollections.filter((collection) => !COLLECTION_TABS[collection])
	if (unknownCollections.length) throw new Error(`Unknown MIGRATION_COLLECTIONS: ${unknownCollections.join(', ')}`)

	console.log(`Reading spreadsheet ${spreadsheetId}...`)
	const sheetsToken = await getAccessToken(googleServiceAccount, ['https://www.googleapis.com/auth/spreadsheets.readonly'])
	const { rows, warnings: readWarnings } = await readSheetData(spreadsheetId, sheetsToken, requestedCollections)
	const { plan, warnings } = buildMigrationPlan(rows, readWarnings, requestedCollections)
	const counts = Object.fromEntries(Object.entries(plan).map(([name, docs]) => [name, docs.length]))

	console.log('Migration preview:')
	for (const [collection, count] of Object.entries(counts)) console.log(`  ${collection}: ${count}`)
	if (warnings.length) {
		console.log('Warnings:')
		for (const warning of warnings) console.log(`  - ${warning}`)
	}
	if (dryRun) {
		console.log('Dry run complete. No Firestore writes were made.')
		return
	}

	const firestoreToken = await getAccessToken(firebaseServiceAccount, ['https://www.googleapis.com/auth/cloud-platform'])
	await verifyFirebaseUser(firebaseServiceAccount.project_id, firestoreToken, uid)
	await writeMigration({
		projectId: firebaseServiceAccount.project_id,
		token: firestoreToken,
		uid,
		spreadsheetId,
		migrationId: requestedCollections.length === Object.keys(COLLECTION_TABS).length
			? `sheet-${idPart(spreadsheetId)}`
			: `sync-${requestedCollections.map(idPart).join('-')}`,
		plan,
		warnings,
		replaceExisting,
	})
	console.log(`Migration complete for /users/${uid}.`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error('Firebase migration failed:', error.message)
		process.exit(1)
	})
}
