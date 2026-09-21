import { describe, expect, it } from 'vitest';
import type { WorkoutDefinition } from '../../data/sample-workouts.js';
import { createCycleSession, exerciseCompleted, finishCycle, normalizeCycle, previewCycles, validateCycle } from '../cycles.js';
import { computeSetWeight } from '../compute.js';
import { findPreviousWorkoutSets, buildLogRow } from '../logs.js';
import type { CycleProgress, CycleSessionSnapshot, ExerciseTemplate, LiftConfig, SetResult, SetTemplate } from '../types.js';

const bench: LiftConfig = {
	id: 'bench', name: 'Bench', topSetWeight: 150, backoffWeight: 100, increment: 2.5,
	trainingMax: 200, trainingMaxIncrement: 5, minimumWeight: 45, roundingFactor: 5,
	warmupRoundingFactor: 10, barWeight: 45, gear: 'barbell',
};
const squat: LiftConfig = { ...bench, id: 'squat', name: 'Squat', trainingMax: 300, trainingMaxIncrement: 10 };
const set = (percentage: number, reps: number, amrap = false): SetTemplate => ({
	setType: 'work', percentage, minReps: reps, maxReps: reps, amrap, weightBasis: { kind: 'trainingMax' },
});
const tables = [
	[set(.65, 5), set(.75, 5), set(.85, 5, true)],
	[set(.70, 3), set(.80, 3), set(.90, 3, true)],
	[set(.75, 5), set(.85, 3), set(.95, 1, true)],
	[set(.40, 5), set(.50, 5), set(.60, 5)],
];
const definition = (): WorkoutDefinition => ({
	id: '531', name: '5/3/1', templates: [],
	cycle: {
		baseline: 'trainingMax',
		weeks: tables.map((sets, index) => ({
			id: `w${index}`, name: ['5s', '3s', '5/3/1', 'Deload'][index],
			exposures: [{ id: `s${index}`, name: 'Main lifts', templates: [bench, squat].map((config) => ({
				id: config.id, liftId: config.id, name: config.name, role: 'primary', sets: structuredClone(sets),
			})) }],
		})),
	},
});
let id = 0;
const ids = () => `identity-${++id}`;
const start = (def = definition(), configs = [bench, squat], progress?: CycleProgress) =>
	createCycleSession(def, configs, progress, {}, ids);
const completed = (snapshot: CycleSessionSnapshot): SetResult[][] => snapshot.workout.exercises.map((exercise) =>
	exercise.sets.map((s) => ({ actualWeight: s.weight, actualReps: s.minReps, actualSetType: s.setType, completed: true })));

