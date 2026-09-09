import { describe, expect, it, vi } from 'vitest'

vi.mock('firebase/firestore', () => ({
	waitForPendingWrites: vi.fn(async () => undefined),
}))
vi.mock('../client.ts', () => ({ firestore: {} }))

import { coalescePendingMutations } from '../offline.ts'

describe('offline mutation queue', () => {
	it('keeps only the latest mutation for each user and entity', () => {
		const mutations = [
			{ id: '1', uid: 'user-a', key: 'settings', createdAt: '2026-09-08T10:00:00Z' },
			{ id: '2', uid: 'user-b', key: 'settings', createdAt: '2026-09-08T10:01:00Z' },
			{ id: '3', uid: 'user-a', key: 'settings', createdAt: '2026-09-08T10:02:00Z' },
			{ id: '4', uid: 'user-a', key: 'schedule:2026-09-08', createdAt: '2026-09-08T10:03:00Z' },
		]

		expect(coalescePendingMutations(mutations).map(({ id }) => id)).toEqual(['2', '3', '4'])
	})
})
