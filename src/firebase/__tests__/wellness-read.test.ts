import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
	bucket: {} as Record<string, unknown>,
}))

vi.mock('../client.ts', () => ({ firestore: { path: 'firestore' } }))
vi.mock('firebase/firestore', () => ({
	collection: (parent: { path: string }, name: string) => ({ path: `${parent.path}/${name}` }),
	doc: (parent: { path: string }, ...parts: string[]) => ({ path: `${parent.path}/${parts.join('/')}` }),
	documentId: () => '__name__',
	where: () => ({}),
	query: (reference: { path: string }, filter: unknown) => ({ ...reference, filter }),
	getDocFromServer: async () => ({ exists: () => true, data: () => state.bucket }),
	getDocsFromServer: async (reference: { filter?: unknown }) => ({
		docs: reference.filter ? [] : [{ data: () => state.bucket }],
	}),
}))

import { readGarminActivities, readGarminWellnessEntries } from '../store.ts'

describe('wellness sync metadata', () => {
	beforeEach(() => {
		state.bucket = {
			period: String(new Date().getFullYear()),
			count: 1,
			entries: [{ date: `${new Date().getFullYear()}-01-01`, restingHR: 60 }],
			updatedAt: '2026-10-02T15:30:00+00:00',
		}
	})

	it.each(['all', 'currentYear'] as const)('preserves bucket sync time for %s reads', async (scope) => {
		const entries = await readGarminWellnessEntries('test-user', scope, 'server')
		expect(entries).toEqual([{
			date: `${new Date().getFullYear()}-01-01`,
			restingHR: 60,
			syncedAt: state.bucket.updatedAt,
		}])
	})

	it('keeps legacy entries readable without a bucket timestamp', async () => {
		delete state.bucket.updatedAt
		expect(await readGarminWellnessEntries('test-user', 'all', 'server')).toEqual(state.bucket.entries)
	})

	it('does not attach wellness metadata to other datasets', async () => {
		state.bucket.entries = [{ timestamp: '2026-10-01T10:00:00Z' }]
		expect(await readGarminActivities('test-user', 'all', 'server')).toEqual(state.bucket.entries)
	})
})
