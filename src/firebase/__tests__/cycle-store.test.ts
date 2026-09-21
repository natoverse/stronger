import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CycleProgress, CycleSessionSnapshot, LiftConfig, SetResult } from '../../model/types.ts'
import type { ParsedLogRow } from '../../model/logs.ts'

const state = vi.hoisted(() => ({
	cache: new Map<string, object[]>(),
	commits: [] as Array<Array<{ type: string; path: string; data?: unknown }>>,
	recoveries: [] as object[],
	reject: false,
}))

vi.mock('../client.ts', () => ({ firestore: { path: '' } }))
vi.mock('../offline.ts', () => ({
	readFailedMutationRecoveries: vi.fn(async () => state.recoveries),
	trackMutation: vi.fn(async (_uid, _key, write, options) => {
		if (state.reject) options.onRejected()
		else await write()
	}),
}))
vi.mock('firebase/firestore', () => ({
	doc: (_parent: { path: string }, ...parts: string[]) => ({ path: `${_parent.path}/${parts.join('/')}` }),
	collection: (_parent: { path: string }, name: string) => ({ path: `${_parent.path}/${name}` }),
	documentId: vi.fn(),
	getDocsFromCache: vi.fn(async (ref) => ({
		empty: !(state.cache.get(ref.path)?.length),
		docs: (state.cache.get(ref.path) ?? []).map((data) => ({ data: () => data })),
	})),
	getDocsFromServer: vi.fn(async (ref) => ({
		empty: !(state.cache.get(ref.path)?.length),
		docs: (state.cache.get(ref.path) ?? []).map((data) => ({ data: () => data })),
	})),
	getDocs: vi.fn(),
	getDoc: vi.fn(),
	getDocFromCache: vi.fn(),
	getDocFromServer: vi.fn(),
	query: vi.fn(),
	where: vi.fn(),
	setDoc: vi.fn(async () => undefined),
	writeBatch: () => {
		const operations: Array<{ type: string; path: string; data?: unknown }> = []
		return {
			set: (ref: { path: string }, data: unknown) => operations.push({ type: 'set', path: ref.path, data }),
			update: (ref: { path: string }, data: unknown) => operations.push({ type: 'update', path: ref.path, data }),
			delete: (ref: { path: string }) => operations.push({ type: 'delete', path: ref.path }),
			commit: async () => { state.commits.push(operations) },
		}
	},
}))

import { getDocsFromCache, getDocsFromServer, setDoc } from 'firebase/firestore'
import { trackMutation } from '../offline.ts'
import { clearDraft, loadDraft, saveDraft } from '../../hooks/useWorkoutDraft.ts'
import {
	finishCycleSession, flattenWorkoutSessions, groupWorkoutSessionRows, readCycleDrafts,
	readCycleProgress, writeCycleDraftResults, writeCycleStart, updateLogRows, deleteLogSession,
} from '../store.ts'

const config: LiftConfig = {
	id: 'bench', name: 'Bench', topSetWeight: 180, backoffWeight: 140, trainingMax: 200,
	trainingMaxIncrement: 5, increment: 5, minimumWeight: 45, roundingFactor: 5,
	warmupRoundingFactor: 5, barWeight: 45, gear: 'barbell',
}
const stage = {
	exerciseId: 'main', iterationId: 'iteration-1', iteration: 1, week: 4, weekCount: 4,
	exposure: 1, exposureCount: 1, weekName: 'Deload', exposureName: 'A',
}
const template = {
	liftId: 'bench', name: 'Bench', role: 'primary' as const,
	sets: [{
		setType: 'work' as const, percentage: 0.6, weightBasis: { kind: 'trainingMax' as const },
		minReps: 5, maxReps: 5, amrap: false,
	}],
}
function makeSnapshot(): CycleSessionSnapshot {
	return {
		id: 'session-1', occurrenceId: 'appointment-1',
		workout: {
			id: '531', name: '5/3/1', favorite: false,
			exercises: [{
				liftId: 'bench', name: 'Bench', role: 'primary', cycleStage: stage,
				sets: [{ setType: 'work', weight: 120, minReps: 5, maxReps: 5, amrap: false }],
			}],
		},
		templates: [template],
		progress: {
			workoutId: '531', revision: 1,
			exercises: [{
				exerciseId: 'main', iterationId: 'iteration-1', iteration: 1, cursor: 0,
				baseline: 'trainingMax', complete: false, roundWarmupPlateMath: false,
				configs: [structuredClone(config)], steps: [{ ...stage, template }],
			}],
		},
	}
}
function makeRow(): ParsedLogRow {
	return {
		date: '2026-09-21', startTime: '2026-09-21T10:00:00Z', endTime: '2026-09-21T11:00:00Z',
		workoutId: '531', exerciseName: 'Bench', liftId: 'bench', setNumber: 1, setType: 'work',
		plannedWeight: 120, plannedReps: 5, actualWeight: 125, actualReps: 4, completed: true,
		cycleStage: stage, occurrenceId: 'appointment-1', plannedTemplate: template.sets[0],
	}
}
function next(snapshot: CycleSessionSnapshot): CycleProgress {
	return {
		...snapshot.progress, revision: snapshot.progress.revision + 1, lastSessionId: snapshot.id,
		exercises: snapshot.progress.exercises.map((exercise) => ({ ...exercise, complete: true })),
	}
}

