import { describe, it, expect } from 'vitest';
import {
	defaultLiftConfigs,
	buildWorkoutsFromConfigs,
	createDefaultWorkoutImportDrafts,
	createDuplicateWorkoutDraft,
	workoutDefinitions,
} from '../sample-workouts.ts';

describe('buildWorkoutsFromConfigs', () => {
	it('produces 8 workouts from default configs', () => {
		const workouts = buildWorkoutsFromConfigs(defaultLiftConfigs);
		expect(workouts).toHaveLength(8);
	});

	it('uses workout definitions for ids and names', () => {
		const workouts = buildWorkoutsFromConfigs(defaultLiftConfigs);
		for (let i = 0; i < workoutDefinitions.length; i++) {
			expect(workouts[i].id).toBe(workoutDefinitions[i].id);
			expect(workouts[i].name).toBe(workoutDefinitions[i].name);
		}
	});

	it('computes different weights when config values change', () => {
		const original = buildWorkoutsFromConfigs(defaultLiftConfigs);
		const modified = defaultLiftConfigs.map((c) =>
			c.id === 'bench-press' ? { ...c, topSetWeight: 225 } : c,
		);
		const updated = buildWorkoutsFromConfigs(modified);

		// Workout A primary exercise is bench — the work set weight should differ
		const originalBenchWork = original[0].exercises[0].sets.find(
			(s) => s.setType === 'work',
		);
		const updatedBenchWork = updated[0].exercises[0].sets.find(
			(s) => s.setType === 'work',
		);
		expect(updatedBenchWork!.weight).not.toBe(originalBenchWork!.weight);
		expect(updatedBenchWork!.weight).toBe(225);
	});

	it('each workout has exercises with non-negative weights', () => {
		const workouts = buildWorkoutsFromConfigs(defaultLiftConfigs);
		for (const w of workouts) {
			for (const ex of w.exercises) {
				for (const set of ex.sets) {
					expect(set.weight).toBeGreaterThanOrEqual(0);
				}
			}
		}
	});

	it('returns empty array when given empty configs', () => {
		const workouts = buildWorkoutsFromConfigs([]);
		expect(workouts).toHaveLength(0);
	});

	it('creates an unsaved duplicate workout draft without mutating definitions', () => {
		const source = workoutDefinitions[0];
		const definitions = [...workoutDefinitions];

		const draft = createDuplicateWorkoutDraft(source, 'copy-id');

		expect(draft).toEqual({
			...source,
			id: 'copy-id',
			name: `${source.name} (Copy)`,
			favorite: false,
		});
		expect(definitions).toEqual(workoutDefinitions);
		expect(definitions).not.toContain(draft);
	});

	it('creates default import drafts with fresh ids', () => {
		let nextId = 1;
		const drafts = createDefaultWorkoutImportDrafts(workoutDefinitions.slice(0, 2), () => `random-${nextId++}`);

		expect(drafts.map((draft) => draft.id)).toEqual(['random-1', 'random-2']);
		expect(drafts.map((draft) => draft.name)).toEqual([
			workoutDefinitions[0].name,
			workoutDefinitions[1].name,
		]);
		expect(drafts.map((draft) => draft.id)).not.toContain(workoutDefinitions[0].id);
		expect(workoutDefinitions[0].id).not.toBe('random-1');
	});

	it('gracefully handles partial configs (only bench press + squat)', () => {
		const partial = defaultLiftConfigs.filter(
			(c) => c.id === 'bench-press' || c.id === 'squat',
		);
		const workouts = buildWorkoutsFromConfigs(partial);

		// Should still produce some workouts, but only for exercises with matching configs
		expect(workouts.length).toBeGreaterThan(0);
		for (const w of workouts) {
			for (const ex of w.exercises) {
				expect(['bench-press', 'squat']).toContain(ex.liftId);
				expect(ex.sets.length).toBeGreaterThan(0);
			}
		}
	});

	it('skips exercises whose liftId has no config', () => {
		// Only provide bench config — exercises referencing squat, press, etc. should be skipped
		const benchOnly = defaultLiftConfigs.filter((c) => c.id === 'bench-press');
		const workouts = buildWorkoutsFromConfigs(benchOnly);

		for (const w of workouts) {
			for (const ex of w.exercises) {
				expect(ex.liftId).toBe('bench-press');
			}
		}
	});
});
