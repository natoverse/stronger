import { describe, expect, it } from 'vitest';
import { getTrainingMax, getTrainingMaxIncrement } from '../training-max.js';

describe('training max defaults', () => {
	it('defaults only missing TM to top-set weight', () => {
		expect(getTrainingMax({ topSetWeight: 200 })).toBe(200);
		expect(getTrainingMax({ topSetWeight: 200, trainingMax: 180 })).toBe(180);
		expect(getTrainingMax({ topSetWeight: 200, trainingMax: 0 })).toBe(0);
		expect(getTrainingMax({ topSetWeight: 200, trainingMax: NaN })).toBeNaN();
	});

	it.each([
		['squat', 'Squat', 10],
		['deadlift', 'Deadlift', 10],
		['bench-press', 'Bench Press', 5],
		['overhead-press', 'Overhead Press', 5],
		['bench', 'Bench', 5],
		['press', 'Press', 5],
		['custom-id', ' SQUAT ', 10],
		['custom-id', ' DEADLIFT ', 10],
		['custom-id', ' BENCH PRESS ', 5],
		['custom-id', 'Overhead  Press', 5],
		['skull-crusher', 'Skullcrusher', 1],
		['custom-id', 'Leg Press', 1],
		['custom-id', 'Dumbbell Row', 1],
	] as const)('defaults increment for %s / %s to %i', (id, name, increment) => {
		expect(getTrainingMaxIncrement({ id, name })).toBe(increment);
	});

	it.each([0, 2.5, 7, -1, Infinity, NaN])('preserves an explicit increment %s for validation', (trainingMaxIncrement) => {
		expect(getTrainingMaxIncrement({ id: 'squat', name: 'Squat', trainingMaxIncrement })).toBe(trainingMaxIncrement);
	});
});
