import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
	docsByCollection: new Map<string, Array<{ id: string; ref: { path: string } }>>(),
	commits: [] as Array<Array<{ type: string; path: string; data?: object }>>,
}))

vi.mock('firebase/firestore', () => ({
	collection: vi.fn((parent: { path: string }, name: string) => ({ path: `${parent.path}/${name}` })),
	doc: vi.fn((parent: { path: string }, ...parts: string[]) => ({ path: `${parent.path}/${parts.join('/')}` })),
	documentId: vi.fn(() => '__name__'),
	getDoc: vi.fn(),
	getDocs: vi.fn(async (ref: { path: string }) => ({
		docs: mockState.docsByCollection.get(ref.path) ?? [],
	})),
	query: vi.fn((ref: { path: string }) => ref),
	runTransaction: vi.fn(),
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

import type { WorkoutDefinition } from '../../data/sample-workouts.ts'
import { writeDefaultWorkoutDefs } from '../store.ts'

const defaultWorkout: WorkoutDefinition = {
	id: 'A',
	name: 'Default A',
	templates: [],
	favorite: false,
}

describe('Firestore default seeding writes', () => {
	beforeEach(() => {
		mockState.docsByCollection.clear()
		mockState.commits.length = 0
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

	it('refuses to import default workouts over existing workouts', async () => {
		mockState.docsByCollection.set('firestore/users/user-1/workouts', [
			{ id: 'custom', ref: { path: 'firestore/users/user-1/workouts/custom' } },
		])

		await expect(writeDefaultWorkoutDefs('user-1', [defaultWorkout]))
			.rejects.toThrow('Existing workouts were found, so nothing was changed')

		expect(mockState.commits).toEqual([])
	})
})