describe('classic four-week training max cycle', () => {
	it('computes all twelve percentages/reps and keeps independent lift TMs through deload', () => {
		const expected = [[130, 150, 170], [140, 160, 180], [150, 170, 190], [80, 100, 120]];
		const expectedSquat = [[195, 225, 255], [210, 240, 270], [225, 255, 285], [120, 150, 180]];
		let progress: CycleProgress | undefined;
		for (let week = 0; week < 4; week++) {
			const snapshot = start(definition(), [bench, squat], progress);
			expect(snapshot.workout.exercises[0].sets.map((s) => s.weight)).toEqual(expected[week]);
			expect(snapshot.workout.exercises[1].sets.map((s) => s.weight)).toEqual(expectedSquat[week]);
			expect(snapshot.workout.exercises[0].sets.map((s) => [s.minReps, s.maxReps, s.amrap]))
				.toEqual(tables[week].map((s) => [s.minReps, s.maxReps, s.amrap]));
			expect(snapshot.workout.exercises[0].cycleStage).toMatchObject({ week: week + 1, weekCount: 4, iteration: 1 });
			const results = completed(snapshot);
			// Completing a failed set is still completing an exposure, not a TM gate.
			results[0][2].actualReps = 0;
			results[0][2].actualWeight = 999;
			const finish = finishCycle(snapshot, results);
			expect(finish.proposals).toEqual([]);
			expect(finish.trainingMaxProposals).toHaveLength(week === 3 ? 2 : 0);
			if (week === 3) {
				expect(finish.trainingMaxProposals.map((p) => p.proposed)).toEqual([205, 310]);
				expect(finish.progress.exercises.every((item) => item.complete)).toBe(true);
			}
			progress = finish.progress;
		}
		const next = start(definition(), [{ ...bench, trainingMax: 205 }, { ...squat, trainingMax: 310 }], progress);
		expect(next.workout.exercises[0].cycleStage).toMatchObject({ week: 1, iteration: 2 });
		expect(next.progress.exercises[0].configs[0].trainingMax).toBe(205);
	});

	it('keeps skipped/partial exercises at their whole pending stage independently', () => {
		const first = start();
		const results = completed(first);
		results[1][1].completed = false;
		const finish = finishCycle(first, results);
		expect(finish.progress.exercises.map((item) => item.cursor)).toEqual([1, 0]);
		const next = start(definition(), [bench, squat], finish.progress);
		expect(next.workout.exercises.map((exercise) => exercise.cycleStage?.week)).toEqual([2, 1]);
		expect(next.workout.exercises[1].sets.map((s) => s.weight)).toEqual([195, 225, 255]);
		expect(finish.transitions[1]).toMatchObject({ completed: false, boundary: false, current: 'Week 1/4', next: 'Week 1/4' });
		const skipped = completed(next).map((sets) => sets.map((s) => ({ ...s, completed: false })));
		expect(finishCycle(next, skipped).progress.exercises.map((item) => item.cursor)).toEqual([1, 0]);
	});

	it('advances within-week exposure order with variable sets, not by date or individual set', () => {
		const def = definition();
		const extra = structuredClone(def.cycle!.weeks[0].exposures[0]);
		extra.id = 'second'; extra.name = 'Volume';
		extra.templates[0].sets = Array.from({ length: 4 }, () => set(.75, 6));
		def.cycle!.weeks[0].exposures.push(extra);
		const first = start(def);
		const next = start(def, [bench, squat], finishCycle(first, completed(first)).progress);
		expect(next.workout.exercises[0].cycleStage).toMatchObject({ week: 1, exposure: 2, exposureCount: 2 });
		expect(next.workout.exercises[0].sets).toHaveLength(4);
		const partial = completed(next);
		partial[0][3].completed = false;
		const review = finishCycle(next, partial);
		expect(review.progress.exercises.map((item) => item.cursor)).toEqual([1, 2]);
	});

	it('freezes templates, cross-references, rounding, settings, and iteration inputs', () => {
		const def = definition();
		def.cycle!.weeks[1].exposures[0].templates[0].sets[0].weightBasis = { kind: 'crossReference', liftId: 'squat' };
		const first = start(def);
		const progress = finishCycle(first, completed(first)).progress;
		def.cycle!.weeks[1].exposures[0].templates[0].sets[0].percentage = .01;
		const next = start(def, [{ ...bench, trainingMax: 999, roundingFactor: 100 }, { ...squat, topSetWeight: 1000 }], progress);
		expect(next.workout.exercises[0].sets[0].weight).toBe(105); // 70% of frozen squat top set 150
		expect(next.workout.exercises[0].sets[1].weight).toBe(160);
		expect(first.workout.exercises[0].sets[0].weight).toBe(130);
		expect(first.progress.exercises[0].cursor).toBe(0);
	});

	it('keeps unfinished exercises after removal and only updates finished iterations', () => {
		const first = start();
		const def = definition();
		def.cycle!.weeks.forEach((week) => week.exposures.forEach((exposure) => { exposure.templates = []; }));
		const next = start(def, [], first.progress);
		expect(next.workout.exercises).toHaveLength(2);
		expect(next.workout.exercises[0].sets[0].weight).toBe(130);
	});

	it('rolls each exercise independently and only the new iteration adopts changed shared inputs', () => {
		let snapshot = start();
		for (let week = 0; week < 4; week++) {
			const results = completed(snapshot);
			results[1].forEach((result) => { result.completed = false; });
			const review = finishCycle(snapshot, results);
			if (week === 3) {
				expect(review.trainingMaxProposals.map((proposal) => proposal.liftId)).toEqual(['bench']);
				const next = start(definition(), [{ ...bench, trainingMax: 205 }, { ...squat, trainingMax: 500 }], review.progress);
				expect(next.workout.exercises.map((exercise) => exercise.cycleStage?.iteration)).toEqual([2, 1]);
				expect(next.progress.exercises[0].configs[0].trainingMax).toBe(205);
				expect(next.progress.exercises[1].configs[1].trainingMax).toBe(300);
			} else snapshot = start(definition(), [bench, squat], review.progress);
		}
	});

	it('never proposes ordinary bumps under TM policy even for eligible top-set basis and load overrides', () => {
		const def = definition();
		def.cycle!.weeks = [def.cycle!.weeks[0]];
		def.cycle!.weeks[0].exposures[0].templates[0].sets = [{ ...set(1, 5), weightBasis: { kind: 'topSet' } }];
		const snapshot = start(def);
		const results = completed(snapshot);
		results[0][0].actualWeight = 300;
		results[0][0].actualReps = 20;
		const review = finishCycle(snapshot, results);
		expect(review.proposals).toEqual([]);
		expect(review.trainingMaxProposals[0].proposed).toBe(205);
	});

	it('supports parallel named cycles and immutable idempotent completion', () => {
		const a = start();
		const other = definition(); other.id = 'other';
		const b = start(other);
		expect(a.progress.workoutId).not.toBe(b.progress.workoutId);
		const finish = finishCycle(a, completed(a));
		expect(finishCycle(a, completed(a), finish.progress)).toEqual({
			progress: finish.progress, proposals: [], trainingMaxProposals: [], transitions: [],
		});
		expect(() => finishCycle(a, completed(a), { ...a.progress, revision: 99 })).toThrow('current cycle progress');
		expect(b.progress.exercises[0].cursor).toBe(0);
	});
});

