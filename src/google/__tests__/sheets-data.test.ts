import { describe, it, expect } from 'vitest';
import { liftConfigToRow, rowToLiftConfig, buildLogRow } from '../sheets.ts';
import type { LiftConfig, ComputedSet, SetResult } from '../../model/types.ts';
import type { LogContext } from '../sheets.ts';

/* ------------------------------------------------------------------ */
/*  liftConfigToRow                                                    */
/* ------------------------------------------------------------------ */

describe('liftConfigToRow', () => {
	const config: LiftConfig = {
		id: 'bench',
		name: 'Bench Press',
		topSetWeight: 200,
		backoffWeight: 170,
		increment: 2.5,
		minimumWeight: 95,
		roundingFactor: 5,
		warmupRoundingFactor: 5,
		barWeight: 45,
		gear: 'barbell',
	};

	it('serializes all ten fields in order', () => {
		const row = liftConfigToRow(config);
		expect(row).toEqual([
			'bench',
			'Bench Press',
			200,
			170,
			2.5,
			95,
			5,
			45,
			'barbell',
			5,
		]);
	});

	it('returns exactly 10 columns', () => {
		expect(liftConfigToRow(config)).toHaveLength(10);
	});
});

/* ------------------------------------------------------------------ */
/*  rowToLiftConfig                                                    */
/* ------------------------------------------------------------------ */

describe('rowToLiftConfig', () => {
	it('parses a string array back into a LiftConfig', () => {
		const row = ['squat', 'Squat', '300', '255', '5', '95', '5', '45', 'barbell', '2.5'];
		const config = rowToLiftConfig(row);
		expect(config).toEqual({
			id: 'squat',
			name: 'Squat',
			topSetWeight: 300,
			backoffWeight: 255,
			increment: 5,
			minimumWeight: 95,
			roundingFactor: 5,
			warmupRoundingFactor: 2.5,
			barWeight: 45,
			gear: 'barbell',
		});
	});

	it('handles decimal values', () => {
		const row = ['press', 'Press', '140', '120', '2.5', '65', '2.5', '45', 'barbell'];
		const config = rowToLiftConfig(row);
		expect(config).not.toBeNull();
		expect(config!.increment).toBe(2.5);
		expect(config!.roundingFactor).toBe(2.5);
	});

	it('round-trips through liftConfigToRow', () => {
		const original: LiftConfig = {
			id: 'deadlift',
			name: 'Deadlift',
			topSetWeight: 350,
			backoffWeight: 300,
			increment: 5,
			minimumWeight: 135,
			roundingFactor: 5,
			warmupRoundingFactor: 5,
			barWeight: 45,
			gear: 'barbell',
		};
		const row = liftConfigToRow(original);
		const parsed = rowToLiftConfig(row.map(String));
		expect(parsed).toEqual(original);
	});

	it('returns null for rows with fewer than 7 columns', () => {
		expect(rowToLiftConfig(['bench', 'Bench'])).toBeNull();
		expect(rowToLiftConfig([])).toBeNull();
	});

	it('returns null when id is empty', () => {
		expect(rowToLiftConfig(['', 'Bench', '200', '170', '2.5', '95', '5'])).toBeNull();
	});

	it('returns null when name is empty', () => {
		expect(rowToLiftConfig(['bench', '', '200', '170', '2.5', '95', '5'])).toBeNull();
	});

	it('returns null when numeric fields are non-numeric', () => {
		expect(rowToLiftConfig(['bench', 'Bench', 'abc', '170', '2.5', '95', '5'])).toBeNull();
		expect(rowToLiftConfig(['bench', 'Bench', '200', '', '2.5', '95', '5'])).toBeNull();
	});

	it('returns null when numeric fields are negative', () => {
		expect(rowToLiftConfig(['bench', 'Bench', '-10', '170', '2.5', '95', '5'])).toBeNull();
	});

	it('accepts zero as a valid numeric value', () => {
		const config = rowToLiftConfig(['bench', 'Bench', '200', '170', '0', '0', '0']);
		expect(config).not.toBeNull();
		expect(config!.increment).toBe(0);
	});

	it('defaults barWeight to 0 and gear to other when columns are absent', () => {
		const config = rowToLiftConfig(['bench', 'Bench', '200', '170', '2.5', '95', '5']);
		expect(config).not.toBeNull();
		expect(config!.barWeight).toBe(0);
		expect(config!.gear).toBe('other');
	});

	it('defaults warmupRoundingFactor to 5 when the column is absent or blank', () => {
		const absent = rowToLiftConfig(['bench', 'Bench', '200', '170', '2.5', '95', '2.5', '45', 'barbell']);
		const blank = rowToLiftConfig(['bench', 'Bench', '200', '170', '2.5', '95', '2.5', '45', 'barbell', '']);
		expect(absent!.warmupRoundingFactor).toBe(5);
		expect(blank!.warmupRoundingFactor).toBe(5);
	});

	it('parses gear type case-insensitively', () => {
		const config = rowToLiftConfig(['bench', 'Bench', '200', '170', '2.5', '95', '5', '45', 'Barbell']);
		expect(config).not.toBeNull();
		expect(config!.gear).toBe('barbell');
	});

	it('defaults unrecognized gear type to other', () => {
		const config = rowToLiftConfig(['bench', 'Bench', '200', '170', '2.5', '95', '5', '45', 'kettlebell']);
		expect(config).not.toBeNull();
		expect(config!.gear).toBe('other');
	});
});

