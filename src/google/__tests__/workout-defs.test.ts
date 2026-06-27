import { describe, it, expect } from 'vitest';
import {
	encodeWeightBasis,
	decodeWeightBasis,
	workoutDefsToRows,
	parseWorkoutDefRow,
	rowsToWorkoutDefs,
} from '../sheets.ts';
import type { WeightBasis, SetTemplate } from '../../model/types.ts';
import type { WorkoutDefinition } from '../../data/sample-workouts.ts';
import { workoutDefinitions, defaultLiftConfigs, buildWorkoutsFromConfigs } from '../../data/sample-workouts.ts';

/**
 * Assert that a parsed row is a valid strength row
 * and narrow the type for subsequent assertions.
 */
function expectStrengthRow(result: ReturnType<typeof parseWorkoutDefRow>) {
	expect(result).not.toBeNull();
	const r = result!;
	expect('set' in r).toBe(true);
	if (!('set' in r)) throw new Error('expected strength row');
	return r;
}

/* ------------------------------------------------------------------ */
/*  encodeWeightBasis                                                  */
/* ------------------------------------------------------------------ */

describe('encodeWeightBasis', () => {
	it('encodes topSet', () => {
		expect(encodeWeightBasis({ kind: 'topSet' })).toBe('topSet');
	});

	it('encodes backoff', () => {
		expect(encodeWeightBasis({ kind: 'backoff' })).toBe('backoff');
	});

	it('encodes crossReference', () => {
		expect(encodeWeightBasis({ kind: 'crossReference', liftId: 'press' })).toBe(
			'crossReference:press',
		);
	});

	it('encodes fixed', () => {
		expect(encodeWeightBasis({ kind: 'fixed', weight: 45 })).toBe('fixed:45');
	});

	it('encodes fixed with decimal', () => {
		expect(encodeWeightBasis({ kind: 'fixed', weight: 22.5 })).toBe('fixed:22.5');
	});

	it('encodes barWeight', () => {
		expect(encodeWeightBasis({ kind: 'barWeight' })).toBe('barWeight');
	});

	it('encodes relative to top set with a negative offset', () => {
		expect(
			encodeWeightBasis({ kind: 'relative', reference: 'topSet', offset: -20 }),
		).toBe('relative:topSet:-20');
	});

	it('encodes relative to backoff with a positive offset', () => {
		expect(
			encodeWeightBasis({ kind: 'relative', reference: 'backoff', offset: 10 }),
		).toBe('relative:backoff:10');
	});
});

/* ------------------------------------------------------------------ */
/*  decodeWeightBasis                                                  */
/* ------------------------------------------------------------------ */

