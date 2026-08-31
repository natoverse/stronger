import { describe, expect, it } from 'vitest';
import {
	defaultLiftConfigs,
	sampleWorkouts,
	workoutDefinitions,
} from '../sample-workouts.js';

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
		expect(a.exercises[0].liftId).toBe('bench');
	});

	it('workout rss-int-b-squat has squat as the primary lift', () => {
		const b = sampleWorkouts.find((w) => w.id === 'rss-int-b-squat')!;
		expect(b.exercises[0].name).toContain('Squat');
		expect(b.exercises[0].liftId).toBe('squat');
	});

	it('workout rss-int-b-press has overhead press as the primary lift', () => {
		const c = sampleWorkouts.find((w) => w.id === 'rss-int-b-press')!;
		expect(c.exercises[0].name).toContain('Overhead Press');
		expect(c.exercises[0].liftId).toBe('press');
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
