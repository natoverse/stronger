import { describe, expect, it } from 'vitest';
import {
	defaultLiftConfigs,
	default531Cycles,
	defaultWorkoutLibrary,
	createLibraryWorkoutDraft,
	createDefaultWorkoutImportDrafts,
	sampleWorkouts,
	workoutDefinitions,
} from '../sample-workouts.js';
import { computeExercise } from '../../model/compute.js';
import { createCycleSession, finishCycle, validateCycle } from '../../model/cycles.js';
import { trainingMaxFromOneRepMax } from '../../model/training-max.js';
import type { CycleProgress } from '../../model/types.js';

describe('sampleWorkouts', () => {
	it('provides exactly 8 workouts', () => {
		expect(sampleWorkouts).toHaveLength(8);
		expect(sampleWorkouts.map((w) => w.id)).toEqual([
			'rss-int-b-bench',
			'rss-int-b-squat',
			'rss-int-b-press',
			'rss-int-b-deadlift',
			'basic-bench',
			'basic-squat',
			'basic-press',
			'basic-deadlift',
		]);
	});

	describe('classic 5/3/1 default library', () => {
		const percentages = [[.65, .75, .85], [.7, .8, .9], [.75, .85, .95], [.4, .5, .6]];
		const reps = [[5, 5, 5], [3, 3, 3], [5, 3, 1], [5, 5, 5]];

		it('includes starter workouts and separate four-week cycles for the four main lifts', () => {
			expect(default531Cycles.map((cycle) => cycle.templates[0].liftId))
				.toEqual(['squat', 'bench-press', 'deadlift', 'overhead-press']);
			expect(defaultWorkoutLibrary).toHaveLength(workoutDefinitions.length + 4);
			expect(new Set(defaultWorkoutLibrary.map((program) => program.id)).size).toBe(defaultWorkoutLibrary.length);
		});

		it.each(default531Cycles)('$name has recommended warmups, work percentages, AMRAP, and deload', (program) => {
			expect(() => validateCycle(program, defaultLiftConfigs)).not.toThrow();
			expect(program.cycle?.baseline).toBe('trainingMax');
			expect(program.cycle?.weeks).toHaveLength(4);
			program.cycle!.weeks.forEach((week, index) => {
				expect(week.exposures).toHaveLength(1);
				const exercises = week.exposures[0].templates;
				expect(exercises).toHaveLength(1);
				expect(exercises[0].id).toBe(program.templates[0].id);
				const sets = exercises[0].sets;
				expect(sets).toHaveLength(6);
				expect(sets.map((set) => set.weightBasis)).toEqual(Array(6).fill({ kind: 'trainingMax' }));
				expect(sets.map((set) => set.setType)).toEqual(['warmup', 'warmup', 'warmup', 'work', 'work', 'work']);
				expect(sets.map((set) => set.percentage)).toEqual([.4, .5, .6, ...percentages[index]]);
				expect(sets.map((set) => set.minReps)).toEqual([5, 5, 3, ...reps[index]]);
				expect(sets.map((set) => set.maxReps)).toEqual([5, 5, 3, ...reps[index]]);
				expect(sets.map((set) => set.amrap)).toEqual([false, false, false, false, false, index < 3]);
			});
		});

		it.each(default531Cycles)('$name applies the 90% starting modifier once, then percentages of TM', (program) => {
			const config = {
				...defaultLiftConfigs.find((lift) => lift.id === program.templates[0].liftId)!,
				topSetWeight: 999,
				trainingMax: trainingMaxFromOneRepMax(200),
				roundingFactor: 0, warmupRoundingFactor: 0, minimumWeight: 0,
			};
			expect(config.trainingMax).toBe(180);
			program.cycle!.weeks.forEach((week, index) => {
				const computed = computeExercise(week.exposures[0].templates[0], new Map([[config.id, config]]))!;
				computed.sets.forEach((set, si) => {
					expect(set.weight).toBeCloseTo(180 * [.4, .5, .6, ...percentages[index]][si]);
				});
			});
		});

		it.each(default531Cycles)('$name reviews its increment only after all four weeks including deload', (program) => {
			const config = { ...defaultLiftConfigs.find((lift) => lift.id === program.templates[0].liftId)!, trainingMax: 200 };
			let progress: CycleProgress | undefined;
			for (let week = 1; week <= 4; week++) {
				const snapshot = createCycleSession(program, [config], progress);
				expect(snapshot.workout.exercises[0].cycleStage).toMatchObject({ week, exposureCount: 1 });
				const results = snapshot.workout.exercises.map((exercise) => exercise.sets.map((set) => ({
					completed: true, reps: set.minReps,
				})));
				const finish = finishCycle(snapshot, results);
				expect(finish.trainingMaxProposals).toHaveLength(week === 4 ? 1 : 0);
				if (week === 4) expect(finish.trainingMaxProposals[0].proposed)
					.toBe(['squat', 'deadlift'].includes(config.id) ? 210 : 205);
				progress = finish.progress;
			}
			expect(createCycleSession(program, [config], progress).workout.exercises[0].cycleStage?.week).toBe(1);
		});

		it('creates deeply independent drafts without overwriting existing names or templates', () => {
			const source = default531Cycles[0];
			const original = structuredClone(source);
			const first = createLibraryWorkoutDraft(source, 'new-id', [source.name, `${source.name} copy`]);
			const second = createLibraryWorkoutDraft(source, 'other-id', []);
			expect(first).toMatchObject({ id: 'new-id', name: `${source.name} copy 2`, favorite: false });
			first.cycle!.weeks[0].exposures[0].templates[0].sets[0].percentage = .99;
			first.templates[0].sets[0].weightBasis = { kind: 'fixed', weight: 999 };
			expect(source).toEqual(original);
			expect(second.cycle).toEqual(original.cycle);
			expect(first.cycle!.weeks[1].exposures[0].templates[0].sets[0].percentage).toBe(.4);
			const drafts = createDefaultWorkoutImportDrafts([source], () => 'bulk-id');
			drafts[0].cycle!.weeks[0].exposures[0].templates[0].sets.pop();
			expect(source).toEqual(original);
		});
	});

	it('each workout has a non-empty name', () => {
		for (const workout of sampleWorkouts) {
			expect(workout.name).toBeTruthy();
		}
	});

	it('each RSS workout contains at least 2 exercises', () => {
		const rssWorkouts = sampleWorkouts.filter((w) => w.id.startsWith('rss-'));
		for (const workout of rssWorkouts) {
			expect(workout.exercises.length).toBeGreaterThanOrEqual(2);
		}
	});

	it('every exercise has at least one set', () => {
		for (const workout of sampleWorkouts) {
			for (const exercise of workout.exercises) {
				expect(exercise.sets.length).toBeGreaterThan(0);
			}
		}
	});

	it('all set weights are non-negative numbers', () => {
		for (const workout of sampleWorkouts) {
			for (const exercise of workout.exercises) {
				for (const set of exercise.sets) {
					expect(set.weight).toBeGreaterThanOrEqual(0);
				}
			}
		}
	});

	it('all rep ranges are valid (minReps ≤ maxReps, both > 0)', () => {
		for (const workout of sampleWorkouts) {
			for (const exercise of workout.exercises) {
				for (const set of exercise.sets) {
					expect(set.minReps).toBeGreaterThan(0);
					expect(set.maxReps).toBeGreaterThanOrEqual(set.minReps);
				}
			}
		}
	});

	it('workout rss-int-b-bench has bench press as the primary lift', () => {
		const a = sampleWorkouts.find((w) => w.id === 'rss-int-b-bench')!;
		expect(a.exercises[0].name).toContain('Bench Press');
		expect(a.exercises[0].liftId).toBe('bench-press');
	});

	it('workout rss-int-b-squat has squat as the primary lift', () => {
		const b = sampleWorkouts.find((w) => w.id === 'rss-int-b-squat')!;
		expect(b.exercises[0].name).toContain('Squat');
		expect(b.exercises[0].liftId).toBe('squat');
	});

	it('references only exercise IDs defined by the default configs', () => {
		const exerciseIds = new Set(defaultLiftConfigs.map((config) => config.id));

		for (const workout of workoutDefinitions) {
			for (const exercise of workout.templates) {
				expect(exerciseIds.has(exercise.liftId), exercise.liftId).toBe(true);
				for (const set of exercise.sets) {
					if (set.weightBasis.kind === 'crossReference') {
						expect(exerciseIds.has(set.weightBasis.liftId), set.weightBasis.liftId).toBe(true);
					}
				}
			}
		}
	});
});