describe('decodeWeightBasis', () => {
	it('decodes topSet', () => {
		expect(decodeWeightBasis('topSet')).toEqual({ kind: 'topSet' });
	});

	it('decodes backoff', () => {
		expect(decodeWeightBasis('backoff')).toEqual({ kind: 'backoff' });
	});

	it('decodes crossReference', () => {
		expect(decodeWeightBasis('crossReference:press')).toEqual({
			kind: 'crossReference',
			liftId: 'press',
		});
	});

	it('decodes fixed', () => {
		expect(decodeWeightBasis('fixed:45')).toEqual({ kind: 'fixed', weight: 45 });
	});

	it('decodes fixed with decimal', () => {
		expect(decodeWeightBasis('fixed:22.5')).toEqual({ kind: 'fixed', weight: 22.5 });
	});

	it('decodes barWeight', () => {
		expect(decodeWeightBasis('barWeight')).toEqual({ kind: 'barWeight' });
	});

	it('returns null for unknown format', () => {
		expect(decodeWeightBasis('unknown')).toBeNull();
	});

	it('returns null for empty crossReference liftId', () => {
		expect(decodeWeightBasis('crossReference:')).toBeNull();
	});

	it('returns null for invalid fixed weight', () => {
		expect(decodeWeightBasis('fixed:abc')).toBeNull();
	});

	it('returns null for negative fixed weight', () => {
		expect(decodeWeightBasis('fixed:-10')).toBeNull();
	});

	it('decodes relative to top set with a negative offset', () => {
		expect(decodeWeightBasis('relative:topSet:-20')).toEqual({
			kind: 'relative',
			reference: 'topSet',
			offset: -20,
		});
	});

	it('decodes relative to backoff with a positive offset', () => {
		expect(decodeWeightBasis('relative:backoff:10')).toEqual({
			kind: 'relative',
			reference: 'backoff',
			offset: 10,
		});
	});

	it('returns null for relative with an unknown reference', () => {
		expect(decodeWeightBasis('relative:bogus:5')).toBeNull();
	});

	it('returns null for relative with a non-numeric offset', () => {
		expect(decodeWeightBasis('relative:topSet:abc')).toBeNull();
	});

	it('returns null for relative missing the offset', () => {
		expect(decodeWeightBasis('relative:topSet')).toBeNull();
	});

	it('handles whitespace around value', () => {
		expect(decodeWeightBasis('  topSet  ')).toEqual({ kind: 'topSet' });
	});

	it('round-trips all variants', () => {
		const cases: WeightBasis[] = [
			{ kind: 'topSet' },
			{ kind: 'backoff' },
			{ kind: 'crossReference', liftId: 'bench' },
			{ kind: 'fixed', weight: 45 },
			{ kind: 'barWeight' },
			{ kind: 'relative', reference: 'topSet', offset: -20 },
			{ kind: 'relative', reference: 'backoff', offset: 10 },
		];
		for (const wb of cases) {
			expect(decodeWeightBasis(encodeWeightBasis(wb))).toEqual(wb);
		}
	});
});

/* ------------------------------------------------------------------ */
/*  workoutDefsToRows                                                  */
/* ------------------------------------------------------------------ */

describe('workoutDefsToRows', () => {
	const minimalDef: WorkoutDefinition = {
		id: 'X',
		name: 'Test Workout',
		templates: [
			{
				liftId: 'bench',
				name: 'Bench Press',
				role: 'primary',
				sets: [
					{
						setType: 'work',
						percentage: 1.0,
						weightBasis: { kind: 'topSet' },
						minReps: 5,
						maxReps: 5,
						amrap: true,
						comment: 'Test comment',
					},
				],
			},
		],
	};

	it('produces one row per set', () => {
		const rows = workoutDefsToRows([minimalDef]);
		expect(rows).toHaveLength(1);
	});

	it('produces 13 columns per row', () => {
		const rows = workoutDefsToRows([minimalDef]);
		expect(rows[0]).toHaveLength(13);
	});

	it('populates columns in correct order', () => {
		const rows = workoutDefsToRows([minimalDef]);
		expect(rows[0]).toEqual([
			'X',             // workoutId
			'Test Workout',  // workoutName
			1,               // exerciseOrder
			'primary',       // exerciseRole
			'bench',         // liftId
			'work',          // setType
			1.0,             // percentage
			'topSet',        // weightBasis
			5,               // minReps
			5,               // maxReps
			'TRUE',          // amrap
			'Test comment',  // comment
			'FALSE',         // favorite
		]);
	});

	it('writes FALSE for non-amrap sets', () => {
		const def: WorkoutDefinition = {
			...minimalDef,
			templates: [
				{
					...minimalDef.templates[0],
					sets: [{ ...minimalDef.templates[0].sets[0], amrap: false }],
				},
			],
		};
		const rows = workoutDefsToRows([def]);
		expect(rows[0][10]).toBe('FALSE');
	});

	it('writes empty string for missing comment', () => {
		const set: SetTemplate = { ...minimalDef.templates[0].sets[0] };
		delete (set as Partial<SetTemplate>).comment;
		const def: WorkoutDefinition = {
			...minimalDef,
			templates: [{ ...minimalDef.templates[0], sets: [set] }],
		};
		const rows = workoutDefsToRows([def]);
		expect(rows[0][11]).toBe('');
	});

	it('serializes the full default workout definitions', () => {
		const rows = workoutDefsToRows(workoutDefinitions);
		// Count total sets across all workouts
		let totalSets = 0;
		for (const def of workoutDefinitions) {
			for (const tpl of def.templates) {
				totalSets += tpl.sets.length;
			}
		}
		expect(rows).toHaveLength(totalSets);
	});
});

