import { describe, expect, it, vi } from 'vitest'

vi.mock('../client.ts', () => ({ firestore: {} }))

import { logDocumentId, rowToParsedLogRow, scheduleDocumentId } from '../store.ts'

describe('Firestore data identifiers', () => {
	it('creates stable, distinct log document IDs', () => {
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
		expect(logDocumentId(first!)).not.toBe(logDocumentId(second!))
		expect(logDocumentId(first!)).toBe(logDocumentId({ ...first! }))
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
