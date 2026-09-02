import { describe, expect, it, vi } from 'vitest'

vi.mock('../client.ts', () => ({ firestore: {} }))

import {
	flattenWorkoutSessions,
	groupWorkoutSessionRows,
	rowToParsedLogRow,
	scheduleDocumentId,
	workoutSessionDocumentId,
} from '../store.ts'

describe('Firestore data identifiers', () => {
	it('creates stable, distinct workout session document IDs', () => {
		const first = rowToParsedLogRow([
			'2026-08-29', '2026-08-29T10:00:00Z', '2026-08-29T11:00:00Z',
			'A', 'Bench Press', 'bench-press', 1, 'work', 200, 5, 205, 5, 'TRUE',
		])
		const second = rowToParsedLogRow([
			'2026-08-29', '2026-08-29T10:00:00Z', '2026-08-29T11:00:00Z',
			'A', 'Close Grip Bench', 'bench-press', 1, 'work', 150, 8, 150, 8, 'TRUE',
		])

		expect(first).not.toBeNull()
		expect(second).not.toBeNull()
		expect(workoutSessionDocumentId(first!)).toBe(workoutSessionDocumentId(second!))
		expect(workoutSessionDocumentId(first!)).toBe(workoutSessionDocumentId({ ...first! }))
		expect(workoutSessionDocumentId(first!))
			.not.toBe(workoutSessionDocumentId({ ...first!, workoutId: 'B' }))
	})

	it('parses completed flags and numeric set values', () => {
		const row = rowToParsedLogRow([
			'2026-08-29', 'start', 'end', 'A', 'Squat', 'squat',
			2, 'backoff', 180, 8, 185, 9, 'false',
		])

		expect(row).toMatchObject({
			setNumber: 2,
			actualWeight: 185,
			actualReps: 9,
			completed: false,
		})
	})

	it('groups and restores ordered exercises and sets', () => {
		const base = {
			date: '2026-08-29',
			startTime: '2026-08-29T10:00:00Z',
			endTime: '2026-08-29T11:00:00Z',
			workoutId: 'A',
			liftId: '',
			setNumber: 1,
			setType: 'work',
			plannedWeight: 100,
			plannedReps: 5,
			actualWeight: 100,
			actualReps: 5,
			completed: true,
		}
		const rows = [
			{ ...base, exerciseName: 'First', setNumber: 1 },
			{ ...base, exerciseName: 'First', setNumber: 2 },
			{ ...base, exerciseName: 'Second', setNumber: 1 },
			{ ...base, exerciseName: 'First', setNumber: 1, actualWeight: 110 },
		]
		const sessions = groupWorkoutSessionRows(rows)

		expect(sessions).toHaveLength(1)
		expect(sessions[0].exercises.map((exercise) => exercise.exerciseName))
			.toEqual(['First', 'Second', 'First'])
		expect(sessions[0].exercises[0].sets).toHaveLength(2)
		expect(flattenWorkoutSessions(sessions)).toEqual(rows)
	})

	it('uses Stronger IDs when available and stable source fields otherwise', () => {
		expect(scheduleDocumentId({
			date: '2026-08-29',
			workoutId: 'A',
			strongerId: 's-fixed',
		})).toContain('s-fixed')
		expect(scheduleDocumentId({
			date: '2026-08-29',
			workoutId: 'cardio:hike',
			label: 'Angel Rest',
		})).toBe(scheduleDocumentId({
			date: '2026-08-29',
			workoutId: 'cardio:hike',
			label: 'Angel Rest',
		}))
	})
})