/* ------------------------------------------------------------------ */
/*  parseWorkoutDefRow                                                 */
/* ------------------------------------------------------------------ */

describe('parseWorkoutDefRow', () => {
	const validRow = [
		'A', 'Workout A — Bench / Squat', '1', 'primary', 'bench',
		'work', '1.0', 'topSet', '5', '5', 'TRUE', 'Test comment',
	];

	it('parses a valid row', () => {
		const result = expectStrengthRow(parseWorkoutDefRow(validRow));
		expect(result.workoutId).toBe('A');
		expect(result.workoutName).toBe('Workout A — Bench / Squat');
		expect(result.exerciseOrder).toBe(1);
		expect(result.exerciseRole).toBe('primary');
		expect(result.liftId).toBe('bench');
		expect(result.favorite).toBe(false);
		expect(result.set.setType).toBe('work');
		expect(result.set.percentage).toBe(1.0);
		expect(result.set.weightBasis).toEqual({ kind: 'topSet' });
		expect(result.set.minReps).toBe(5);
		expect(result.set.maxReps).toBe(5);
		expect(result.set.amrap).toBe(true);
		expect(result.set.comment).toBe('Test comment');
	});

	it('returns null for rows with fewer than 11 columns', () => {
		expect(parseWorkoutDefRow(['A', 'B', '1', 'primary', 'bench'])).toBeNull();
	});

	it('returns null for empty workoutId', () => {
		expect(parseWorkoutDefRow(['', ...validRow.slice(1)])).toBeNull();
	});

	it('returns null for invalid exerciseOrder', () => {
		const row = [...validRow];
		row[2] = 'abc';
		expect(parseWorkoutDefRow(row)).toBeNull();
	});

	it('returns null for zero exerciseOrder', () => {
		const row = [...validRow];
		row[2] = '0';
		expect(parseWorkoutDefRow(row)).toBeNull();
	});

	it('returns null for invalid setType', () => {
		const row = [...validRow];
		row[5] = 'invalid';
		expect(parseWorkoutDefRow(row)).toBeNull();
	});

	it('parses joker as a valid setType', () => {
		const row = [...validRow];
		row[5] = 'joker';
		const result = expectStrengthRow(parseWorkoutDefRow(row));
		expect(result.set.setType).toBe('joker');
	});

	it('returns null for invalid weightBasis', () => {
		const row = [...validRow];
		row[7] = 'unknown';
		expect(parseWorkoutDefRow(row)).toBeNull();
	});

	it('returns null when minReps > maxReps', () => {
		const row = [...validRow];
		row[8] = '10';
		row[9] = '5';
		expect(parseWorkoutDefRow(row)).toBeNull();
	});

	it('parses FALSE amrap correctly', () => {
		const row = [...validRow];
		row[10] = 'FALSE';
		const result = expectStrengthRow(parseWorkoutDefRow(row));
		expect(result.set.amrap).toBe(false);
	});

	it('omits comment when empty', () => {
		const row = [...validRow];
		row[11] = '';
		const result = expectStrengthRow(parseWorkoutDefRow(row));
		expect(result.set.comment).toBeUndefined();
	});

	it('handles row with exactly 11 columns (no comment)', () => {
		const row = validRow.slice(0, 11);
		const result = expectStrengthRow(parseWorkoutDefRow(row));
		expect(result.set.comment).toBeUndefined();
	});
});

/* ------------------------------------------------------------------ */
/*  rowsToWorkoutDefs                                                  */
/* ------------------------------------------------------------------ */