/* ------------------------------------------------------------------ */
/*  buildLogRow                                                        */
/* ------------------------------------------------------------------ */

describe('buildLogRow', () => {
	const ctx: LogContext = {
		date: '2026-04-01',
		startTime: '2026-04-01T18:00:00.000Z',
		endTime: '2026-04-01T19:15:00.000Z',
		workoutId: 'A',
	};

	const planned: ComputedSet = {
		setType: 'work',
		weight: 200,
		minReps: 5,
		maxReps: 5,
		amrap: true,
	};

	const result: SetResult = {
		actualWeight: 200,
		actualReps: 6,
		completed: true,
		actualSetType: 'work',
	};

	it('returns a row with all 13 columns', () => {
		const row = buildLogRow(
			ctx,
			'Primary: Bench Press',
			'bench',
			1,
			'work',
			planned,
			result,
		);
		expect(row).toHaveLength(13);
	});

	it('populates columns in the correct order', () => {
		const row = buildLogRow(
			ctx,
			'Primary: Bench Press',
			'bench',
			3,
			'backoff',
			{ ...planned, setType: 'backoff', weight: 170, maxReps: 8 },
			{ actualWeight: 170, actualReps: 7, completed: true, actualSetType: 'backoff' },
		);
		expect(row).toEqual([
			'2026-04-01',
			'2026-04-01T18:00:00.000Z',
			'2026-04-01T19:15:00.000Z',
			'A',
			'Primary: Bench Press',
			'bench',
			3,
			'backoff',
			170,
			8,
			170,
			7,
			'TRUE',
		]);
	});

	it('writes FALSE for incomplete sets', () => {
		const row = buildLogRow(
			ctx,
			'Primary: Bench Press',
			'bench',
			1,
			'work',
			planned,
			{ ...result, completed: false },
		);
		expect(row[12]).toBe('FALSE');
	});

	it('uses maxReps as plannedReps', () => {
		const rangeSet: ComputedSet = {
			...planned,
			minReps: 5,
			maxReps: 8,
		};
		const row = buildLogRow(
			ctx,
			'Secondary: Squat',
			'squat',
			1,
			'work',
			rangeSet,
			result,
		);
		expect(row[9]).toBe(8); // plannedReps = maxReps
	});

	it('records joker as the set type when overridden', () => {
		const row = buildLogRow(
			ctx,
			'Primary: Bench Press',
			'bench',
			2,
			'joker',
			planned,
			result,
		);
		expect(row[7]).toBe('joker');
	});
});
