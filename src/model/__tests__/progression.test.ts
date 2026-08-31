import { describe, expect, it } from 'vitest';

import type {
	ComputedExercise,
	ExerciseTemplate,
	LiftConfig,
	SetResult,
} from '../types.js';
import { computeProgression, isCrossReferenceOnly } from '../progression.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const benchConfig: LiftConfig = {
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

const pressConfig: LiftConfig = {
	id: 'press',
	name: 'Press',
	topSetWeight: 140,
	backoffWeight: 120,
	increment: 2.5,
	minimumWeight: 65,
	roundingFactor: 2.5,
	warmupRoundingFactor: 5,
	barWeight: 45,
	gear: 'barbell',
};

const skullCrusherConfig: LiftConfig = {
	id: 'skull-crusher',
	name: 'Skull Crusher',
	topSetWeight: 60,
	backoffWeight: 51,
	increment: 2.5,
	minimumWeight: 20,
	roundingFactor: 2.5,
	warmupRoundingFactor: 5,
	barWeight: 15,
	gear: 'barbell',
};

// ---------------------------------------------------------------------------
// isCrossReferenceOnly
// ---------------------------------------------------------------------------

describe('isCrossReferenceOnly', () => {
	it('returns true when all work/backoff sets use crossReference', () => {
		const template: ExerciseTemplate = {
			liftId: 'press',
			name: 'Press',
			role: 'secondary',
			sets: [
				{
					setType: 'warmup',
					percentage: 1.0,
					weightBasis: { kind: 'fixed', weight: 45 },
					minReps: 10,
					maxReps: 10,
					amrap: false,
				},
				{
					setType: 'work',
					percentage: 0.85,
					weightBasis: { kind: 'crossReference', liftId: 'press' },
					minReps: 5,
					maxReps: 8,
					amrap: false,
				},
				{
					setType: 'backoff',
					percentage: 0.7225,
					weightBasis: { kind: 'crossReference', liftId: 'press' },
					minReps: 5,
					maxReps: 8,
					amrap: true,
				},
			],
		};
		expect(isCrossReferenceOnly(template)).toBe(true);
	});

	it('returns false when work sets use topSet basis', () => {
		const template: ExerciseTemplate = {
			liftId: 'bench',
			name: 'Bench Press',
			role: 'primary',
			sets: [
				{
					setType: 'work',
					percentage: 1.0,
					weightBasis: { kind: 'topSet' },
					minReps: 3,
					maxReps: 5,
					amrap: true,
				},
				{
					setType: 'backoff',
					percentage: 1.0,
					weightBasis: { kind: 'backoff' },
					minReps: 5,
					maxReps: 8,
					amrap: true,
				},
			],
		};
		expect(isCrossReferenceOnly(template)).toBe(false);
	});

	it('returns false when exercise has no work/backoff sets', () => {
		const template: ExerciseTemplate = {
			liftId: 'bench',
			name: 'Warmup Only',
			role: 'primary',
			sets: [
				{
					setType: 'warmup',
					percentage: 1.0,
					weightBasis: { kind: 'fixed', weight: 45 },
					minReps: 10,
					maxReps: 10,
					amrap: false,
				},
			],
		};
		expect(isCrossReferenceOnly(template)).toBe(false);
	});

	it('returns false when some work sets use topSet and some crossReference', () => {
		const template: ExerciseTemplate = {
			liftId: 'bench',
			name: 'Mixed',
			role: 'primary',
			sets: [
				{
					setType: 'work',
					percentage: 1.0,
					weightBasis: { kind: 'topSet' },
					minReps: 3,
					maxReps: 5,
					amrap: true,
				},
				{
					setType: 'work',
					percentage: 0.85,
					weightBasis: { kind: 'crossReference', liftId: 'press' },
					minReps: 5,
					maxReps: 8,
					amrap: false,
				},
			],
		};
		expect(isCrossReferenceOnly(template)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// computeProgression
// ---------------------------------------------------------------------------

describe('computeProgression', () => {
	const configs = [benchConfig, pressConfig, skullCrusherConfig];

	it('proposes weight increase when top-set rep target is met', () => {
		const exercises: ComputedExercise[] = [
			{
				liftId: 'bench',
				name: 'Bench Press',
				role: 'primary',
				sets: [
					{ setType: 'work', weight: 200, minReps: 3, maxReps: 5, amrap: true },
					{ setType: 'backoff', weight: 170, minReps: 5, maxReps: 8, amrap: true },
				],
			},
		];
		const templates: ExerciseTemplate[] = [
			{
				liftId: 'bench',
				name: 'Bench Press',
				role: 'primary',
				sets: [
					{ setType: 'work', percentage: 1.0, weightBasis: { kind: 'topSet' }, minReps: 3, maxReps: 5, amrap: true },
					{ setType: 'backoff', percentage: 1.0, weightBasis: { kind: 'backoff' }, minReps: 5, maxReps: 8, amrap: true },
				],
			},
		];
		const results: SetResult[][] = [
			[
				{ actualWeight: 200, actualReps: 5, completed: true, actualSetType: 'work' },
				{ actualWeight: 170, actualReps: 6, completed: true, actualSetType: 'backoff' },
			],
		];

		const proposals = computeProgression(exercises, results, configs, templates);
		expect(proposals).toHaveLength(1);
		expect(proposals[0].liftId).toBe('bench');
		expect(proposals[0].topSetHit).toBe(true);
		expect(proposals[0].backoffHit).toBe(false);
		expect(proposals[0].proposedTopSetWeight).toBe(202.5); // 200 + 2.5
		expect(proposals[0].proposedBackoffWeight).toBe(170); // no change
		expect(proposals[0].roundingFactor).toBe(5); // bench roundingFactor
	});

	it('proposes no change when rep target is not met', () => {
		const exercises: ComputedExercise[] = [
			{
				liftId: 'bench',
				name: 'Bench Press',
				role: 'primary',
				sets: [
					{ setType: 'work', weight: 200, minReps: 3, maxReps: 5, amrap: true },
					{ setType: 'backoff', weight: 170, minReps: 5, maxReps: 8, amrap: true },
				],
			},
		];
		const templates: ExerciseTemplate[] = [
			{
				liftId: 'bench',
				name: 'Bench Press',
				role: 'primary',
				sets: [
					{ setType: 'work', percentage: 1.0, weightBasis: { kind: 'topSet' }, minReps: 3, maxReps: 5, amrap: true },
					{ setType: 'backoff', percentage: 1.0, weightBasis: { kind: 'backoff' }, minReps: 5, maxReps: 8, amrap: true },
				],
			},
		];
		const results: SetResult[][] = [
			[
				{ actualWeight: 200, actualReps: 4, completed: true, actualSetType: 'work' },
				{ actualWeight: 170, actualReps: 7, completed: true, actualSetType: 'backoff' },
			],
		];

		const proposals = computeProgression(exercises, results, configs, templates);
		expect(proposals).toHaveLength(1);
		expect(proposals[0].topSetHit).toBe(false);
		expect(proposals[0].backoffHit).toBe(false);
		expect(proposals[0].proposedTopSetWeight).toBe(200);
		expect(proposals[0].proposedBackoffWeight).toBe(170);
	});

	it('proposes increase for both work and backoff when both targets met', () => {
		const exercises: ComputedExercise[] = [
			{
				liftId: 'bench',
				name: 'Bench Press',
				role: 'primary',
				sets: [
					{ setType: 'work', weight: 200, minReps: 3, maxReps: 5, amrap: true },
					{ setType: 'backoff', weight: 170, minReps: 5, maxReps: 8, amrap: true },
				],
			},
		];
		const templates: ExerciseTemplate[] = [
			{
				liftId: 'bench',
				name: 'Bench Press',
				role: 'primary',
				sets: [
					{ setType: 'work', percentage: 1.0, weightBasis: { kind: 'topSet' }, minReps: 3, maxReps: 5, amrap: true },
					{ setType: 'backoff', percentage: 1.0, weightBasis: { kind: 'backoff' }, minReps: 5, maxReps: 8, amrap: true },
				],
			},
		];
		const results: SetResult[][] = [
			[
				{ actualWeight: 200, actualReps: 5, completed: true, actualSetType: 'work' },
				{ actualWeight: 170, actualReps: 8, completed: true, actualSetType: 'backoff' },
			],
		];

		const proposals = computeProgression(exercises, results, configs, templates);
		expect(proposals).toHaveLength(1);
		expect(proposals[0].topSetHit).toBe(true);
		expect(proposals[0].backoffHit).toBe(true);
		expect(proposals[0].proposedTopSetWeight).toBe(202.5);
		expect(proposals[0].proposedBackoffWeight).toBe(172.5);
	});

	it('excludes exercises using only crossReference weight basis', () => {
		const exercises: ComputedExercise[] = [
			{
				liftId: 'bench',
				name: 'Bench Press',
				role: 'primary',
				sets: [
					{ setType: 'work', weight: 200, minReps: 3, maxReps: 5, amrap: true },
				],
			},
			{
				liftId: 'press',
				name: 'Press',
				role: 'secondary',
				sets: [
					{ setType: 'work', weight: 120, minReps: 5, maxReps: 8, amrap: false },
				],
			},
		];
		const templates: ExerciseTemplate[] = [
			{
				liftId: 'bench',
				name: 'Bench Press',
				role: 'primary',
				sets: [
					{ setType: 'work', percentage: 1.0, weightBasis: { kind: 'topSet' }, minReps: 3, maxReps: 5, amrap: true },
				],
			},
			{
				liftId: 'press',
				name: 'Press',
				role: 'secondary',
				sets: [
					{ setType: 'work', percentage: 0.85, weightBasis: { kind: 'crossReference', liftId: 'press' }, minReps: 5, maxReps: 8, amrap: false },
				],
			},
		];
		const results: SetResult[][] = [
			[{ actualWeight: 200, actualReps: 5, completed: true, actualSetType: 'work' }],
			[{ actualWeight: 120, actualReps: 8, completed: true, actualSetType: 'work' }],
		];

		const proposals = computeProgression(exercises, results, configs, templates);
		expect(proposals).toHaveLength(1);
		expect(proposals[0].liftId).toBe('bench');
		// No proposal for press (all sets use crossReference)
	});

	it('groups exercises with the same liftId', () => {
		const exercises: ComputedExercise[] = [
			{
				liftId: 'skull-crusher',
				name: 'Skull Crusher',
				role: 'assistance',
				sets: [
					{ setType: 'work', weight: 60, minReps: 8, maxReps: 8, amrap: false },
				],
			},
			{
				liftId: 'skull-crusher',
				name: 'Skull Crusher',
				role: 'assistance',
				sets: [
					{ setType: 'work', weight: 60, minReps: 8, maxReps: 8, amrap: false },
				],
			},
		];
		const templates: ExerciseTemplate[] = [
			{
				liftId: 'skull-crusher',
				name: 'Skull Crusher',
				role: 'assistance',
				sets: [
					{ setType: 'work', percentage: 1.0, weightBasis: { kind: 'topSet' }, minReps: 8, maxReps: 8, amrap: false },
				],
			},
			{
				liftId: 'skull-crusher',
				name: 'Skull Crusher',
				role: 'assistance',
				sets: [
					{ setType: 'work', percentage: 1.0, weightBasis: { kind: 'topSet' }, minReps: 8, maxReps: 8, amrap: false },
				],
			},
		];
		const results: SetResult[][] = [
			[{ actualWeight: 60, actualReps: 8, completed: true, actualSetType: 'work' }],
			[{ actualWeight: 60, actualReps: 8, completed: true, actualSetType: 'work' }],
		];

		const proposals = computeProgression(exercises, results, configs, templates);
		expect(proposals).toHaveLength(1);
		expect(proposals[0].liftId).toBe('skull-crusher');
	});

	it('ignores incomplete sets for progression', () => {
		const exercises: ComputedExercise[] = [
			{
				liftId: 'bench',
				name: 'Bench Press',
				role: 'primary',
				sets: [
					{ setType: 'work', weight: 200, minReps: 3, maxReps: 5, amrap: true },
				],
			},
		];
		const templates: ExerciseTemplate[] = [
			{
				liftId: 'bench',
				name: 'Bench Press',
				role: 'primary',
				sets: [
					{ setType: 'work', percentage: 1.0, weightBasis: { kind: 'topSet' }, minReps: 3, maxReps: 5, amrap: true },
				],
			},
		];
		const results: SetResult[][] = [
			[{ actualWeight: 200, actualReps: 5, completed: false, actualSetType: 'work' }],
		];

		const proposals = computeProgression(exercises, results, configs, templates);
		expect(proposals).toHaveLength(1);
		expect(proposals[0].topSetHit).toBe(false);
		expect(proposals[0].proposedTopSetWeight).toBe(200);
	});

	it('ignores warmup sets for progression decisions', () => {
		const exercises: ComputedExercise[] = [
			{
				liftId: 'bench',
				name: 'Bench Press',
				role: 'primary',
				sets: [
					{ setType: 'warmup', weight: 95, minReps: 5, maxReps: 5, amrap: false },
					{ setType: 'work', weight: 200, minReps: 3, maxReps: 5, amrap: true },
				],
			},
		];
		const templates: ExerciseTemplate[] = [
			{
				liftId: 'bench',
				name: 'Bench Press',
				role: 'primary',
				sets: [
					{ setType: 'warmup', percentage: 0.45, weightBasis: { kind: 'topSet' }, minReps: 5, maxReps: 5, amrap: false },
					{ setType: 'work', percentage: 1.0, weightBasis: { kind: 'topSet' }, minReps: 3, maxReps: 5, amrap: true },
				],
			},
		];
		const results: SetResult[][] = [
			[
				{ actualWeight: 95, actualReps: 5, completed: true, actualSetType: 'warmup' },
				{ actualWeight: 200, actualReps: 3, completed: true, actualSetType: 'work' },
			],
		];

		const proposals = computeProgression(exercises, results, configs, templates);
		expect(proposals).toHaveLength(1);
		expect(proposals[0].topSetHit).toBe(false);
		expect(proposals[0].proposedTopSetWeight).toBe(200);
	});

	it('handles reps exceeding the upper bound (still counts as hit)', () => {
		const exercises: ComputedExercise[] = [
			{
				liftId: 'bench',
				name: 'Bench Press',
				role: 'primary',
				sets: [
					{ setType: 'work', weight: 200, minReps: 3, maxReps: 5, amrap: true },
				],
			},
		];
		const templates: ExerciseTemplate[] = [
			{
				liftId: 'bench',
				name: 'Bench Press',
				role: 'primary',
				sets: [
					{ setType: 'work', percentage: 1.0, weightBasis: { kind: 'topSet' }, minReps: 3, maxReps: 5, amrap: true },
				],
			},
		];
		const results: SetResult[][] = [
			[{ actualWeight: 200, actualReps: 7, completed: true, actualSetType: 'work' }],
		];

		const proposals = computeProgression(exercises, results, configs, templates);
		expect(proposals).toHaveLength(1);
		expect(proposals[0].topSetHit).toBe(true);
		expect(proposals[0].proposedTopSetWeight).toBe(202.5);
	});

	it('returns empty array when all exercises use crossReference only', () => {
		const exercises: ComputedExercise[] = [
			{
				liftId: 'press',
				name: 'Press',
				role: 'secondary',
				sets: [
					{ setType: 'work', weight: 120, minReps: 5, maxReps: 8, amrap: false },
				],
			},
		];
		const templates: ExerciseTemplate[] = [
			{
				liftId: 'press',
				name: 'Press',
				role: 'secondary',
				sets: [
					{ setType: 'work', percentage: 0.85, weightBasis: { kind: 'crossReference', liftId: 'press' }, minReps: 5, maxReps: 8, amrap: false },
				],
			},
		];
		const results: SetResult[][] = [
			[{ actualWeight: 120, actualReps: 8, completed: true, actualSetType: 'work' }],
		];

		const proposals = computeProgression(exercises, results, configs, templates);
		expect(proposals).toHaveLength(0);
	});

	it('uses actual completed weight as base when user adjusts weight during workout', () => {
		// User was planned for 200 but lowered to 195 during the workout
		const exercises: ComputedExercise[] = [
			{
				liftId: 'bench',
				name: 'Bench Press',
				role: 'primary',
				sets: [
					{ setType: 'work', weight: 200, minReps: 3, maxReps: 5, amrap: true },
					{ setType: 'backoff', weight: 170, minReps: 5, maxReps: 8, amrap: true },
				],
			},
		];
		const templates: ExerciseTemplate[] = [
			{
				liftId: 'bench',
				name: 'Bench Press',
				role: 'primary',
				sets: [
					{ setType: 'work', percentage: 1.0, weightBasis: { kind: 'topSet' }, minReps: 3, maxReps: 5, amrap: true },
					{ setType: 'backoff', percentage: 1.0, weightBasis: { kind: 'backoff' }, minReps: 5, maxReps: 8, amrap: true },
				],
			},
		];
		const results: SetResult[][] = [
			[
				// User lowered work weight from 200 → 195 and hit the target
				{ actualWeight: 195, actualReps: 5, completed: true, actualSetType: 'work' },
				// User lowered backoff weight from 170 → 165 and hit the target
				{ actualWeight: 165, actualReps: 8, completed: true, actualSetType: 'backoff' },
			],
		];

		const proposals = computeProgression(exercises, results, configs, templates);
		expect(proposals).toHaveLength(1);
		const p = proposals[0];
		// Current should reflect what user actually lifted, not the config value
		expect(p.currentTopSetWeight).toBe(195);
		expect(p.currentBackoffWeight).toBe(165);
		// Proposed should increment from the actual weight
		expect(p.proposedTopSetWeight).toBe(197.5); // 195 + 2.5
		expect(p.proposedBackoffWeight).toBe(167.5); // 165 + 2.5
	});

	it('back-calculates reference weight correctly from non-100% sets but does not increment', () => {
		// User has an 85% work set (no 100% set). Planned: 85% × 200 = 170
		// User keeps the weight at 170 → effective reference = 170 / 0.85 = 200
		// Since the set is below 100%, no increment should be proposed even if
		// the rep target is met (supports "easy day" / hypertrophy workouts).
		const exercises: ComputedExercise[] = [
			{
				liftId: 'bench',
				name: 'Bench Press',
				role: 'primary',
				sets: [
					{ setType: 'work', weight: 170, minReps: 5, maxReps: 8, amrap: true },
				],
			},
		];
		const templates: ExerciseTemplate[] = [
			{
				liftId: 'bench',
				name: 'Bench Press',
				role: 'primary',
				sets: [
					{ setType: 'work', percentage: 0.85, weightBasis: { kind: 'topSet' }, minReps: 5, maxReps: 8, amrap: true },
				],
			},
		];
		const results: SetResult[][] = [
			[{ actualWeight: 170, actualReps: 8, completed: true, actualSetType: 'work' }],
		];

		const proposals = computeProgression(exercises, results, configs, templates);
		expect(proposals).toHaveLength(1);
		// 170 / 0.85 = 200, rounded to nearest 5 = 200
		expect(proposals[0].currentTopSetWeight).toBe(200);
		// No increment because the set was below 100%
		expect(proposals[0].proposedTopSetWeight).toBe(200);
		expect(proposals[0].topSetHit).toBe(false);
	});

	it('does not suggest backoff increment when backoff set is below 100%', () => {
		const exercises: ComputedExercise[] = [
			{
				liftId: 'bench',
				name: 'Bench Press',
				role: 'primary',
				sets: [
					{ setType: 'work', weight: 200, minReps: 3, maxReps: 5, amrap: true },
					{ setType: 'backoff', weight: 144.5, minReps: 5, maxReps: 8, amrap: true },
				],
			},
		];
		const templates: ExerciseTemplate[] = [
			{
				liftId: 'bench',
				name: 'Bench Press',
				role: 'primary',
				sets: [
					{ setType: 'work', percentage: 1.0, weightBasis: { kind: 'topSet' }, minReps: 3, maxReps: 5, amrap: true },
					{ setType: 'backoff', percentage: 0.85, weightBasis: { kind: 'backoff' }, minReps: 5, maxReps: 8, amrap: true },
				],
			},
		];
		const results: SetResult[][] = [
			[
				{ actualWeight: 200, actualReps: 5, completed: true, actualSetType: 'work' },
				{ actualWeight: 144.5, actualReps: 8, completed: true, actualSetType: 'backoff' },
			],
		];

		const proposals = computeProgression(exercises, results, configs, templates);
		expect(proposals).toHaveLength(1);
		const p = proposals[0];
		// Top set at 100% → should increment
		expect(p.topSetHit).toBe(true);
		expect(p.proposedTopSetWeight).toBe(202.5);
		// Backoff at 85% → should NOT increment even though rep target was hit
		expect(p.backoffHit).toBe(false);
		expect(p.proposedBackoffWeight).toBe(p.currentBackoffWeight);
	});

	it('handles a full Workout A scenario (bench primary + press secondary + skull crusher assistance)', () => {
		const exercises: ComputedExercise[] = [
			{
				liftId: 'bench',
				name: 'Bench Press',
				role: 'primary',
				sets: [
					{ setType: 'warmup', weight: 45, minReps: 10, maxReps: 10, amrap: false },
					{ setType: 'warmup', weight: 95, minReps: 5, maxReps: 5, amrap: false },
					{ setType: 'warmup', weight: 130, minReps: 3, maxReps: 3, amrap: false },
					{ setType: 'warmup', weight: 170, minReps: 2, maxReps: 2, amrap: false },
					{ setType: 'work', weight: 200, minReps: 3, maxReps: 5, amrap: true },
					{ setType: 'backoff', weight: 170, minReps: 5, maxReps: 8, amrap: true },
				],
			},
			{
				liftId: 'press',
				name: 'Press',
				role: 'secondary',
				sets: [
					{ setType: 'warmup', weight: 45, minReps: 10, maxReps: 10, amrap: false },
					{ setType: 'work', weight: 120, minReps: 5, maxReps: 8, amrap: false },
					{ setType: 'backoff', weight: 102.5, minReps: 5, maxReps: 8, amrap: true },
				],
			},
			{
				liftId: 'skull-crusher',
				name: 'Skull Crusher',
				role: 'assistance',
				sets: [
					{ setType: 'work', weight: 60, minReps: 8, maxReps: 8, amrap: false },
					{ setType: 'backoff', weight: 50, minReps: 8, maxReps: 8, amrap: true },
				],
			},
		];
		const templates: ExerciseTemplate[] = [
			{
				liftId: 'bench',
				name: 'Bench Press',
				role: 'primary',
				sets: [
					{ setType: 'warmup', percentage: 1.0, weightBasis: { kind: 'fixed', weight: 45 }, minReps: 10, maxReps: 10, amrap: false },
					{ setType: 'warmup', percentage: 0.45, weightBasis: { kind: 'topSet' }, minReps: 5, maxReps: 5, amrap: false },
					{ setType: 'warmup', percentage: 0.65, weightBasis: { kind: 'topSet' }, minReps: 3, maxReps: 3, amrap: false },
					{ setType: 'warmup', percentage: 0.85, weightBasis: { kind: 'topSet' }, minReps: 2, maxReps: 2, amrap: false },
					{ setType: 'work', percentage: 1.0, weightBasis: { kind: 'topSet' }, minReps: 3, maxReps: 5, amrap: true },
					{ setType: 'backoff', percentage: 1.0, weightBasis: { kind: 'backoff' }, minReps: 5, maxReps: 8, amrap: true },
				],
			},
			{
				liftId: 'press',
				name: 'Press',
				role: 'secondary',
				sets: [
					{ setType: 'warmup', percentage: 1.0, weightBasis: { kind: 'fixed', weight: 45 }, minReps: 10, maxReps: 10, amrap: false },
					{ setType: 'work', percentage: 0.85, weightBasis: { kind: 'crossReference', liftId: 'press' }, minReps: 5, maxReps: 8, amrap: false },
					{ setType: 'backoff', percentage: 0.7225, weightBasis: { kind: 'crossReference', liftId: 'press' }, minReps: 5, maxReps: 8, amrap: true },
				],
			},
			{
				liftId: 'skull-crusher',
				name: 'Skull Crusher',
				role: 'assistance',
				sets: [
					{ setType: 'work', percentage: 1.0, weightBasis: { kind: 'topSet' }, minReps: 8, maxReps: 8, amrap: false },
					{ setType: 'backoff', percentage: 1.0, weightBasis: { kind: 'backoff' }, minReps: 8, maxReps: 8, amrap: true },
				],
			},
		];
		const results: SetResult[][] = [
			[
				{ actualWeight: 45, actualReps: 10, completed: true, actualSetType: 'warmup' },
				{ actualWeight: 95, actualReps: 5, completed: true, actualSetType: 'warmup' },
				{ actualWeight: 130, actualReps: 3, completed: true, actualSetType: 'warmup' },
				{ actualWeight: 170, actualReps: 2, completed: true, actualSetType: 'warmup' },
				{ actualWeight: 200, actualReps: 5, completed: true, actualSetType: 'work' },
				{ actualWeight: 170, actualReps: 8, completed: true, actualSetType: 'backoff' },
			],
			[
				{ actualWeight: 45, actualReps: 10, completed: true, actualSetType: 'warmup' },
				{ actualWeight: 120, actualReps: 8, completed: true, actualSetType: 'work' },
				{ actualWeight: 102.5, actualReps: 6, completed: true, actualSetType: 'backoff' },
			],
			[
				{ actualWeight: 60, actualReps: 8, completed: true, actualSetType: 'work' },
				{ actualWeight: 50, actualReps: 8, completed: true, actualSetType: 'backoff' },
			],
		];

		const proposals = computeProgression(exercises, results, configs, templates);

		// Should produce proposals for bench and skull-crusher only (press uses crossReference only)
		expect(proposals).toHaveLength(2);

		const benchProposal = proposals.find((p) => p.liftId === 'bench');
		expect(benchProposal).toBeDefined();
		expect(benchProposal!.topSetHit).toBe(true);
		expect(benchProposal!.backoffHit).toBe(true);
		expect(benchProposal!.proposedTopSetWeight).toBe(202.5);
		expect(benchProposal!.proposedBackoffWeight).toBe(172.5);
		expect(benchProposal!.roundingFactor).toBe(5);

		const skullProposal = proposals.find((p) => p.liftId === 'skull-crusher');
		expect(skullProposal).toBeDefined();
		expect(skullProposal!.topSetHit).toBe(true);
		expect(skullProposal!.backoffHit).toBe(true);
		expect(skullProposal!.proposedTopSetWeight).toBe(62.5);
		// Config backoffWeight is 51 but rounds to 50 at rounding factor 2.5.
		// Progression now uses the actual completed weight (50), not the config value.
		expect(skullProposal!.proposedBackoffWeight).toBe(52.5);
		expect(skullProposal!.roundingFactor).toBe(2.5);

		// No proposal for press (all sets use crossReference)
		expect(proposals.find((p) => p.liftId === 'press')).toBeUndefined();
	});
});
