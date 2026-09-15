import { describe, it, expect } from 'vitest';
import { buildLogRow, findPreviousWorkoutSets } from '../logs.ts';
import type { ParsedLogRow } from '../logs.ts';

/* ------------------------------------------------------------------ */
/*  buildLogRow                                                        */
/* ------------------------------------------------------------------ */

describe('buildLogRow', () => {
	it.each([true, false])('preserves planned and actual values with completed=%s', (completed) => {
		const ctx = {
			date: '2026-03-28',
			startTime: '2026-03-28T18:00:00.000Z',
			endTime: '2026-03-28T19:15:00.000Z',
			workoutId: 'A',
		};
		const planned = { setType: 'work' as const, weight: 200, minReps: 3, maxReps: 5, amrap: true };
		const result = { actualWeight: 205, actualReps: 6, actualSetType: 'joker' as const, completed };
		expect(buildLogRow(ctx, 'Primary: Bench Press', 'bench', 2, result.actualSetType, planned, result)).toEqual({
			...ctx,
			exerciseName: 'Primary: Bench Press',
			liftId: 'bench',
			setNumber: 2,
			setType: 'joker',
			plannedWeight: 200,
			plannedReps: 5,
			actualWeight: 205,
			actualReps: 6,
			completed,
		});
	});

	it('keeps zero weights and reps for bodyweight or unfinished sets', () => {
		const ctx = { date: '2026-03-28', startTime: 'start', endTime: 'end', workoutId: 'A' };
		const planned = { setType: 'work' as const, weight: 0, minReps: 5, maxReps: 10, amrap: false };
		const result = { actualWeight: 0, actualReps: 0, actualSetType: 'work' as const, completed: false };
		expect(buildLogRow(ctx, 'Push-Up', 'push-up', 1, 'work', planned, result)).toMatchObject({
			plannedWeight: 0,
			plannedReps: 10,
			actualWeight: 0,
			actualReps: 0,
			completed: false,
		});
	});
});

/* ------------------------------------------------------------------ */
/*  findPreviousWorkoutSets                                            */
/* ------------------------------------------------------------------ */

describe('findPreviousWorkoutSets', () => {
	function makeRow(overrides: Partial<ParsedLogRow> = {}): ParsedLogRow {
		return {
			date: '2026-03-28',
			startTime: '2026-03-28T18:00:00.000Z',
			endTime: '2026-03-28T19:15:00.000Z',
			workoutId: 'A',
			exerciseName: 'Primary: Bench Press',
			liftId: 'bench',
			setNumber: 1,
			setType: 'work',
			plannedWeight: 200,
			plannedReps: 5,
			actualWeight: 200,
			actualReps: 6,
			completed: true,
			...overrides,
		};
	}

	it('returns null when no rows match the workout ID', () => {
		const rows = [makeRow({ workoutId: 'B' })];
		expect(findPreviousWorkoutSets(rows, 'A')).toBeNull();
	});

	it('returns null for empty row array', () => {
		expect(findPreviousWorkoutSets([], 'A')).toBeNull();
	});

	it('returns sets from the most recent session', () => {
		const olderSession = [
			makeRow({ startTime: '2026-03-21T18:00:00.000Z', setNumber: 1, actualWeight: 185, actualReps: 5 }),
			makeRow({ startTime: '2026-03-21T18:00:00.000Z', setNumber: 2, actualWeight: 185, actualReps: 4 }),
		];
		const newerSession = [
			makeRow({ startTime: '2026-03-28T18:00:00.000Z', setNumber: 1, actualWeight: 200, actualReps: 6 }),
			makeRow({ startTime: '2026-03-28T18:00:00.000Z', setNumber: 2, actualWeight: 200, actualReps: 5 }),
		];
		const result = findPreviousWorkoutSets([...olderSession, ...newerSession], 'A');
		expect(result).toEqual([
			[
				{ weight: 200, reps: 6 },
				{ weight: 200, reps: 5 },
			],
		]);
	});

	it('groups sets by exercise, preserving exercise order', () => {
		const rows = [
			makeRow({ exerciseName: 'Primary: Bench Press', setNumber: 1, actualWeight: 200, actualReps: 5 }),
			makeRow({ exerciseName: 'Primary: Bench Press', setNumber: 2, actualWeight: 200, actualReps: 5 }),
			makeRow({ exerciseName: 'Secondary: Squat', setNumber: 1, actualWeight: 300, actualReps: 3 }),
			makeRow({ exerciseName: 'Secondary: Squat', setNumber: 2, actualWeight: 255, actualReps: 5 }),
		];
		const result = findPreviousWorkoutSets(rows, 'A');
		expect(result).toEqual([
			[
				{ weight: 200, reps: 5 },
				{ weight: 200, reps: 5 },
			],
			[
				{ weight: 300, reps: 3 },
				{ weight: 255, reps: 5 },
			],
		]);
	});

	it('sorts sets by setNumber within each exercise', () => {
		const rows = [
			makeRow({ setNumber: 3, actualWeight: 180, actualReps: 8 }),
			makeRow({ setNumber: 1, actualWeight: 200, actualReps: 5 }),
			makeRow({ setNumber: 2, actualWeight: 190, actualReps: 5 }),
		];
		const result = findPreviousWorkoutSets(rows, 'A');
		expect(result).toEqual([
			[
				{ weight: 200, reps: 5 },
				{ weight: 190, reps: 5 },
				{ weight: 180, reps: 8 },
			],
		]);
	});

	it('filters by workout ID and ignores other workouts', () => {
		const rows = [
			makeRow({ workoutId: 'A', exerciseName: 'Bench', setNumber: 1, actualWeight: 200, actualReps: 5 }),
			makeRow({ workoutId: 'B', exerciseName: 'Squat', setNumber: 1, actualWeight: 300, actualReps: 3 }),
		];
		const result = findPreviousWorkoutSets(rows, 'A');
		expect(result).toEqual([
			[{ weight: 200, reps: 5 }],
		]);
	});

	it('handles a single set in a single exercise', () => {
		const rows = [makeRow({ actualWeight: 135, actualReps: 10 })];
		const result = findPreviousWorkoutSets(rows, 'A');
		expect(result).toEqual([
			[{ weight: 135, reps: 10 }],
		]);
	});

	it('handles multiple exercises with varying set counts', () => {
		const rows = [
			makeRow({ exerciseName: 'Bench', setNumber: 1, actualWeight: 200, actualReps: 5 }),
			makeRow({ exerciseName: 'Bench', setNumber: 2, actualWeight: 200, actualReps: 5 }),
			makeRow({ exerciseName: 'Bench', setNumber: 3, actualWeight: 200, actualReps: 4 }),
			makeRow({ exerciseName: 'Curl', setNumber: 1, actualWeight: 30, actualReps: 12 }),
		];
		const result = findPreviousWorkoutSets(rows, 'A');
		expect(result).toHaveLength(2);
		expect(result![0]).toHaveLength(3);
		expect(result![1]).toHaveLength(1);
	});
});
