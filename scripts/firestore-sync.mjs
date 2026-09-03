import {
	firestoreFields,
	getAccessToken,
	parseServiceAccount,
	required,
} from './firebase-migrate.mjs'

const FIRESTORE_API_BASE = 'https://firestore.googleapis.com/v1'
const MAX_RETRIES = 5
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504])

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

async function firestoreFetch(url, options = {}) {
	let lastError
	for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
		try {
			const response = await fetch(url, options)
			if (!TRANSIENT_STATUS.has(response.status) || attempt === MAX_RETRIES - 1) {
				return response
			}
			await response.text()
		} catch (error) {
			lastError = error
			if (attempt === MAX_RETRIES - 1) throw error
		}
		await sleep(1000 * 2 ** attempt)
	}
	throw lastError
}

function documentName(projectId, segments) {
	return `projects/${projectId}/databases/(default)/documents/${segments.join('/')}`
}

function documentUrl(projectId, segments) {
	return `${FIRESTORE_API_BASE}/projects/${projectId}/databases/(default)/documents/`
		+ segments.map(encodeURIComponent).join('/')
}

export function firestoreValueToJson(value) {
	if (value == null || value.nullValue !== undefined) return null
	if (value.booleanValue !== undefined) return value.booleanValue
	if (value.integerValue !== undefined) return Number(value.integerValue)
	if (value.doubleValue !== undefined) return value.doubleValue
	if (value.stringValue !== undefined) return value.stringValue
	if (value.timestampValue !== undefined) return value.timestampValue
	if (value.arrayValue !== undefined) {
		return (value.arrayValue.values ?? []).map(firestoreValueToJson)
	}
	if (value.mapValue !== undefined) {
		return Object.fromEntries(
			Object.entries(value.mapValue.fields ?? {})
				.map(([key, child]) => [key, firestoreValueToJson(child)]),
		)
	}
	throw new Error('Unsupported Firestore value.')
}

function firestoreDocumentToJson(document) {
	return Object.fromEntries(
		Object.entries(document.fields ?? {})
			.map(([key, value]) => [key, firestoreValueToJson(value)]),
	)
}

async function readDocument(client, segments) {
	const response = await firestoreFetch(documentUrl(client.projectId, segments), {
		headers: { Authorization: `Bearer ${client.token}` },
	})
	if (response.status === 404) return { exists: false, data: null, updateTime: null }
	const body = await response.text()
	if (!response.ok) throw new Error(`Firestore read failed (${response.status}): ${body}`)
	const document = JSON.parse(body)
	return {
		exists: true,
		data: firestoreDocumentToJson(document),
		updateTime: document.updateTime,
	}
}

async function commitDocument(client, segments, data, current) {
	const write = {
		update: {
			name: documentName(client.projectId, segments),
			fields: firestoreFields(data),
		},
		currentDocument: current.exists
			? { updateTime: current.updateTime }
			: { exists: false },
	}
	const response = await firestoreFetch(
		`${FIRESTORE_API_BASE}/projects/${client.projectId}/databases/(default)/documents:commit`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${client.token}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ writes: [write] }),
		},
	)
	const body = await response.text()
	if (response.status === 409 || response.status === 412) return false
	if (!response.ok) throw new Error(`Firestore write failed (${response.status}): ${body}`)
	return true
}

async function updateDocument(client, segments, update) {
	for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
		const current = await readDocument(client, segments)
		const next = update(current.data)
		if (next == null) return null
		if (await commitDocument(client, segments, next, current)) return next
	}
	throw new Error(`Firestore document changed during ${MAX_RETRIES} update attempts: ${segments.join('/')}`)
}

export function mergeEntries(existing, incoming, keyField, overwrite) {
	const byKey = new Map(existing.map((entry) => [String(entry[keyField]), entry]))
	let added = 0
	let updated = 0
	for (const entry of incoming) {
		const key = String(entry[keyField])
		if (!byKey.has(key)) {
			byKey.set(key, entry)
			added += 1
		} else if (overwrite) {
			byKey.set(key, entry)
			updated += 1
		}
	}
	const entries = [...byKey.values()].sort((left, right) =>
		`${left.date}:${left[keyField]}`.localeCompare(`${right.date}:${right[keyField]}`))
	return { entries, added, updated }
}

export async function createFirestoreClient(serviceAccountJson, uid) {
	const serviceAccount = parseServiceAccount(
		required(serviceAccountJson, 'FIREBASE_SERVICE_ACCOUNT_KEY'),
		'FIREBASE_SERVICE_ACCOUNT_KEY',
	)
	return {
		projectId: serviceAccount.project_id,
		token: await getAccessToken(serviceAccount, ['https://www.googleapis.com/auth/cloud-platform']),
		uid: required(uid, 'FIREBASE_USER_ID'),
	}
}

export async function mergeYearBucketEntries(
	client,
	collection,
	incoming,
	keyField,
	overwrite,
) {
	const byYear = new Map()
	for (const entry of incoming) {
		const year = entry.date?.slice(0, 4)
		if (!/^\d{4}$/.test(year)) throw new Error(`Invalid entry date: ${entry.date}`)
		if (!byYear.has(year)) byYear.set(year, [])
		byYear.get(year).push(entry)
	}

	let added = 0
	let updated = 0
	for (const [year, entries] of byYear) {
		const result = { added: 0, updated: 0 }
		await updateDocument(client, ['users', client.uid, collection, year], (current) => {
			const merged = mergeEntries(current?.entries ?? [], entries, keyField, overwrite)
			result.added = merged.added
			result.updated = merged.updated
			return {
				period: year,
				count: merged.entries.length,
				entries: merged.entries,
				updatedAt: new Date().toISOString(),
			}
		})
		added += result.added
		updated += result.updated
	}
	return { added, updated }
}

export async function readSyncState(client, key) {
	const current = await readDocument(client, ['syncState', client.uid])
	return current.data?.[key] ?? null
}

export function writeSyncState(client, values) {
	return updateDocument(client, ['syncState', client.uid], (current) => ({
		...current,
		...values,
		updatedAt: new Date().toISOString(),
	}))
}
