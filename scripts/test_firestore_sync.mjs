import assert from 'node:assert/strict'
import test from 'node:test'
import { firestoreValueToJson, mergeEntries } from './firestore-sync.mjs'

test('decodes nested Firestore values', () => {
	assert.deepEqual(firestoreValueToJson({
		mapValue: {
			fields: {
				count: { integerValue: '2' },
				entries: {
					arrayValue: {
						values: [
							{ mapValue: { fields: { date: { stringValue: '2026-01-01' } } } },
						],
					},
				},
			},
		},
	}), {
		count: 2,
		entries: [{ date: '2026-01-01' }],
	})
})

test('append merge preserves existing matching entries', () => {
	const result = mergeEntries(
		[{ date: '2026-01-01', grpId: '1', weight: 80 }],
		[
			{ date: '2026-01-01', grpId: '1', weight: 81 },
			{ date: '2026-01-02', grpId: '2', weight: 79 },
		],
		'grpId',
		false,
	)
	assert.deepEqual(result, {
		entries: [
			{ date: '2026-01-01', grpId: '1', weight: 80 },
			{ date: '2026-01-02', grpId: '2', weight: 79 },
		],
		added: 1,
		updated: 0,
	})
})

test('overwrite merge replaces only matching entries', () => {
	const result = mergeEntries(
		[
			{ date: '2025-12-31', grpId: 'old', weight: 82 },
			{ date: '2026-01-01', grpId: '1', weight: 80 },
		],
		[{ date: '2026-01-01', grpId: '1', weight: 81 }],
		'grpId',
		true,
	)
	assert.deepEqual(result.entries, [
		{ date: '2025-12-31', grpId: 'old', weight: 82 },
		{ date: '2026-01-01', grpId: '1', weight: 81 },
	])
	assert.equal(result.added, 0)
	assert.equal(result.updated, 1)
})
