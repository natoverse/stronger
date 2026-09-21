import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
	BACKUP_COLLECTIONS,
	createBackup,
	firestoreDocumentToBackup,
	listCollectionDocuments,
} from './firebase-backup.mjs'

test('backup scope contains only Stronger application data', () => {
	assert.deepEqual(BACKUP_COLLECTIONS, [
		'exercises',
		'workouts',
		'cycleProgress',
		'workoutDrafts',
		'workoutSessions',
		'dayFlags',
		'schedule',
	])
})

test('converts Firestore documents to readable backup records', () => {
	assert.deepEqual(firestoreDocumentToBackup({
		name: 'projects/test/databases/(default)/documents/users/user-1/workouts/Workout%20A',
		createTime: '2026-01-01T00:00:00Z',
		updateTime: '2026-01-02T00:00:00Z',
		fields: {
			name: { stringValue: 'Workout A' },
			favorite: { booleanValue: true },
			sets: {
				arrayValue: {
					values: [{ mapValue: { fields: { reps: { integerValue: '5' } } } }],
				},
			},
		},
	}), {
		id: 'Workout%20A',
		createTime: '2026-01-01T00:00:00Z',
		updateTime: '2026-01-02T00:00:00Z',
		data: {
			name: 'Workout A',
			favorite: true,
			sets: [{ reps: 5 }],
		},
	})
})

test('reads every paginated collection document', async () => {
	const requests = []
	const pages = [
		{
			documents: [{
				name: 'projects/test/databases/(default)/documents/users/user-1/exercises/b',
				fields: { name: { stringValue: 'Bench' } },
			}],
			nextPageToken: 'next-page',
		},
		{
			documents: [{
				name: 'projects/test/databases/(default)/documents/users/user-1/exercises/a',
				fields: { name: { stringValue: 'Abs' } },
			}],
		},
	]
	const fetchImpl = async (url, options) => {
		requests.push({ url, options })
		const page = pages.shift()
		return {
			ok: true,
			status: 200,
			text: async () => JSON.stringify(page),
		}
	}

	const documents = await listCollectionDocuments(
		{ projectId: 'test-project', uid: 'user-1', token: 'token' },
		'exercises',
		fetchImpl,
	)

	assert.deepEqual(documents.map(({ id }) => id), ['a', 'b'])
	assert.equal(requests.length, 2)
	assert.match(requests[1].url, /pageToken=next-page/)
	assert.equal(requests[0].options.headers.Authorization, ['Bear', 'er token'].join(''))
})

test('writes collection files and a manifest', async () => {
	const outputDir = await mkdtemp(join(tmpdir(), 'firebase-backup-'))
	try {
		const manifest = await createBackup(
			{ uid: 'user-1' },
			outputDir,
			{
				collections: ['exercises', 'workouts'],
				exportedAt: '2026-09-15T00:00:00.000Z',
				listDocuments: async (_client, collection) => [{
					id: `${collection}-1`,
					createTime: null,
					updateTime: null,
					data: { name: collection },
				}],
			},
		)

		assert.deepEqual(await readdir(outputDir), [
			'exercises.json',
			'manifest.json',
			'workouts.json',
		])
		assert.deepEqual(manifest, {
			formatVersion: 1,
			userPath: 'users/user-1',
			exportedAt: '2026-09-15T00:00:00.000Z',
			collections: { exercises: 1, workouts: 1 },
		})
		const exercises = JSON.parse(await readFile(join(outputDir, 'exercises.json'), 'utf8'))
		assert.equal(exercises.documentCount, 1)
		assert.equal(exercises.documents[0].id, 'exercises-1')
	} finally {
		await rm(outputDir, { recursive: true, force: true })
	}
})