describe('normalization and policy compatibility', () => {
	const ordinary = (): WorkoutDefinition => ({
		id: 'ordinary', name: 'Ordinary', templates: [{
			liftId: 'bench', name: 'Bench', role: 'primary',
			sets: [{ ...set(1, 5), weightBasis: { kind: 'topSet' } }, { ...set(1, 8), setType: 'backoff', weightBasis: { kind: 'backoff' } }],
		}],
	});
	it('normalizes legacy workouts without modifying definitions or requiring a TM', () => {
		const def = ordinary();
		expect(normalizeCycle(def).weeks).toHaveLength(1);
		expect(normalizeCycle(def).baseline).toBe('topSet');
		expect(def.cycle).toBeUndefined();
		expect(def.templates[0].id).toBeUndefined();
		const snapshot = start(def, [{ ...bench, trainingMax: undefined, trainingMaxIncrement: undefined }]);
		expect(snapshot.workout.exercises[0].sets.map((s) => s.weight)).toEqual([150, 100]);
	});
	it('retains ordinary top/backoff eligible-set progression despite other incomplete sets', () => {
		const snapshot = start(ordinary(), [bench]);
		const results = completed(snapshot);
		results[0][1].completed = false;
		const review = finishCycle(snapshot, results);
		expect(review.proposals[0]).toMatchObject({ proposedTopSetWeight: 152.5, proposedBackoffWeight: 100 });
		expect(review.progress.exercises[0].complete).toBe(false);
	});
	it('defers multi-exposure top-set progression until its exercise boundary', () => {
		const def = ordinary();
		def.cycle = normalizeCycle(def);
		def.cycle.weeks.push(structuredClone(def.cycle.weeks[0]));
		def.cycle.weeks[1].exposures[0].templates[0].sets.forEach((set) => { set.percentage = .5; });
		const first = start(def, [bench]);
		const review = finishCycle(first, completed(first));
		expect(review.proposals).toEqual([]);
		const last = start(def, [bench], review.progress);
		expect(finishCycle(last, completed(last)).proposals[0].proposedTopSetWeight).toBe(152.5);
	});
	it('requires programmed non-warmups, or all sets in warmup-only prescriptions', () => {
		const template = ordinary().templates[0];
		template.sets.unshift({ ...set(.5, 5), setType: 'warmup' });
		const results = template.sets.map((s) => ({ actualWeight: 1, actualReps: 0, actualSetType: s.setType, completed: s.setType !== 'warmup' }));
		expect(exerciseCompleted(template, results)).toBe(true);
		const warmupOnly: ExerciseTemplate = { ...template, sets: [template.sets[0]] };
		expect(exerciseCompleted(warmupOnly, results)).toBe(false);
		results[0].completed = true;
		expect(exerciseCompleted(warmupOnly, results)).toBe(true);
	});
});