describe('rowsToWorkoutDefs', () => {
	it('groups rows by workoutId into separate definitions', () => {
		const parsed = [
			{ workoutId: 'A', workoutName: 'WA', exerciseOrder: 1, exerciseRole: 'primary', liftId: 'bench', favorite: false, set: { setType: 'work' as const, percentage: 1.0, weightBasis: { kind: 'topSet' } as const, minReps: 5, maxReps: 5, amrap: true } },
			{ workoutId: 'B', workoutName: 'WB', exerciseOrder: 1, exerciseRole: 'primary', liftId: 'squat', favorite: false, set: { setType: 'work' as const, percentage: 1.0, weightBasis: { kind: 'topSet' } as const, minReps: 5, maxReps: 5, amrap: true } },
		];
		const defs = rowsToWorkoutDefs(parsed);
		expect(defs).toHaveLength(2);
		expect(defs[0].id).toBe('A');
		expect(defs[1].id).toBe('B');
	});

	it('groups by exerciseOrder within a workout', () => {
		const parsed = [
			{ workoutId: 'A', workoutName: 'WA', exerciseOrder: 1, exerciseRole: 'primary', liftId: 'bench', favorite: false, set: { setType: 'warmup' as const, percentage: 0.5, weightBasis: { kind: 'topSet' } as const, minReps: 5, maxReps: 5, amrap: false } },
			{ workoutId: 'A', workoutName: 'WA', exerciseOrder: 1, exerciseRole: 'primary', liftId: 'bench', favorite: false, set: { setType: 'work' as const, percentage: 1.0, weightBasis: { kind: 'topSet' } as const, minReps: 5, maxReps: 5, amrap: true } },
			{ workoutId: 'A', workoutName: 'WA', exerciseOrder: 2, exerciseRole: 'secondary', liftId: 'squat', favorite: false, set: { setType: 'work' as const, percentage: 0.85, weightBasis: { kind: 'topSet' } as const, minReps: 5, maxReps: 5, amrap: false } },
		];
		const defs = rowsToWorkoutDefs(parsed);
		expect(defs).toHaveLength(1);
		expect(defs[0].templates).toHaveLength(2);
		expect(defs[0].templates[0].sets).toHaveLength(2);
		expect(defs[0].templates[1].sets).toHaveLength(1);
	});

	it('derives exercise display name from role + liftId when no liftNames', () => {
		const parsed = [
			{ workoutId: 'A', workoutName: 'WA', exerciseOrder: 1, exerciseRole: 'primary', liftId: 'bench', favorite: false, set: { setType: 'work' as const, percentage: 1.0, weightBasis: { kind: 'topSet' } as const, minReps: 5, maxReps: 5, amrap: true } },
		];
		const defs = rowsToWorkoutDefs(parsed);
		expect(defs[0].templates[0].name).toBe('bench');
	});

	it('derives exercise display name from role + lift name when liftNames provided', () => {
		const parsed = [
			{ workoutId: 'A', workoutName: 'WA', exerciseOrder: 1, exerciseRole: 'primary', liftId: 'bench', favorite: false, set: { setType: 'work' as const, percentage: 1.0, weightBasis: { kind: 'topSet' } as const, minReps: 5, maxReps: 5, amrap: true } },
		];
		const liftNames = new Map([['bench', 'Bench Press']]);
		const defs = rowsToWorkoutDefs(parsed, liftNames);
		expect(defs[0].templates[0].name).toBe('Bench Press');
	});

	it('sorts exercises by exerciseOrder', () => {
		const parsed = [
			{ workoutId: 'A', workoutName: 'WA', exerciseOrder: 3, exerciseRole: 'assistance', liftId: 'curl', favorite: false, set: { setType: 'work' as const, percentage: 1.0, weightBasis: { kind: 'topSet' } as const, minReps: 10, maxReps: 15, amrap: false } },
			{ workoutId: 'A', workoutName: 'WA', exerciseOrder: 1, exerciseRole: 'primary', liftId: 'bench', favorite: false, set: { setType: 'work' as const, percentage: 1.0, weightBasis: { kind: 'topSet' } as const, minReps: 5, maxReps: 5, amrap: true } },
			{ workoutId: 'A', workoutName: 'WA', exerciseOrder: 2, exerciseRole: 'secondary', liftId: 'squat', favorite: false, set: { setType: 'work' as const, percentage: 0.85, weightBasis: { kind: 'topSet' } as const, minReps: 5, maxReps: 5, amrap: false } },
		];
		const defs = rowsToWorkoutDefs(parsed);
		expect(defs[0].templates[0].liftId).toBe('bench');
		expect(defs[0].templates[1].liftId).toBe('squat');
		expect(defs[0].templates[2].liftId).toBe('curl');
	});

	it('preserves workout order from row order', () => {
		const parsed = [
			{ workoutId: 'C', workoutName: 'WC', exerciseOrder: 1, exerciseRole: 'primary', liftId: 'press', favorite: false, set: { setType: 'work' as const, percentage: 1.0, weightBasis: { kind: 'topSet' } as const, minReps: 5, maxReps: 5, amrap: true } },
			{ workoutId: 'A', workoutName: 'WA', exerciseOrder: 1, exerciseRole: 'primary', liftId: 'bench', favorite: false, set: { setType: 'work' as const, percentage: 1.0, weightBasis: { kind: 'topSet' } as const, minReps: 5, maxReps: 5, amrap: true } },
		];
		const defs = rowsToWorkoutDefs(parsed);
		expect(defs[0].id).toBe('C');
		expect(defs[1].id).toBe('A');
	});
});