beforeEach(() => {
	state.cache.clear()
	state.commits = []
	state.recoveries = []
	state.reject = false
	vi.clearAllMocks()
	const storage = new Map<string, string>()
	vi.stubGlobal('navigator', { onLine: false })
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
	})
	afterEach(() => vi.unstubAllGlobals())
})

describe('cycle storage', () => {
	it('reads user-scoped progress and frozen drafts cache-first, including durable failed recovery', async () => {
		const snapshot = makeSnapshot()
		state.cache.set('/users/alice/cycleProgress', [snapshot.progress])
		state.cache.set('/users/alice/workoutDrafts', [snapshot])
		expect(await readCycleProgress('alice')).toEqual([snapshot.progress])
		expect(await readCycleProgress('bob')).toEqual([])
		state.recoveries = [{ ...snapshot, results: [], startTime: 'frozen-time' }]
		expect(await readCycleDrafts('alice')).toEqual(state.recoveries)
		await readCycleProgress('alice', 'server')
		expect(getDocsFromServer).toHaveBeenCalledWith({ path: '/users/alice/cycleProgress' })
	})

	it('decodes Firestore-safe result groups into the public results matrix', async () => {
		const snapshot = makeSnapshot()
		const results: SetResult[][] = [[{ actualWeight: 120, actualReps: 5, actualSetType: 'work', completed: true }]]
		state.cache.set('/users/alice/workoutDrafts', [{ ...snapshot, results: results.map((sets) => ({ sets })) }])
		expect((await readCycleDrafts('alice'))[0]).toEqual({ ...snapshot, results })
	})
	it('keeps a newer stored edit over an older failed write for the same session', async () => {
		const snapshot = makeSnapshot()
		state.cache.set('/users/alice/workoutDrafts', [{ ...snapshot, draftVersion: 3 }])
		state.recoveries = [{ ...snapshot, draftVersion: 2 }]
		expect((await readCycleDrafts('alice'))[0].draftVersion).toBe(3)
	})

	it('atomically freezes the start without changing its revision and retries byte-identically', async () => {
		const snapshot = makeSnapshot()
		await writeCycleStart('alice', snapshot)
		await writeCycleStart('alice', snapshot)
		expect(state.commits).toHaveLength(2)
		expect(state.commits[0]).toEqual(state.commits[1])
		expect(state.commits[0]).toEqual([
			{ type: 'set', path: '/users/alice/cycleProgress/531', data: snapshot.progress },
			{ type: 'set', path: '/users/alice/workoutDrafts/531', data: snapshot },
		])
		snapshot.progress.exercises[0].configs[0].trainingMax = 300
		expect((state.commits[0][1].data as CycleSessionSnapshot).progress.exercises[0].configs[0].trainingMax).toBe(200)
		expect(trackMutation).toHaveBeenCalledWith('alice', 'cycleStart:session-1', expect.any(Function), expect.objectContaining({
			receipt: { path: ['users', 'alice', 'workoutDrafts', '531'], field: 'id', value: 'session-1' },
		}))
	})

	it('uses a new revision for a new session even when its frozen iteration is unchanged', async () => {
		const snapshot = makeSnapshot()
		snapshot.progress.revision = 3
		await writeCycleStart('alice', snapshot)
		expect((state.commits[0][0].data as CycleProgress).revision).toBe(3)
		expect((state.commits[0][1].data as CycleSessionSnapshot).progress).toEqual(snapshot.progress)
	})

	it('preserves occurrence, exercise stage, and each planned template through row grouping', () => {
		const row = makeRow()
		const [session] = groupWorkoutSessionRows([row])
		expect(session.occurrenceId).toBe(row.occurrenceId)
		expect(session.exercises[0].cycleStage).toEqual(stage)
		expect(session.exercises[0].sets[0].plannedTemplate).toEqual(template.sets[0])
		expect(flattenWorkoutSessions([session])).toEqual([row])
	})

	it('finishes once in a stable atomic batch with absolute, partial shared-config updates', async () => {
		const snapshot = makeSnapshot()
		const progress = next(snapshot)
		const rows = [makeRow()]
		const updates = new Map([['bench', { trainingMax: 205 }]])
		expect(await finishCycleSession('alice', snapshot, progress, rows, updates, [config])).toEqual(rows)
		await finishCycleSession('alice', snapshot, progress, rows, updates, [config])
		expect(state.commits[0]).toEqual(state.commits[1])
		expect(state.commits[0]).toHaveLength(4)
		const [savedProgress, session, deletedDraft, exercise] = state.commits[0]
		expect(savedProgress).toEqual({ type: 'set', path: '/users/alice/cycleProgress/531', data: progress })
		expect(session.path).toMatch(/^\/users\/alice\/workoutSessions\//)
		expect(session.data).toMatchObject({ cycleSnapshot: snapshot, occurrenceId: 'appointment-1' })
		expect(deletedDraft).toEqual({ type: 'delete', path: '/users/alice/workoutDrafts/531' })
		expect(exercise).toEqual({
			type: 'update', path: '/users/alice/exercises/bench',
			data: {
				trainingMax: 205,
			},
		})
		expect(config.trainingMax).toBe(200)
		expect(snapshot.progress.revision).toBe(1)
		await finishCycleSession('alice', snapshot, progress, [{ ...rows[0], startTime: 'regenerated-time' }], updates, [config])
		expect(state.commits[2][1].path).toBe(session.path)
	})

	it('validates revision, identity, baseline inputs, and rows before queuing anything', async () => {
		const snapshot = makeSnapshot()
		const progress = next(snapshot)
		const rows = [makeRow()]
		await expect(finishCycleSession('alice', snapshot, { ...progress, revision: 3 }, rows, new Map(), []))
			.rejects.toThrow('revision once')
		await expect(finishCycleSession('alice', snapshot, { ...progress, lastSessionId: 'other' }, rows, new Map(), []))
			.rejects.toThrow('session identity')
		await expect(finishCycleSession('alice', snapshot, progress, [], new Map(), []))
			.rejects.toThrow('exactly one')
		await expect(finishCycleSession('alice', snapshot, progress, rows, new Map([['bench', { trainingMax: 205 }]]), []))
			.rejects.toThrow('Missing shared exercise baseline')
		await expect(finishCycleSession('alice', snapshot, progress, rows, new Map([['bench', { trainingMax: NaN }]]), [config]))
			.rejects.toThrow('Invalid shared exercise baseline')
		expect(trackMutation).not.toHaveBeenCalled()
	})

	it('retains actual results and original targets after a late finish rejection, even if the UI cleared its draft', async () => {
		const snapshot = makeSnapshot()
		saveDraft({ workoutId: '531', snapshot, results: [], startTime: 'old' }, 'alice')
		clearDraft('alice', '531')
		state.reject = true
		await finishCycleSession('alice', snapshot, next(snapshot), [makeRow()], new Map(), [config])
		const recovery = loadDraft('alice', '531')
		expect(recovery?.snapshot?.id).toBe(snapshot.id)
		expect(recovery?.snapshot?.workout.exercises[0].sets[0].weight).toBe(120)
		expect(recovery?.results).toEqual([[
			{ actualWeight: 125, actualReps: 4, actualSetType: 'work', completed: true },
		]])
		expect(loadDraft('bob', '531')).toBeNull()
	})

	it('does not replace a newer unfinished local session when an older finish is rejected', async () => {
		const old = makeSnapshot()
		const newer = { ...makeSnapshot(), id: 'session-2' }
		saveDraft({ workoutId: '531', snapshot: newer, results: [], startTime: 'new' }, 'alice')
		state.reject = true
		await finishCycleSession('alice', old, next(old), [makeRow()], new Map(), [config])
		expect(loadDraft('alice', '531')?.snapshot?.id).toBe('session-2')
		expect(trackMutation).toHaveBeenCalledWith('alice', 'cycleFinish:session-1', expect.any(Function), expect.objectContaining({
			recovery: expect.objectContaining({ id: 'session-1' }),
		}))
	})

	it('updates durable results without recomputing or advancing a frozen snapshot', async () => {
		const snapshot = makeSnapshot()
		const results: SetResult[][] = [[{ actualWeight: 123, actualReps: 4, actualSetType: 'work', completed: true }]]
		await writeCycleDraftResults('alice', snapshot, results, 'start-time')
		expect(setDoc).toHaveBeenCalledWith({ path: '/users/alice/workoutDrafts/531' }, {
			...snapshot, results: results.map((sets) => ({ sets })), startTime: 'start-time',
		})
		expect(loadDraft('alice', '531')?.results).toEqual(results)
		expect(loadDraft('alice', '531')?.snapshot?.progress.revision).toBe(1)
	})
	it.each([false, true])('does not replace newer local edits when an older draft write rejects=%s', async (reject) => {
		const snapshot = makeSnapshot()
		const older: SetResult[][] = [[{ actualWeight: 120, actualReps: 3, actualSetType: 'work', completed: false }]]
		const latest: SetResult[][] = [[{ actualWeight: 125, actualReps: 5, actualSetType: 'work', completed: true }]]
		saveDraft({ workoutId: '531', snapshot, results: latest, startTime: 'start-time' }, 'alice')
		state.reject = reject
		await writeCycleDraftResults('alice', snapshot, older, 'start-time')
		expect(loadDraft('alice', '531')?.results).toEqual(latest)
	})
	it.each([false, true])('restores the finished results regardless of rejection order (finish first: %s)', async (finishFirst) => {
		const snapshot = makeSnapshot()
		await writeCycleStart('alice', snapshot)
		saveDraft({ workoutId: '531', snapshot, results: [], startTime: 'start-time' }, 'alice')
		await finishCycleSession('alice', snapshot, next(snapshot), [makeRow()], new Map(), [config])
		clearDraft('alice', '531')
		const calls = vi.mocked(trackMutation).mock.calls
		const order = finishFirst ? [1, 0] : [0, 1]
		for (const index of order) calls[index][3]?.onRejected?.()
		expect(loadDraft('alice', '531')?.results).toEqual([[
			{ actualWeight: 125, actualReps: 4, actualSetType: 'work', completed: true },
		]])
		expect(loadDraft('alice', '531')?.draftVersion).toBe(2)
	})

	it('edits and deletes snapshot-keyed history at its existing stable document ID', async () => {
		const snapshot = makeSnapshot()
		const row = makeRow()
		const ref = { path: '/users/alice/workoutSessions/cycle%3Asession-1' }
		const original = { id: 'cycle%3Asession-1', ref, data: () => ({ ...row, cycleSnapshot: snapshot }) }
		vi.mocked(getDocsFromCache).mockResolvedValueOnce({ docs: [original] } as never)
		await updateLogRows('alice', row.date, row.workoutId, row.startTime, [{ ...row, actualReps: 6 }])
		expect(state.commits[0]).toHaveLength(1)
		expect(state.commits[0][0]).toMatchObject({ type: 'set', path: ref.path })
		vi.mocked(getDocsFromCache).mockResolvedValueOnce({ docs: [original] } as never)
		await deleteLogSession('alice', row.date, row.workoutId, row.startTime)
		expect(setDoc).toHaveBeenCalledWith(ref, expect.objectContaining({ deleted: true }), { merge: true })
	})
})
