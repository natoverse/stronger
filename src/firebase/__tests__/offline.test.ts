import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('firebase/firestore', () => ({
	waitForPendingWrites: vi.fn(async () => undefined),
	doc: vi.fn((_db, ...path: string[]) => path.join('/')),
	getDocFromServer: vi.fn(),
}))
vi.mock('../client.ts', () => ({ firestore: {} }))

import { coalescePendingMutations } from '../offline.ts'
import { getDocFromServer } from 'firebase/firestore'
import type { SyncSnapshot } from '../offline.ts'

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

	it('never coalesces a failed write away behind a newer edit', () => {
		expect(coalescePendingMutations([
			{ id: 'failed', uid: 'a', key: 'cycle', createdAt: '1', status: 'failed' },
			{ id: 'new', uid: 'a', key: 'cycle', createdAt: '2', status: 'pending' },
		])).toHaveLength(2)
	})
})

describe('durable mutation acknowledgments', () => {
	beforeEach(() => {
		vi.resetModules()
		const values = new Map<string, string>()
		vi.stubGlobal('indexedDB', undefined)
		vi.stubGlobal('navigator', { onLine: true })
		vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }))
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
			removeItem: (key: string) => values.delete(key),
		})
	})

	afterEach(() => vi.unstubAllGlobals())

	it('returns immediately offline and keeps a late rejection as a durable error, not pending network work', async () => {
		vi.stubGlobal('navigator', { onLine: false })
		const offline = await import('../offline.ts')
		let state: SyncSnapshot | undefined
		offline.subscribeToSyncStatus((value) => { state = value })
		await offline.setActiveSyncUser('alice')
		let rejectWrite!: (error: Error) => void
		const rejected = new Promise<void>((_resolve, reject) => { rejectWrite = reject })
		const event = vi.fn()
		window.addEventListener('stronger:mutation-error', event)
		const onRejected = vi.fn()
		await offline.trackMutation('alice', 'cycle', () => rejected, { recovery: { id: 'frozen' }, onRejected })
		expect(state?.pendingCount).toBe(1)
		rejectWrite(new Error('permission-denied: stale revision'))
		await vi.waitFor(() => expect(state?.error).toContain('stale revision'))
		expect(state?.pendingCount).toBe(0)
		await vi.waitFor(() => expect(onRejected).toHaveBeenCalledOnce())
		expect(event.mock.calls[0][0].detail).toEqual({
			uid: 'alice', message: expect.stringContaining('stale revision'),
		})
		window.dispatchEvent(new Event('online'))
		await offline.retryPendingWrites()
		expect(await offline.hasPendingMutations('alice')).toBe(true)
		expect(await offline.readFailedMutationRecoveries('alice')).toEqual([{ id: 'frozen' }])
		await offline.setActiveSyncUser('bob')
		expect(state?.error).toBeUndefined()
		vi.resetModules()
		const reloaded = await import('../offline.ts')
		reloaded.subscribeToSyncStatus((value) => { state = value })
		await reloaded.setActiveSyncUser('alice')
		expect(state?.error).toContain('stale revision')
	})

	it('does not clear unresolved or failed writes when the SDK queue drain resolves', async () => {
		const offline = await import('../offline.ts')
		await offline.setActiveSyncUser('alice')
		let rejectWrite!: (error: Error) => void
		await offline.trackMutation('alice', 'cycle', () => new Promise<void>((_resolve, reject) => {
			rejectWrite = reject
		}))
		await offline.retryPendingWrites()
		expect(await offline.hasPendingMutations('alice')).toBe(true)
		rejectWrite(new Error('conflict'))
		await vi.waitFor(async () => {
			expect(JSON.parse(localStorage.getItem('stronger-offline:alice')!)[0].status).toBe('failed')
		})
		await offline.trackMutation('alice', 'cycle', async () => undefined)
		await offline.retryPendingWrites()
		expect(await offline.hasPendingMutations('alice')).toBe(true)
	})

	it('clears only the acknowledged write, leaving a different queued edit intact', async () => {
		const offline = await import('../offline.ts')
		await offline.setActiveSyncUser('alice')
		await offline.trackMutation('alice', 'cycle', () => new Promise<void>(() => undefined))
		await offline.trackMutation('alice', 'settings', async () => undefined)
		await vi.waitFor(() => {
			const items = JSON.parse(localStorage.getItem('stronger-offline:alice')!)
			expect(items).toHaveLength(1)
			expect(items[0].key).toBe('cycle')
		})
	})

	it.each([true, false])('verifies a queued cycle receipt after reload (committed=%s)', async (committed) => {
		vi.stubGlobal('navigator', { onLine: false })
		const offline = await import('../offline.ts')
		await offline.trackMutation('alice', 'finish', () => new Promise<void>(() => undefined), {
			receipt: { path: ['users', 'alice', 'workoutSessions', 'session'], field: 'cycleSnapshot.id', value: 'frozen' },
			recovery: { id: 'frozen' },
		})
		vi.resetModules()
		vi.stubGlobal('navigator', { onLine: true })
		vi.mocked(getDocFromServer).mockResolvedValue({
			exists: () => committed, data: () => committed ? { cycleSnapshot: { id: 'frozen' } } : undefined,
		} as never)
		const reloaded = await import('../offline.ts')
		await reloaded.setActiveSyncUser('alice')
		await reloaded.retryPendingWrites()
		expect(await reloaded.hasPendingMutations('alice')).toBe(!committed)
		expect(await reloaded.readFailedMutationRecoveries('alice')).toEqual(committed ? [] : [{ id: 'frozen' }])
	})

	it('does not mistake a successfully finished offline session for a rejected start after reload', async () => {
		vi.stubGlobal('navigator', { onLine: false })
		const offline = await import('../offline.ts')
		const pending = () => new Promise<void>(() => undefined)
		const receipt = { path: ['users', 'alice', 'workoutDrafts', 'workout'], field: 'id', value: 'session' }
		await offline.trackMutation('alice', 'start:session', pending, { receipt, recovery: { id: 'session' } })
		await offline.trackMutation('alice', 'draft:session', pending, { receipt, recovery: { id: 'session' } })
		await offline.trackMutation('alice', 'finish:session', pending, {
			receipt: { path: ['users', 'alice', 'workoutSessions', 'session'], field: 'cycleSnapshot.id', value: 'session' },
			recovery: { id: 'session' }, supersedes: ['start:session', 'draft:session'],
		})
		vi.resetModules()
		vi.stubGlobal('navigator', { onLine: true })
		vi.mocked(getDocFromServer).mockImplementation(async (ref) => ({
			exists: () => String(ref).includes('workoutSessions'),
			data: () => String(ref).includes('workoutSessions') ? { cycleSnapshot: { id: 'session' } } : undefined,
		}) as never)
		const reloaded = await import('../offline.ts')
		await reloaded.setActiveSyncUser('alice')
		await reloaded.retryPendingWrites()
		expect(await reloaded.hasPendingMutations('alice')).toBe(false)
		expect(await reloaded.readFailedMutationRecoveries('alice')).toEqual([])
	})
})
