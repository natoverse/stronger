import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
	WorkoutEditor, nameToId, toEditable, fromEditable, moveSet, moveItem,
	copyWeek, updateWeekExercises, validateEditableWorkout,
	previewExposure, weightBasisLabel,
} from '../WorkoutEditor.js';
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

	describe('cycle editor', () => {
		const config: LiftConfig = {
			id: 'bench', name: 'Bench Press', topSetWeight: 200, backoffWeight: 170, increment: 5,
			trainingMax: 200, trainingMaxIncrement: 10, minimumWeight: 45, roundingFactor: 5,
			warmupRoundingFactor: 5, barWeight: 45, gear: 'barbell',
		};
		const set: SetTemplate = {
			setType: 'work', percentage: 0.7, weightBasis: { kind: 'topSet' },
			minReps: 8, maxReps: 8, amrap: false,
		};
		function definition(): WorkoutDefinition {
			return {
				id: 'cycle', name: 'Three-week cycle', favorite: true, templates: [],
				cycle: {
					baseline: 'topSet',
					weeks: [
						{ id: 'week-1', name: 'Volume', exposures: [
							{ id: 'session-1', name: 'A', templates: [{ id: 'bench-main', name: 'Bench', liftId: 'bench', role: 'primary', sets: Array.from({ length: 3 }, () => structuredClone(set)) }] },
						] },
						{ id: 'week-2', name: 'Strength', exposures: [
							{ id: 'session-3', name: 'A', templates: [{ id: 'bench-main', name: 'Bench', liftId: 'bench', role: 'primary', sets: Array.from({ length: 4 }, () => ({ ...structuredClone(set), percentage: 0.75, minReps: 6, maxReps: 6 })) }] },
						] },
						{ id: 'week-3', name: 'Peak', exposures: [
							{ id: 'session-4', name: 'A', templates: [{ id: 'bench-main', name: 'Bench', liftId: 'bench', role: 'primary', sets: Array.from({ length: 3 }, () => ({ ...structuredClone(set), percentage: 0.8, minReps: 5, maxReps: 5 })) }] },
						] },
					],
				},
			};
		}

		it('normalizes ordinary definitions into a single independently editable week', () => {
			const legacy = { id: 'legacy', name: 'Legacy', templates: definition().cycle!.weeks[0].exposures[0].templates };
			const draft = toEditable(legacy);
			expect(draft.cycle?.baseline).toBe('topSet');
			expect(draft.cycle?.weeks).toHaveLength(1);
			expect(draft.cycle?.weeks[0].exposures).toHaveLength(1);
			draft.exercises[0].sets[0].weightBasis = { kind: 'fixed', weight: 123 };
			expect(legacy.templates[0].sets[0].weightBasis).toEqual({ kind: 'topSet' });
		});

		it('preserves every stage, ordered variable set counts, reps and identities on save', () => {
			const source = definition();
			const result = fromEditable(toEditable(source), [config], source);
			expect(result.favorite).toBe(true);
			expect(result.cycle?.weeks.map((week) => week.exposures[0].templates[0].sets.length)).toEqual([3, 4, 3]);
			expect(result.cycle?.weeks.map((week) => week.exposures[0].templates[0].sets[0].minReps)).toEqual([8, 6, 5]);
			expect(result.cycle?.weeks.map((week) => week.exposures[0].templates[0].sets[0].percentage)).toEqual([0.7, 0.75, 0.8]);
			expect(result.cycle?.weeks.every((week) => week.exposures.length === 1)).toBe(true);
			expect(result.cycle?.weeks[1].exposures[0].templates[0].id).toBe('bench-main');
			expect(result.templates).toEqual(result.cycle?.weeks[0].exposures[0].templates);
			expect(result.templates).not.toBe(result.cycle?.weeks[0].exposures[0].templates);
		});

		it('flattens legacy sessions into independently editable weeks without losing prescriptions', () => {
			const source = definition();
			const extra = structuredClone(source.cycle!.weeks[0].exposures[0]);
			extra.id = 'light'; extra.name = 'Light';
			extra.templates[0].sets[0].percentage = 0.5;
			source.cycle!.weeks[0].exposures.push(extra);
			const before = structuredClone(source);
			const draft = toEditable(source);
			const saved = fromEditable(draft, [config], source);
			expect(draft.cycle!.weeks.map((week) => week.exposures.length)).toEqual([1, 1, 1, 1]);
			expect(saved.cycle!.weeks.map((week) => week.exposures[0].templates[0].sets[0].percentage))
				.toEqual([0.7, 0.5, 0.75, 0.8]);
			expect(saved.cycle!.weeks.every((week) => week.exposures[0].templates[0].id === 'bench-main')).toBe(true);
			expect(validateEditableWorkout(draft, [config])).toEqual([]);
			expect(toEditable(saved)).toEqual(draft);
			expect(source).toEqual(before);
		});

		it('edits a selected later week without changing the first week or source', () => {
			const source = definition();
			const draft = toEditable(source);
			const edited = updateWeekExercises(draft, 1, (exercises) => exercises.map((exercise) => ({
				...exercise, sets: [{ ...exercise.sets[0], percentage: 0.6, amrap: true }],
			})));
			const saved = fromEditable(edited, [config]);
			expect(saved.cycle?.weeks[1].exposures[0].templates[0].sets[0].percentage).toBe(0.6);
			expect(saved.templates[0].sets[0].percentage).toBe(0.7);
			expect(draft.cycle?.weeks[1].exposures[0].exercises[0].sets[0].percentage).toBe(0.75);
			expect(source.cycle?.weeks[1].exposures[0].templates[0].sets[0].amrap).toBe(false);
		});

		it('copies weeks deeply with new stage IDs and retained exercise identity', () => {
			const source = toEditable(definition()).cycle!.weeks[0];
			const copied = copyWeek(source);
			expect(copied.id).not.toBe(source.id);
			expect(copied.exposures[0].id).not.toBe(source.exposures[0].id);
			expect(copied.exposures).toHaveLength(1);
			expect(copied.exposures[0].exercises[0].id).toBe('bench-main');
			copied.exposures[0].exercises[0].sets[0].weightBasis.kind = 'trainingMax';
			copied.exposures[0].exercises[0].sets[0].percentage = 0.95;
			expect(source.exposures[0].exercises[0].sets[0].weightBasis.kind).toBe('topSet');
			expect(source.exposures[0].exercises[0].sets[0].percentage).toBe(0.7);
		});

		it('matches copied prescriptions to existing exercises without linking to the source cycle', () => {
			const destination = toEditable(definition());
			const source = structuredClone(destination.cycle!.weeks[0]);
			for (const exposure of source.exposures) exposure.exercises[0].id = 'another-cycle-bench';
			const copy = copyWeek(source, destination);
			expect(copy.exposures.map((exposure) => exposure.exercises[0].id)).toEqual(['bench-main']);
			copy.exposures[0].exercises[0].sets[0].percentage = 0.9;
			expect(source.exposures[0].exercises[0].sets[0].percentage).toBe(0.7);
			expect(destination.exercises[0].sets[0].percentage).toBe(0.7);
		});

		it('reorders weeks without mutating them and mirrors the new first workout', () => {
			const draft = toEditable(definition());
			const originalWeeks = draft.cycle!.weeks;
			draft.cycle!.weeks = moveItem(draft.cycle!.weeks, 2, 0);
			const saved = fromEditable(draft, [config]);
			expect(saved.cycle?.weeks.map((week) => week.id)).toEqual(['week-3', 'week-1', 'week-2']);
			expect(saved.templates[0].sets[0].percentage).toBe(0.8);
			expect(originalWeeks.map((week) => week.id)).toEqual(['week-1', 'week-2', 'week-3']);
		});

		it('previews any stage using its own percentages without mutating the draft', () => {
			const draft = toEditable(definition());
			const before = structuredClone(draft);
			const weights = draft.cycle!.weeks.map((week) => previewExposure(week.exposures[0], [config])[0].sets.map((set) => set.weight));
			expect(weights).toEqual([[140, 140, 140], [150, 150, 150, 150], [160, 160, 160]]);
			expect(draft).toEqual(before);
		});
		it('reserves deleted cycle IDs without blocking edits to the existing cycle', () => {
			const def = definition();
			const props = {
				allDefinitions: [], reservedIds: [def.id], configs: [config],
				onSave: () => {}, onCancel: () => {},
			};
			const recreated = renderToStaticMarkup(createElement(WorkoutEditor, { ...props, initialDefinition: def }));
			expect(recreated).toContain('is already in use');
			expect(recreated).toMatch(/class="btn-finish" disabled=""/);
			const editing = renderToStaticMarkup(createElement(WorkoutEditor, { ...props, existing: def }));
			expect(editing).not.toContain('is already in use');
			expect(editing).not.toMatch(/class="btn-finish" disabled=""/);
		});

		it('previews configured rounding and floors while keeping fixed/bar weights exact', () => {
			const exposure = toEditable(definition()).cycle!.weeks[0].exposures[0];
			exposure.exercises[0].sets = [
				{ ...set, setType: 'warmup', percentage: 0.5 },
				{ ...set, weightBasis: { kind: 'fixed', weight: 12 } },
				{ ...set, weightBasis: { kind: 'barWeight' } },
			];
			expect(previewExposure(exposure, [config])[0].sets.map((set) => set.weight)).toEqual([100, 12, 45]);
			expect(previewExposure(exposure, [config], true)[0].sets.map((set) => set.weight)).toEqual([95, 12, 45]);
			expect(previewExposure(exposure, [{ ...config, minimumWeight: 105 }], true)[0].sets.map((set) => set.weight)).toEqual([105, 12, 45]);
		});

		it('never silently drops unresolved lifts or cross-referenced sets from preview', () => {
			const exposure = toEditable(definition()).cycle!.weeks[0].exposures[0];
			expect(() => previewExposure(exposure, [])).toThrow('available lift');
			exposure.exercises[0].sets[0].weightBasis = { kind: 'crossReference', liftId: 'missing' };
			expect(() => previewExposure(exposure, [config])).toThrow('weight basis');
		});

		it('preserves 5/3/1 independent TM percentages, targets, AMRAP and deload', () => {
			const percentages = [[0.65, 0.75, 0.85], [0.7, 0.8, 0.9], [0.75, 0.85, 0.95], [0.4, 0.5, 0.6]];
			const targets = [[5, 5, 5], [3, 3, 3], [5, 3, 1], [5, 5, 5]];
			const draft = toEditable(definition());
			draft.cycle!.baseline = 'trainingMax';
			draft.cycle!.weeks = percentages.map((values, wi) => ({
				id: `week-${wi}`, name: `Week ${wi + 1}`, exposures: [{
					id: `session-${wi}`, name: 'Main', exercises: [{
						id: 'bench-main', liftId: 'bench', role: 'primary',
						sets: values.map((percentage, si) => ({
							...set, percentage, minReps: targets[wi][si], maxReps: targets[wi][si],
							weightBasis: { kind: 'trainingMax' }, amrap: wi < 3 && si === 2,
						})),
					}],
				}],
			}));
			expect(validateEditableWorkout(draft, [config])).toEqual([]);
			const saved = fromEditable(draft, [config]);
			expect(saved.cycle?.baseline).toBe('trainingMax');
			saved.cycle!.weeks.forEach((week, wi) => {
				const sets = week.exposures[0].templates[0].sets;
				expect(sets.map((set) => set.percentage)).toEqual(percentages[wi]);
				expect(sets.map((set) => set.minReps)).toEqual(targets[wi]);
				expect(sets.map((set) => set.amrap)).toEqual([false, false, wi < 3]);
				expect(sets.every((set) => set.weightBasis.kind === 'trainingMax')).toBe(true);
			});
			expect(weightBasisLabel(saved.templates[0].sets[0], [config])).toBe('65% of Training Max (TM)');
		});

		it('validates all stages rather than only the selected or compatibility templates', () => {
			const draft = toEditable(definition());
			draft.cycle!.weeks[2].exposures[0].exercises[0].sets = [];
			expect(validateEditableWorkout(draft, [config])).toContain('Week 3, exercise 1: add at least one set');
		});

		it.each([
			['unnamed workout', (draft: EditableWorkout) => { draft.name = ' '; }, 'Workout name'],
			['zero weeks', (draft: EditableWorkout) => { draft.cycle!.weeks = []; }, 'Add at least one week'],
			['unnamed week', (draft: EditableWorkout) => { draft.cycle!.weeks[0].name = ''; }, 'enter a name'],
			['empty week', (draft: EditableWorkout) => { draft.cycle!.weeks[0].exposures = []; }, 'exactly one workout'],
			['multiple workouts in a week', (draft: EditableWorkout) => { draft.cycle!.weeks[0].exposures.push(structuredClone(draft.cycle!.weeks[0].exposures[0])); }, 'exactly one workout'],
			['empty workout', (draft: EditableWorkout) => { draft.cycle!.weeks[0].exposures[0].exercises = []; }, 'add at least one exercise'],
			['missing lift', (draft: EditableWorkout) => { draft.exercises[0].liftId = 'missing'; }, 'available lift'],
		] as const)('rejects %s with an actionable error', (_, change, message) => {
			const draft = toEditable(definition());
			change(draft);
			expect(validateEditableWorkout(draft, [config]).join(' ')).toContain(message);
		});

		it('does not require an internal legacy session name that cannot be edited', () => {
			const draft = toEditable(definition());
			draft.cycle!.weeks[0].exposures[0].name = '';
			expect(validateEditableWorkout(draft, [config])).toEqual([]);
		});

		it.each([
			[{ minReps: 0 }, 'positive whole-number reps'],
			[{ minReps: 2.5 }, 'positive whole-number reps'],
			[{ minReps: 9, maxReps: 8 }, 'positive whole-number reps'],
			[{ maxReps: Infinity }, 'positive whole-number reps'],
			[{ percentage: 0 }, 'percentage'],
			[{ percentage: NaN }, 'percentage'],
			[{ percentage: Infinity }, 'percentage'],
			[{ weightBasis: { kind: 'fixed', weight: -1 } }, 'fixed weight'],
			[{ weightBasis: { kind: 'fixed', weight: NaN } }, 'fixed weight'],
			[{ weightBasis: { kind: 'relative', reference: 'topSet', offset: Infinity } }, 'finite weight offset'],
			[{ weightBasis: { kind: 'crossReference', liftId: 'missing' } }, 'cross-reference lift'],
		] satisfies [Partial<SetTemplate>, string][])('rejects invalid set fields %j', (patch, message) => {
			const draft = toEditable(definition());
			Object.assign(draft.cycle!.weeks[2].exposures[0].exercises[0].sets[0], patch);
			expect(validateEditableWorkout(draft, [config]).join(' ')).toContain(message);
		});

		it('does not require TM for ordinary workouts or percentages on nonpercentage bases', () => {
			const draft = toEditable(definition());
			draft.exercises[0].sets = [
				{ ...set, percentage: 0, weightBasis: { kind: 'fixed', weight: 0 } },
				{ ...set, percentage: 0, weightBasis: { kind: 'barWeight' } },
				{ ...set, percentage: 0, weightBasis: { kind: 'relative', reference: 'backoff', offset: -20 } },
			];
			expect(validateEditableWorkout(draft, [{ ...config, trainingMax: undefined, trainingMaxIncrement: undefined }])).toEqual([]);
		});

		it.each([0, -10, NaN, Infinity])('requires a positive finite explicit TM when a set uses TM (%s)', (trainingMax) => {
			const draft = toEditable(definition());
			draft.exercises[0].sets[0].weightBasis = { kind: 'trainingMax' };
			expect(validateEditableWorkout(draft, [{ ...config, trainingMax }]).join(' ')).toContain('Training Max (TM) for Bench Press in Exercises');
		});

		it('validates explicit TM increments and accepts the default or explicit zero', () => {
			const draft = toEditable(definition());
			draft.exercises[0].sets[0].weightBasis = { kind: 'trainingMax' };
			expect(validateEditableWorkout(draft, [{ ...config, trainingMaxIncrement: undefined }])).toEqual([]);
			draft.cycle!.baseline = 'trainingMax';
			expect(validateEditableWorkout(draft, [{ ...config, trainingMaxIncrement: undefined }])).toEqual([]);
			for (const trainingMaxIncrement of [-5, NaN, Infinity]) {
				expect(validateEditableWorkout(draft, [{ ...config, trainingMaxIncrement }]).join(' ')).toContain('nonnegative TM increment');
			}
			expect(validateEditableWorkout(draft, [{ ...config, trainingMaxIncrement: 0 }])).toEqual([]);
		});
		it('saves and previews TM prescriptions without requiring explicit TM fields', () => {
			const draft = toEditable(definition());
			draft.cycle!.baseline = 'trainingMax';
			draft.exercises[0].sets[0].weightBasis = { kind: 'trainingMax' };
			const legacy = { ...config, trainingMax: undefined, trainingMaxIncrement: undefined, topSetWeight: 200 };
			expect(validateEditableWorkout(draft, [legacy])).toEqual([]);
			expect(previewExposure(draft.cycle!.weeks[0].exposures[0], [legacy])[0].sets[0].weight).toBe(140);
			expect(validateEditableWorkout(draft, [{ ...legacy, topSetWeight: 0 }]).join(' ')).toContain('positive Training Max');
		});

		it('leaves non-TM assistance valid under TM policy and requires no increment for TM warmups', () => {
			const draft = toEditable(definition());
			draft.cycle!.baseline = 'trainingMax';
			expect(validateEditableWorkout(draft, [{ ...config, trainingMax: undefined, trainingMaxIncrement: undefined }])).toEqual([]);
			draft.exercises[0].sets[0].weightBasis = { kind: 'trainingMax' };
			draft.exercises[0].sets[0].setType = 'warmup';
			expect(validateEditableWorkout(draft, [{ ...config, trainingMaxIncrement: undefined }])).toEqual([]);
		});

		it('renders stage editing, preview and TM basis without manual progression actions', () => {
			const markup = renderToStaticMarkup(createElement(WorkoutEditor, {
				existing: definition(), allDefinitions: [], configs: [config], onSave: () => {}, onCancel: () => {},
			}));
			for (const text of ['Progression baseline', 'Training Max (TM)', 'Duplicate week', 'Copy week from', 'Preview week', 'Pending prescriptions and unfinished sessions stay frozen', 'Each program week contains one workout', 'Use separate cycles for additional weekly workouts']) {
				expect(markup).toContain(text);
			}
			expect(markup).not.toMatch(/Within-week|Session name|Add session|Duplicate session|Copy session|Move session|Delete session|Preview session/);
			expect(markup).not.toMatch(/>Start (?:run|cycle)<|>Advance|>Finish cycle</i);
		});
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
