import { describe, it, expect } from 'vitest';
import { nameToId, toEditable, fromEditable, moveSet } from '../WorkoutEditor.js';
import type { EditableWorkout } from '../WorkoutEditor.js';
import type { WorkoutDefinition } from '../../data/sample-workouts.js';
import type { LiftConfig, SetTemplate } from '../../model/types.js';

/* ------------------------------------------------------------------ */
/*  nameToId – kebab-case slug generation                              */
/* ------------------------------------------------------------------ */

describe('nameToId', () => {
	it('converts a simple name to kebab-case', () => {
		expect(nameToId('Workout A')).toBe('workout-a');
	});

	it('strips leading and trailing hyphens', () => {
		expect(nameToId('  Workout A  ')).toBe('workout-a');
	});

	it('collapses multiple special characters into a single hyphen', () => {
		expect(nameToId('Bench / Press')).toBe('bench-press');
	});

	it('returns empty string for empty input', () => {
		expect(nameToId('')).toBe('');
	});

	it('handles names with em-dashes and special characters', () => {
		expect(nameToId('Workout A — Bench / Press')).toBe('workout-a-bench-press');
	});

	it('preserves digits', () => {
		expect(nameToId('Phase 2 Workout')).toBe('phase-2-workout');
	});
});

describe('moveSet', () => {
	const sets = [
		{ setType: 'warmup', percentage: 0.5, weightBasis: { kind: 'topSet' }, minReps: 5, maxReps: 5, amrap: false },
		{ setType: 'work', percentage: 1, weightBasis: { kind: 'topSet' }, minReps: 3, maxReps: 3, amrap: true },
		{ setType: 'backoff', percentage: 0.8, weightBasis: { kind: 'topSet' }, minReps: 8, maxReps: 8, amrap: false },
	] satisfies SetTemplate[];

	it('moves a set up without mutating the original list', () => {
		const result = moveSet(sets, 1, 0);

		expect(result.map((set) => set.setType)).toEqual(['work', 'warmup', 'backoff']);
		expect(sets.map((set) => set.setType)).toEqual(['warmup', 'work', 'backoff']);
	});

	it('moves a set down while preserving its data', () => {
		const result = moveSet(sets, 1, 2);

		expect(result[2]).toBe(sets[1]);
		expect(result[2].amrap).toBe(true);
	});

	it('ignores moves beyond the list boundaries', () => {
		expect(moveSet(sets, 0, -1)).toBe(sets);
		expect(moveSet(sets, sets.length - 1, sets.length)).toBe(sets);
	});
});

/* ------------------------------------------------------------------ */
/*  toEditable – WorkoutDefinition → EditableWorkout                   */
/* ------------------------------------------------------------------ */

describe('toEditable', () => {
	it('converts a strength workout definition', () => {
		const def: WorkoutDefinition = {
			id: 'A',
			name: 'Workout A',
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
							comment: 'Test',
						},
					],
				},
			],
		};
		const result = toEditable(def);
		expect(result.id).toBe('A');
		expect(result.name).toBe('Workout A');
		expect(result.exercises).toHaveLength(1);
		expect(result.exercises[0].liftId).toBe('bench');
		expect(result.exercises[0].role).toBe('primary');
		expect(result.exercises[0].sets).toHaveLength(1);
		expect(result.exercises[0].sets[0].comment).toBe('Test');
	});

	it('reads role directly from template', () => {
		const def: WorkoutDefinition = {
			id: 'A',
			name: 'Workout A',
			templates: [
				{
					liftId: 'bench',
					name: 'Bench Press',
					role: 'secondary',
					sets: [{ setType: 'work', percentage: 1.0, weightBasis: { kind: 'topSet' }, minReps: 5, maxReps: 5, amrap: false }],
				},
				{
					liftId: 'curl',
					name: 'Bicep Curl',
					role: 'assistance',
					sets: [{ setType: 'work', percentage: 1.0, weightBasis: { kind: 'topSet' }, minReps: 8, maxReps: 8, amrap: false }],
				},
				{
					liftId: 'squat',
					name: 'Squat',
					role: 'primary',
					sets: [{ setType: 'work', percentage: 1.0, weightBasis: { kind: 'topSet' }, minReps: 5, maxReps: 5, amrap: false }],
				},
			],
		};
		const result = toEditable(def);
		expect(result.exercises[0].role).toBe('secondary');
		expect(result.exercises[1].role).toBe('assistance');
		expect(result.exercises[2].role).toBe('primary');
	});
});