/* ------------------------------------------------------------------ */
/*  Round-trip: workoutDefinitions → rows → parse → defs               */
/* ------------------------------------------------------------------ */

describe('workout defs round-trip', () => {
	it('round-trips the default workout definitions', () => {
		const liftNames = new Map(defaultLiftConfigs.map((c) => [c.id, c.name]));
		const rows = workoutDefsToRows(workoutDefinitions);
		const parsed = rows
			.map((r) => parseWorkoutDefRow(r.map(String)))
			.filter((r) => r !== null);
		const defs = rowsToWorkoutDefs(parsed!, liftNames);

		expect(defs).toHaveLength(workoutDefinitions.length);

		for (let wi = 0; wi < workoutDefinitions.length; wi++) {
			const orig = workoutDefinitions[wi];
			const rt = defs[wi];
			expect(rt.id).toBe(orig.id);
			expect(rt.name).toBe(orig.name);
			expect(rt.templates).toHaveLength(orig.templates.length);

			for (let ei = 0; ei < orig.templates.length; ei++) {
				const origTpl = orig.templates[ei];
				const rtTpl = rt.templates[ei];
				expect(rtTpl.liftId).toBe(origTpl.liftId);
				expect(rtTpl.name).toBe(origTpl.name);
				expect(rtTpl.sets).toHaveLength(origTpl.sets.length);

				for (let si = 0; si < origTpl.sets.length; si++) {
					const origSet = origTpl.sets[si];
					const rtSet = rtTpl.sets[si];
					expect(rtSet.setType).toBe(origSet.setType);
					expect(rtSet.percentage).toBe(origSet.percentage);
					expect(rtSet.weightBasis).toEqual(origSet.weightBasis);
					expect(rtSet.minReps).toBe(origSet.minReps);
					expect(rtSet.maxReps).toBe(origSet.maxReps);
					expect(rtSet.amrap).toBe(origSet.amrap);
					expect(rtSet.comment).toBe(origSet.comment);
				}
			}
		}
	});

	it('round-tripped defs produce identical computed workouts', () => {
		const liftNames = new Map(defaultLiftConfigs.map((c) => [c.id, c.name]));
		const rows = workoutDefsToRows(workoutDefinitions);
		const parsed = rows
			.map((r) => parseWorkoutDefRow(r.map(String)))
			.filter((r) => r !== null);
		const defs = rowsToWorkoutDefs(parsed!, liftNames);

		const origWorkouts = buildWorkoutsFromConfigs(defaultLiftConfigs, workoutDefinitions);
		const rtWorkouts = buildWorkoutsFromConfigs(defaultLiftConfigs, defs);

		expect(rtWorkouts).toEqual(origWorkouts);
	});
});
