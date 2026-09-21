/**
 * Default workout data sourced from the JSON library files in lib/.
 *
 * Exports default lift configs and workout definitions for first-use
 * Firestore seeding and computes workouts from the user's saved configs.
 */

import type { ExerciseTemplate, LiftConfig, Workout, ComputedExercise, CardioActivity } from '../model/index.js';
import type { CycleDefinition, SetTemplate } from '../model/types.js';
import { computeExercise } from '../model/index.js';
import { getImportedWorkoutName } from './workout-sharing.js';

import exercisesJson from '../../lib/exercises.json';
import workoutsJson from '../../lib/workouts.json';
import cardioJson from '../../lib/cardio.json';
import classic531Json from '../../lib/531.json';

// ---------------------------------------------------------------------------
// Lift configurations — defaults written to Firestore during setup
// ---------------------------------------------------------------------------

export const defaultLiftConfigs: LiftConfig[] = exercisesJson as LiftConfig[];

// ---------------------------------------------------------------------------
// Cardio activities — read-only list for planning / calendar sync
// ---------------------------------------------------------------------------

export const defaultCardioActivities: CardioActivity[] = cardioJson as CardioActivity[];

// ---------------------------------------------------------------------------
// Workout definitions (id + name + template list)
// ---------------------------------------------------------------------------

export interface WorkoutDefinition {
	id: string;
	name: string;
	/** Whether this workout appears in the favorites list; defaults to false. */
	favorite?: boolean;
	templates: ExerciseTemplate[];
	cycle?: CycleDefinition;
}

export const workoutDefinitions: WorkoutDefinition[] = workoutsJson as WorkoutDefinition[];

export const default531Cycles: WorkoutDefinition[] = classic531Json.lifts.map((lift) => {
	const weeks = classic531Json.weeks.map((week, index) => ({
		id: `week-${index + 1}`,
		name: week.name,
		exposures: [{
			id: `workout-${index + 1}`,
			name: lift.name,
			templates: [{
				id: `${lift.id}:0`, liftId: lift.id, name: lift.name, role: 'primary' as const,
				sets: structuredClone([...classic531Json.warmups, ...week.sets]) as SetTemplate[],
			}],
		}],
	}));
	return {
		id: `531-${lift.id}`, name: `${classic531Json.name} — ${lift.name}`, favorite: false,
		templates: structuredClone(weeks[0].exposures[0].templates),
		cycle: { baseline: 'trainingMax', weeks },
	};
});

export const defaultWorkoutLibrary: WorkoutDefinition[] = [...default531Cycles, ...workoutDefinitions];

export function createLibraryWorkoutDraft(
	source: WorkoutDefinition,
	id: string,
	existingNames: string[],
): WorkoutDefinition {
	return {
		...structuredClone(source), id,
		name: getImportedWorkoutName(source.name, existingNames), favorite: false,
	};
}

export function createDuplicateWorkoutDraft(
	source: WorkoutDefinition,
	id: string,
): WorkoutDefinition {
	return { ...structuredClone(source), id, name: `${source.name} (Copy)`, favorite: false };
}

export function createDefaultWorkoutImportDrafts(
	definitions: WorkoutDefinition[],
	createId: () => string,
): WorkoutDefinition[] {
	return definitions.map((definition) => ({ ...structuredClone(definition), id: createId() }));
}

// ---------------------------------------------------------------------------
// Computed workouts (ready for display)
// ---------------------------------------------------------------------------

/**
 * Build workouts from a set of LiftConfig values and workout definitions.
 * Computes workouts from the user's saved exercise and workout definitions.
 *
 * Exercises whose liftId is not present in `configs` are silently skipped.
 * Workouts with no remaining exercises are excluded from the result.
 *
 * @param configs - lift configurations (weights, rounding, etc.)
 * @param definitions - workout definitions; defaults to the hard-coded
 *   `workoutDefinitions` for backward compatibility during first-connect seeding.
 * @param options - optional computation options (e.g. roundWarmupPlateMath)
 */
export function buildWorkoutsFromConfigs(
	configs: LiftConfig[],
	definitions: WorkoutDefinition[] = workoutDefinitions,
	options?: { roundWarmupPlateMath?: boolean },
): Workout[] {
	const map = new Map(configs.map((c) => [c.id, c]));
	return definitions
		.map((def) => {
			try {
			const exercises = def.templates
				.map((t) => computeExercise(t, map, options))
				.filter((e): e is ComputedExercise => e !== null && e.sets.length > 0);
			return {
				id: def.id,
				name: def.name,
				favorite: def.favorite ?? false,
				exercises,
			};
			} catch (error) {
				return { id: def.id, name: def.name, favorite: def.favorite ?? false, exercises: [],
					error: error instanceof Error ? error.message : String(error) };
			}
		})
		.filter((w) => w.exercises.length > 0 || w.error);
}

export const sampleWorkouts: Workout[] = buildWorkoutsFromConfigs(defaultLiftConfigs);