/* ------------------------------------------------------------------ */
/*  fromEditable – EditableWorkout → WorkoutDefinition                 */
/* ------------------------------------------------------------------ */

describe('fromEditable', () => {
	const configs: LiftConfig[] = [
		{ id: 'bench', name: 'Bench Press', topSetWeight: 200, backoffWeight: 170, increment: 2.5, minimumWeight: 95, roundingFactor: 5, warmupRoundingFactor: 5, barWeight: 45, gear: 'barbell' },
		{ id: 'squat', name: 'Squat', topSetWeight: 300, backoffWeight: 255, increment: 5, minimumWeight: 95, roundingFactor: 5, warmupRoundingFactor: 5, barWeight: 45, gear: 'barbell' },
	];

	it('converts a strength workout back to a definition', () => {
		const editable: EditableWorkout = {
			id: 'A',
			name: 'Workout A',
			exercises: [
				{
					liftId: 'bench',
					role: 'primary',
					sets: [
						{ setType: 'work', percentage: 1.0, weightBasis: { kind: 'topSet' }, minReps: 5, maxReps: 5, amrap: true },
					],
				},
			],
		};
		const result = fromEditable(editable, configs);
		expect(result.id).toBe('A');
		expect(result.name).toBe('Workout A');
		expect(result.templates).toHaveLength(1);
		expect(result.templates[0].liftId).toBe('bench');
		expect(result.templates[0].name).toBe('Bench Press');
		expect(result.templates[0].role).toBe('primary');
		expect(result.templates[0].sets).toHaveLength(1);
	});

	it('derives exercise display name from role and lift name', () => {
		const editable: EditableWorkout = {
			id: 'X',
			name: 'Test',
			exercises: [
				{ liftId: 'squat', role: 'secondary', sets: [{ setType: 'work', percentage: 0.85, weightBasis: { kind: 'topSet' }, minReps: 5, maxReps: 5, amrap: false }] },
			],
		};
		const result = fromEditable(editable, configs);
		expect(result.templates[0].name).toBe('Squat');
		expect(result.templates[0].role).toBe('secondary');
	});

	it('falls back to liftId when lift name not found in configs', () => {
		const editable: EditableWorkout = {
			id: 'X',
			name: 'Test',
			exercises: [
				{ liftId: 'unknown-lift', role: 'assistance', sets: [{ setType: 'work', percentage: 1.0, weightBasis: { kind: 'topSet' }, minReps: 8, maxReps: 8, amrap: false }] },
			],
		};
		const result = fromEditable(editable, configs);
		expect(result.templates[0].name).toBe('unknown-lift');
		expect(result.templates[0].role).toBe('assistance');
	});

	it('preserves set comments through round-trip', () => {
		const def: WorkoutDefinition = {
			id: 'A',
			name: 'Workout A',
			templates: [
				{
					liftId: 'bench',
					name: 'Bench Press',
					role: 'primary',
					sets: [
						{ setType: 'work', percentage: 1.0, weightBasis: { kind: 'topSet' }, minReps: 3, maxReps: 5, amrap: true, comment: 'If 5 reps, increase' },
					],
				},
			],
		};
		const editable = toEditable(def);
		const result = fromEditable(editable, configs);
		expect(result.templates[0].sets[0].comment).toBe('If 5 reps, increase');
	});
});
