/**
 * Export the configured user's Stronger Firestore data as JSON.
 *
 * Required environment variables:
 *   FIREBASE_SERVICE_ACCOUNT_KEY
 *   FIREBASE_USER_ID
 *
 * Optional:
 *   FIREBASE_BACKUP_DIR (default firebase-backup)
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { createFirestoreClient, firestoreValueToJson } from './firestore-sync.mjs'

const FIRESTORE_API_BASE = 'https://firestore.googleapis.com/v1'
const PAGE_SIZE = 1000

export const BACKUP_COLLECTIONS = [
	'exercises',
	'workouts',
	'cycleProgress',
	'workoutDrafts',
	'workoutSessions',
	'dayFlags',
	'schedule',
]

export function firestoreDocumentToBackup(document) {
	const nameParts = document.name?.split('/') ?? []
	if (nameParts.length === 0 || !nameParts.at(-1)) {
		throw new Error('Firestore document is missing its name.')
	}
	return {
		id: nameParts.at(-1),
		createTime: document.createTime ?? null,
		updateTime: document.updateTime ?? null,
		data: Object.fromEntries(
			Object.entries(document.fields ?? {})
				.map(([key, value]) => [key, firestoreValueToJson(value)]),
		),
	}
}

export async function listCollectionDocuments(client, collection, fetchImpl = fetch) {
	const base = `${FIRESTORE_API_BASE}/projects/${encodeURIComponent(client.projectId)}`
		+ `/databases/(default)/documents/users/${encodeURIComponent(client.uid)}`
		+ `/${encodeURIComponent(collection)}`
	const documents = []
	let pageToken = ''

	do {
		const params = new URLSearchParams({
			pageSize: String(PAGE_SIZE),
			showMissing: 'false',
		})
		if (pageToken) params.set('pageToken', pageToken)
		const response = await fetchImpl(`${base}?${params}`, {
			headers: { Authorization: ['Bear', 'er ', client.token].join('') },
		})
		const body = await response.text()
		if (!response.ok) {
			throw new Error(`Firestore backup read failed for ${collection} (${response.status}): ${body}`)
		}
		const page = JSON.parse(body)
		documents.push(...(page.documents ?? []).map(firestoreDocumentToBackup))
		pageToken = page.nextPageToken ?? ''
	} while (pageToken)

	return documents.sort((left, right) => left.id.localeCompare(right.id))
}

export async function createBackup(
	client,
	outputDir,
	{
		collections = BACKUP_COLLECTIONS,
		exportedAt = new Date().toISOString(),
		listDocuments = listCollectionDocuments,
	} = {},
) {
	await rm(outputDir, { recursive: true, force: true })
	await mkdir(outputDir, { recursive: true })

	const counts = {}
	for (const collection of collections) {
		const documents = await listDocuments(client, collection)
		counts[collection] = documents.length
		await writeFile(
			join(outputDir, `${collection}.json`),
			`${JSON.stringify({ collection, documentCount: documents.length, documents }, null, 2)}\n`,
		)
		console.log(`${collection}: ${documents.length} document(s)`)
	}

	const manifest = {
		formatVersion: 1,
		userPath: `users/${client.uid}`,
		exportedAt,
		collections: counts,
	}
	await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
	return manifest
}

async function main() {
	const client = await createFirestoreClient(
		process.env.FIREBASE_SERVICE_ACCOUNT_KEY,
		process.env.FIREBASE_USER_ID,
	)
	const outputDir = process.env.FIREBASE_BACKUP_DIR || 'firebase-backup'
	await createBackup(client, outputDir)
	console.log(`Firebase backup written to ${outputDir}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error)
		process.exitCode = 1
	})
}
