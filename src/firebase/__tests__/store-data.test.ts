import { describe, expect, it, vi } from 'vitest'

vi.mock('../client.ts', () => ({ firestore: {} }))

import {
	flattenWorkoutSessions,
	flattenScheduleDays,
	flattenYearBuckets,
	groupScheduleEntries,
	groupWorkoutSessionRows,
	groupYearBuckets,
	mergeDateWindowEntries,
	mergeYearScopedEntries,
	mergeWorkoutSessionRows,
	rowToParsedLogRow,
	scheduleDayDocumentId,
} from '../store.ts'

describe('Firestore data identifiers', () => {
	it('groups workout sessions into yearly buckets', () => {
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
		const sessions = groupWorkoutSessionRows([
			first!,
			second!,
			{ ...first!, date: '2025-12-31', startTime: '2025-12-31T10:00:00Z' },
		])
		const buckets = groupYearBuckets(sessions)

		expect(buckets.map((bucket) => bucket.period)).toEqual(['2025', '2026'])
		expect(buckets.map((bucket) => bucket.count)).toEqual([1, 1])
		expect(flattenYearBuckets(buckets)).toEqual(sessions.reverse())
	})

	it('replaces only the requested year scope when background data arrives', () => {
		const current = [
			{ date: '2025-12-31', value: 'old-prior' },
			{ date: '2026-01-01', value: 'current' },
			{ date: '2027-01-01', value: 'future' },
		]

		expect(mergeYearScopedEntries(
			current,
			[{ date: '2026-02-01', value: 'new-current' }],
			'currentYear',
			'2026',
		)).toEqual([
			{ date: '2025-12-31', value: 'old-prior' },
			{ date: '2026-02-01', value: 'new-current' },
			{ date: '2027-01-01', value: 'future' },
		])

		expect(mergeYearScopedEntries(
			current,
			[
				{ date: '2024-01-01', value: 'older' },
				{ date: '2025-12-31', value: 'new-prior' },
				{ date: '2027-01-01', value: 'new-future' },
			],
			'otherYears',
			'2026',
		)).toEqual([
			{ date: '2024-01-01', value: 'older' },
			{ date: '2025-12-31', value: 'new-prior' },
			{ date: '2026-01-01', value: 'current' },
			{ date: '2027-01-01', value: 'new-future' },
		])
	})

	it('merges only the loaded calendar date window', () => {
		const existing = [
			{ date: '2026-09-01', value: 'before' },
			{ date: '2026-09-15', value: 'stale' },
			{ date: '2026-11-01', value: 'after' },
		]
		const loaded = [
			{ date: '2026-09-20', value: 'fresh' },
		]

		expect(mergeDateWindowEntries(existing, loaded, {
			startDate: '2026-09-02',
			endDate: '2026-11-01',
		})).toEqual([
			{ date: '2026-09-01', value: 'before' },
			{ date: '2026-09-20', value: 'fresh' },
			{ date: '2026-11-01', value: 'after' },
		])
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

	it('replaces one saved workout session without duplicating history', () => {
		const base = {
			date: '2026-08-29',
			startTime: '2026-08-29T10:00:00Z',
			endTime: '2026-08-29T11:00:00Z',
			workoutId: 'A',
			exerciseName: 'Bench',
			liftId: 'bench',
			setNumber: 1,
			setType: 'work',
			plannedWeight: 100,
			plannedReps: 5,
			actualWeight: 100,
			actualReps: 5,
			completed: true,
		}
		const prior = { ...base, date: '2025-12-31', startTime: '2025-12-31T10:00:00Z' }
		const updated = { ...base, actualWeight: 105 }

		expect(mergeWorkoutSessionRows([prior, base], [updated])).toEqual([prior, updated])
	})

	it('groups and restores ordered schedule events by day', () => {
		const entries = [
			{ date: '2026-08-29', workoutId: 'A', strongerId: 's-fixed' },
			{ date: '2026-08-29', workoutId: 'cardio:hike', label: 'Angel Rest' },
			{ date: '2026-08-30', workoutId: 'B' },
		]
		const days = groupScheduleEntries(entries)

		expect(days).toHaveLength(2)
		expect(scheduleDayDocumentId(days[0])).toBe('2026-08-29')
		expect(days[0].events).toEqual([
			{ workoutId: 'A', strongerId: 's-fixed' },
			{ workoutId: 'cardio:hike', label: 'Angel Rest' },
		])
		expect(flattenScheduleDays(days)).toEqual(entries)
	})
})