describe('validation and history', () => {
	it.each([undefined, 0, -1, Infinity, NaN])('rejects required TM %s with an actionable error', (trainingMax) => {
		expect(() => start(definition(), [{ ...bench, trainingMax }, squat])).toThrow('training max');
	});
	it('never substitutes the normal increment for a missing separate TM increment', () => {
		expect(() => start(definition(), [{ ...bench, trainingMaxIncrement: undefined }, squat])).toThrow('separate training-max increment');
	});
	it('uses rounding/minimums for TM and retains exact fixed/bar weights', () => {
		const config = { ...bench, trainingMax: 101, minimumWeight: 45 };
		const configs = new Map([[config.id, config]]);
		expect(computeSetWeight(set(.65, 5), config, configs)).toBe(65);
		expect(computeSetWeight(set(.40, 5), config, configs)).toBe(45);
		expect(computeSetWeight({ ...set(1, 5), weightBasis: { kind: 'fixed', weight: 12.5 } }, config, configs)).toBe(12.5);
		expect(computeSetWeight({ ...set(1, 5), weightBasis: { kind: 'barWeight' } }, { ...config, barWeight: 35 }, configs)).toBe(35);
	});
	it('validates counts, reps, percentages, references, and invalid exercise identity', () => {
		const def = definition();
		def.cycle!.weeks = [];
		expect(() => validateCycle(def, [bench, squat])).toThrow('week');
		for (const value of [0, -1, .5, NaN]) {
			const bad = definition();
			bad.cycle!.weeks[0].exposures[0].templates[0].sets[0].minReps = value;
			expect(() => validateCycle(bad, [bench, squat])).toThrow('rep range');
		}
		const badReference = definition();
		badReference.cycle!.weeks[0].exposures[0].templates[0].sets[0].weightBasis = { kind: 'crossReference', liftId: 'missing' };
		expect(() => validateCycle(badReference, [bench, squat])).toThrow('missing');
		const cards = previewCycles([], [definition()], []);
		expect(cards[0].error).toContain('existing exercise');
		expect(cards[0].id).toBe('531');
	});
	it('only compares matching exercise/iteration/week/exposure and planned structure', () => {
		const first = start();
		const exercise = first.workout.exercises[0];
		const result = completed(first)[0][0];
		const row = {
			...buildLogRow({ date: '2026-01-01', startTime: '2026-01-01T10:00', endTime: '2026-01-01T11:00', workoutId: first.workout.id },
				exercise.name, exercise.liftId, 1, 'work', exercise.sets[0], result),
			cycleStage: exercise.cycleStage,
		};
		expect(findPreviousWorkoutSets([row], first.workout.id, first)?.[0][0]).toEqual({ weight: 130, reps: 5 });
		const next = start(definition(), [bench, squat], finishCycle(first, completed(first)).progress);
		expect(findPreviousWorkoutSets([row], next.workout.id, next)?.[0][0]).toBeUndefined();
		const changed = { ...row, plannedTemplate: { ...row.plannedTemplate!, minReps: 99 } };
		expect(findPreviousWorkoutSets([changed], first.workout.id, first)?.[0][0]).toBeUndefined();
	});
});
