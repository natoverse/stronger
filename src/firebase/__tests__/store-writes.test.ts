import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
	docsByCollection: new Map<string, Array<{ id: string; ref: { path: string } }>>(),
	existingDocPaths: new Set<string>(),
	commits: [] as Array<Array<{ type: string; path: string; data?: object }>>,
}))

vi.mock('firebase/firestore', () => ({
	collection: vi.fn((parent: { path: string }, name: string) => ({ path: `${parent.path}/${name}` })),
	doc: vi.fn((parent: { path: string }, ...parts: string[]) => ({ path: `${parent.path}/${parts.join('/')}` })),
	documentId: vi.fn(() => '__name__'),
	getDoc: vi.fn(),
	getDocFromCache: vi.fn(async (ref: { path: string }) => ({
		exists: () => mockState.existingDocPaths.has(ref.path),
	})),
	getDocFromServer: vi.fn(),
	getDocs: vi.fn(async (ref: { path: string }) => ({
		docs: mockState.docsByCollection.get(ref.path) ?? [],
	})),
	getDocsFromCache: vi.fn(),
	getDocsFromServer: vi.fn(),
	query: vi.fn((ref: { path: string }) => ref),
	runTransaction: vi.fn(async (_firestore: unknown, update: (transaction: {
		get: (ref: { path: string }) => Promise<{ exists: () => boolean }>;
		set: (ref: { path: string }, data: object) => void;
	}) => Promise<void>) => {
		const operations: Array<{ type: string; path: string; data?: object }> = []
		await update({
			get: async (ref) => ({ exists: () => mockState.existingDocPaths.has(ref.path) }),
			set: (ref, data) => operations.push({ type: 'set', path: ref.path, data }),
		})
		if (operations.length > 0) mockState.commits.push(operations)
	}),
	setDoc: vi.fn(),
	where: vi.fn(),
	writeBatch: vi.fn(() => {
		const operations: Array<{ type: string; path: string; data?: object }> = []
		return {
			set: vi.fn((ref: { path: string }, data: object) => operations.push({ type: 'set', path: ref.path, data })),
			delete: vi.fn((ref: { path: string }) => operations.push({ type: 'delete', path: ref.path })),
			commit: vi.fn(async () => {
				mockState.commits.push(operations)
			}),
		}
	}),
}))

vi.mock('../client.ts', () => ({ firestore: { path: 'firestore' } }))
vi.mock('../offline.ts', () => ({
	trackMutation: vi.fn(async (_uid: string, _key: string, write: () => Promise<unknown>) => write()),
}))
vi.mock('../../google/auth.ts', () => ({
	authorizeCalendar: vi.fn(),
	clearAuth: vi.fn(),
}))

import type { WorkoutDefinition } from '../../data/sample-workouts.ts'
import { buildLogRow } from '../../model/logs.ts'
import { authorizeCalendar, clearAuth } from '../../google/auth.ts'
import { trackMutation } from '../offline.ts'
import { appendLogRows, writeDefaultWorkoutDefs } from '../store.ts'

const defaultWorkout: WorkoutDefinition = {
	id: 'A',
	name: 'Default A',
	templates: [],
	favorite: false,
}

describe('Firestore default seeding writes', () => {
	beforeEach(() => {
		mockState.docsByCollection.clear()
		mockState.existingDocPaths.clear()
		mockState.commits.length = 0
	})

	describe('Firestore workout session writes', () => {
		const row = buildLogRow(
			{
				date: '2026-09-15',
				startTime: '2026-09-15T10:00:00Z',
				endTime: '2026-09-15T11:00:00Z',
				workoutId: 'A',
			},
			'Bench Press',
			'bench-press',
			1,
			'work',
			{ setType: 'work', weight: 200, minReps: 3, maxReps: 5, amrap: false },
			{ actualSetType: 'work', actualWeight: 205, actualReps: 4, completed: true },
		)

		beforeEach(() => {
			mockState.commits.length = 0
			vi.mocked(trackMutation).mockClear()
			vi.mocked(authorizeCalendar).mockClear()
			vi.mocked(clearAuth).mockClear()
		})

		it('queues typed workout records using the existing stable session schema', async () => {
			const saved = await appendLogRows('user-1', [row])

			expect(saved).toEqual([row])
			expect(trackMutation).toHaveBeenCalledWith('user-1', expect.stringContaining('workoutSessions:'), expect.any(Function))
			expect(mockState.commits).toHaveLength(1)
			expect(mockState.commits[0]).toEqual([{
				type: 'set',
				path: expect.stringMatching(/^firestore\/users\/user-1\/workoutSessions\/.+/),
				data: {
					date: row.date,
					startTime: row.startTime,
					endTime: row.endTime,
					workoutId: 'A',
					year: '2026',
					updatedAt: expect.any(String),
					exercises: [{
						liftId: 'bench-press',
						exerciseName: 'Bench Press',
						sets: [{
							setNumber: 1,
							setType: 'work',
							plannedWeight: 200,
							plannedReps: 5,
							actualWeight: 205,
							actualReps: 4,
							completed: true,
						}],
					}],
				},
			}])
		})

		it.each(['permission-denied', 'unauthenticated'])('preserves %s errors without invoking Calendar auth', async (code) => {
			const error = Object.assign(new Error('Firebase operation failed'), { code })
			vi.mocked(trackMutation).mockRejectedValueOnce(error)

			await expect(appendLogRows('user-1', [row])).rejects.toBe(error)
			expect(trackMutation).toHaveBeenCalledTimes(1)
			expect(mockState.commits).toEqual([])
			expect(authorizeCalendar).not.toHaveBeenCalled()
			expect(clearAuth).not.toHaveBeenCalled()
		})
	})

	it('writes default workouts when the workout library is empty', async () => {
		mockState.docsByCollection.set('firestore/users/user-1/workouts', [])

		await writeDefaultWorkoutDefs('user-1', [defaultWorkout])

		expect(mockState.commits).toHaveLength(1)
		expect(mockState.commits[0]).toEqual([
			expect.objectContaining({
				type: 'set',
				path: 'firestore/users/user-1/workouts/A',
				data: expect.objectContaining({ id: 'A', name: 'Default A' }),
			}),
		])
	})

	it('adds default workouts without replacing existing workouts', async () => {
		mockState.docsByCollection.set('firestore/users/user-1/workouts', [
			{ id: 'custom', ref: { path: 'firestore/users/user-1/workouts/custom' } },
		])

		await writeDefaultWorkoutDefs('user-1', [defaultWorkout])

		expect(mockState.commits).toHaveLength(1)
		expect(mockState.commits[0]).toEqual([
			expect.objectContaining({
				type: 'set',
				path: 'firestore/users/user-1/workouts/A',
			}),
		])
	})

	it('refuses to overwrite a workout document with the generated import ID', async () => {
		mockState.docsByCollection.set('firestore/users/user-1/workouts', [])
		mockState.existingDocPaths.add('firestore/users/user-1/workouts/A')

		await expect(writeDefaultWorkoutDefs('user-1', [defaultWorkout]))
			.rejects.toThrow('Default workouts import generated an existing document ID')

		expect(mockState.commits).toEqual([])
	})
})
