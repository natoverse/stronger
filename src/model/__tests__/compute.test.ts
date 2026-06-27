import { describe, expect, it } from 'vitest';

import type {
	ExerciseTemplate,
	LiftConfig,
	SetTemplate,
} from '../types.js';
import {
	computeExercise,
	computeSet,
	computeSetWeight,
	computeWeight,
	roundToNearest,
} from '../compute.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function configMap(...configs: LiftConfig[]): Map<string, LiftConfig> {
	return new Map(configs.map((c) => [c.id, c]));
}

const benchConfig: LiftConfig = {
	id: 'bench',
	name: 'Bench Press',
	topSetWeight: 200,
	backoffWeight: 170,
	increment: 2.5,
	minimumWeight: 95,
	roundingFactor: 5,
	barWeight: 45,
	gear: 'barbell',
};

const squatConfig: LiftConfig = {
	id: 'squat',
	name: 'Squat',
	topSetWeight: 300,
	backoffWeight: 255,
	increment: 5,
	minimumWeight: 95,
	roundingFactor: 5,
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
	barWeight: 45,
	gear: 'barbell',
};

const deadliftConfig: LiftConfig = {
	id: 'deadlift',
	name: 'Deadlift',
	topSetWeight: 350,
	backoffWeight: 300,
	increment: 5,
	minimumWeight: 135,
	roundingFactor: 5,
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
	barWeight: 15,
	gear: 'barbell',
};

// ---------------------------------------------------------------------------
// roundToNearest
// ---------------------------------------------------------------------------

describe('roundToNearest', () => {
	it('rounds to the nearest 5', () => {
		expect(roundToNearest(92, 5)).toBe(90);
		expect(roundToNearest(93, 5)).toBe(95);
		expect(roundToNearest(97.5, 5)).toBe(100);
	});

	it('rounds to the nearest 2.5', () => {
		expect(roundToNearest(91, 2.5)).toBe(90);
		expect(roundToNearest(91.25, 2.5)).toBe(92.5); // 91.25 / 2.5 = 36.5 → rounds to 37 → 92.5
		expect(roundToNearest(92, 2.5)).toBe(92.5);
	});

	it('returns value unchanged when factor is 0', () => {
		expect(roundToNearest(92.3, 0)).toBe(92.3);
	});

	it('handles exact multiples', () => {
		expect(roundToNearest(100, 5)).toBe(100);
		expect(roundToNearest(45, 2.5)).toBe(45);
	});
});

// ---------------------------------------------------------------------------
// computeWeight
// ---------------------------------------------------------------------------

describe('computeWeight', () => {
	it('applies percentage, rounds, and clamps', () => {
		// 45% of 200 = 90, rounded to nearest 5 = 90, above min 95 → clamped to 95
		expect(computeWeight(0.45, 200, 5, 95)).toBe(95);
	});

	it('rounds to nearest multiple of rounding factor', () => {
		// 65% of 200 = 130 → rounds to 130 (exact)
		expect(computeWeight(0.65, 200, 5, 95)).toBe(130);
	});

	it('clamps to minimum weight when result is below floor', () => {
		// 45% of 150 = 67.5 → rounds to 70, but min is 95 → 95
		expect(computeWeight(0.45, 150, 5, 95)).toBe(95);
	});

	it('does not clamp when result is above minimum', () => {
		// 85% of 200 = 170 → rounds to 170, min 95 → 170
		expect(computeWeight(0.85, 200, 5, 95)).toBe(170);
	});

	it('handles 100% (top set)', () => {
		expect(computeWeight(1.0, 200, 5, 95)).toBe(200);
	});

	it('rounds up correctly on half boundaries', () => {
		// 85% of 140 = 119 → nearest 2.5 = 120
		expect(computeWeight(0.85, 140, 2.5, 65)).toBe(120);
	});
});

// ---------------------------------------------------------------------------
// computeSetWeight
// ---------------------------------------------------------------------------

describe('computeSetWeight', () => {
	const configs = configMap(benchConfig, squatConfig, pressConfig, deadliftConfig, skullCrusherConfig);

	it('computes a fixed-weight set (bar warmup)', () => {
		const set: SetTemplate = {
			setType: 'warmup',
			percentage: 0,
			weightBasis: { kind: 'fixed', weight: 45 },
			minReps: 10,
			maxReps: 10,
			amrap: false,
		};
		expect(computeSetWeight(set, benchConfig, configs)).toBe(45);
	});

	it('computes a barWeight-based set from the lift config', () => {
		const set: SetTemplate = {
			setType: 'warmup',
			percentage: 1.0,
			weightBasis: { kind: 'barWeight' },
			minReps: 10,
			maxReps: 10,
			amrap: false,
		};
		expect(computeSetWeight(set, benchConfig, configs)).toBe(45);
		expect(computeSetWeight(set, skullCrusherConfig, configs)).toBe(15);
	});

	it('computes a topSet-based warmup', () => {
		const set: SetTemplate = {
			setType: 'warmup',
			percentage: 0.45,
			weightBasis: { kind: 'topSet' },
			minReps: 5,
			maxReps: 5,
			amrap: false,
		};
		// 45% of 200 = 90 → rounds to 90, min 95 → 95
		expect(computeSetWeight(set, benchConfig, configs)).toBe(95);
	});

	it('computes 100% top set', () => {
		const set: SetTemplate = {
			setType: 'work',
			percentage: 1.0,
			weightBasis: { kind: 'topSet' },
			minReps: 3,
			maxReps: 5,
			amrap: false,
		};
		expect(computeSetWeight(set, benchConfig, configs)).toBe(200);
	});

	it('computes a backoff-weight-based set', () => {
		const set: SetTemplate = {
			setType: 'backoff',
			percentage: 1.0,
			weightBasis: { kind: 'backoff' },
			minReps: 5,
			maxReps: 8,
			amrap: true,
		};
		// 100% of 170 = 170 → rounded 170, min 95 → 170
		expect(computeSetWeight(set, benchConfig, configs)).toBe(170);
	});

	it('computes a cross-reference set (secondary press from primary press)', () => {
		const set: SetTemplate = {
			setType: 'work',
			percentage: 0.85,
			weightBasis: { kind: 'crossReference', liftId: 'press' },
			minReps: 5,
			maxReps: 8,
			amrap: false,
		};
		// 85% of press topSetWeight 140 = 119 → nearest 5 = 120, min 95 → 120
		expect(computeSetWeight(set, benchConfig, configs)).toBe(120);
	});

	it('returns null on unknown cross-reference', () => {
		const set: SetTemplate = {
			setType: 'work',
			percentage: 1.0,
			weightBasis: { kind: 'crossReference', liftId: 'unknown-lift' },
			minReps: 5,
			maxReps: 5,
			amrap: false,
		};
		expect(computeSetWeight(set, benchConfig, configs)).toBeNull();
	});

	it('computes a relative-to-top-set set (top set minus 20)', () => {
		const set: SetTemplate = {
			setType: 'backoff',
			percentage: 1.0,
			weightBasis: { kind: 'relative', reference: 'topSet', offset: -20 },
			minReps: 5,
			maxReps: 8,
			amrap: false,
		};
		// 200 - 20 = 180, rounded to 5 = 180, min 95 → 180
		expect(computeSetWeight(set, benchConfig, configs)).toBe(180);
	});

	it('computes a relative-to-backoff set (backoff plus 10)', () => {
		const set: SetTemplate = {
			setType: 'work',
			percentage: 1.0,
			weightBasis: { kind: 'relative', reference: 'backoff', offset: 10 },
			minReps: 5,
			maxReps: 5,
			amrap: false,
		};
		// 170 + 10 = 180, rounded to 5 = 180, min 95 → 180
		expect(computeSetWeight(set, benchConfig, configs)).toBe(180);
	});

	it('rounds a relative result to the rounding factor', () => {
		const set: SetTemplate = {
			setType: 'work',
			percentage: 1.0,
			weightBasis: { kind: 'relative', reference: 'topSet', offset: -1 },
			minReps: 5,
			maxReps: 5,
			amrap: false,
		};
		// press top set 140 - 1 = 139, nearest 2.5 = 140
		expect(computeSetWeight(set, pressConfig, configs)).toBe(140);
	});

	it('clamps a relative result to the minimum weight', () => {
		const set: SetTemplate = {
			setType: 'warmup',
			percentage: 1.0,
			weightBasis: { kind: 'relative', reference: 'backoff', offset: -200 },
			minReps: 5,
			maxReps: 5,
			amrap: false,
		};
		// 170 - 200 = -30 → clamped to min 95
		expect(computeSetWeight(set, benchConfig, configs)).toBe(95);
	});
});

// ---------------------------------------------------------------------------
// computeSet
// ---------------------------------------------------------------------------

describe('computeSet', () => {
	const configs = configMap(benchConfig);

	it('produces a ComputedSet preserving set metadata', () => {
		const set: SetTemplate = {
			setType: 'backoff',
			percentage: 1.0,
			weightBasis: { kind: 'backoff' },
			minReps: 5,
			maxReps: 8,
			amrap: true,
			comment: 'If 8 reps, increase backoff by 2.5 lbs',
		};
		const result = computeSet(set, benchConfig, configs);
		expect(result).toEqual({
			setType: 'backoff',
			weight: 170,
			minReps: 5,
			maxReps: 8,
			amrap: true,
			comment: 'If 8 reps, increase backoff by 2.5 lbs',
		});
	});

	it('omits comment when undefined', () => {
		const set: SetTemplate = {
			setType: 'warmup',
			percentage: 1.0,
			weightBasis: { kind: 'barWeight' },
			minReps: 10,
			maxReps: 10,
			amrap: false,
		};
		const result = computeSet(set, benchConfig, configs);
		expect(result).not.toHaveProperty('comment');
	});

	it('preserves joker set type', () => {
		const set: SetTemplate = {
			setType: 'joker',
			percentage: 1.0,
			weightBasis: { kind: 'topSet' },
			minReps: 1,
			maxReps: 1,
			amrap: false,
		};
		const result = computeSet(set, benchConfig, configs);
		expect(result).not.toBeNull();
		expect(result!.setType).toBe('joker');
		expect(result!.weight).toBe(200);
	});
});

// ---------------------------------------------------------------------------
// computeExercise
// ---------------------------------------------------------------------------

describe('computeExercise', () => {
	const configs = configMap(benchConfig, pressConfig);

	it('returns null when liftId is missing from configs', () => {
		const template: ExerciseTemplate = {
			liftId: 'missing',
			name: 'Ghost Lift',
			role: 'primary',
			sets: [],
		};
		expect(computeExercise(template, configs)).toBeNull();
	});

	it('computes a full primary bench press exercise', () => {
		const template: ExerciseTemplate = {
			liftId: 'bench',
			name: 'Bench Press',
			role: 'primary',
			sets: [
				{
					setType: 'warmup',
					percentage: 1.0,
					weightBasis: { kind: 'barWeight' },
					minReps: 10,
					maxReps: 10,
					amrap: false,
				},
				{
					setType: 'warmup',
					percentage: 0.45,
					weightBasis: { kind: 'topSet' },
					minReps: 5,
					maxReps: 5,
					amrap: false,
				},
				{
					setType: 'warmup',
					percentage: 0.65,
					weightBasis: { kind: 'topSet' },
					minReps: 3,
					maxReps: 3,
					amrap: false,
				},
				{
					setType: 'warmup',
					percentage: 0.85,
					weightBasis: { kind: 'topSet' },
					minReps: 2,
					maxReps: 2,
					amrap: false,
				},
				{
					setType: 'work',
					percentage: 1.0,
					weightBasis: { kind: 'topSet' },
					minReps: 3,
					maxReps: 5,
					amrap: false,
					comment: 'If 5 reps completed, increase by 2.5 lbs next week',
				},
				{
					setType: 'backoff',
					percentage: 1.0,
					weightBasis: { kind: 'backoff' },
					minReps: 5,
					maxReps: 8,
					amrap: true,
					comment: 'If 8 reps completed, increase backoff by 2.5 lbs next week',
				},
			],
		};

		const result = computeExercise(template, configs);
		expect(result).not.toBeNull();
		expect(result!.liftId).toBe('bench');
		expect(result!.name).toBe('Bench Press');
		expect(result!.sets).toHaveLength(6);

		// Bar warmup — fixed 45
		expect(result!.sets[0]).toEqual({
			setType: 'warmup',
			weight: 45,
			minReps: 10,
			maxReps: 10,
			amrap: false,
		});

		// 45% warmup: 45% of 200 = 90 → clamped to 95
		expect(result!.sets[1].weight).toBe(95);

		// 65% warmup: 65% of 200 = 130
		expect(result!.sets[2].weight).toBe(130);

		// 85% warmup: 85% of 200 = 170
		expect(result!.sets[3].weight).toBe(170);

		// Top set: 100% of 200 = 200
		expect(result!.sets[4].weight).toBe(200);
		expect(result!.sets[4].setType).toBe('work');
		expect(result!.sets[4].minReps).toBe(3);
		expect(result!.sets[4].maxReps).toBe(5);
		expect(result!.sets[4].amrap).toBe(false);

		// Backoff: 100% of backoff 170 = 170
		expect(result!.sets[5].weight).toBe(170);
		expect(result!.sets[5].setType).toBe('backoff');
		expect(result!.sets[5].amrap).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// RSS Intermediate B integration-style tests
// ---------------------------------------------------------------------------

describe('RSS Intermediate B scenarios', () => {
	const configs = configMap(
		benchConfig,
		squatConfig,
		pressConfig,
		deadliftConfig,
		skullCrusherConfig,
	);

	it('secondary press derives from primary press top set (cross-reference)', () => {
		// Working weight = 85% of Workout C primary Press top set = 85% of 140 = 119 → 120 (rounded to 5)
		const secondaryPressTemplate: ExerciseTemplate = {
			liftId: 'bench', // secondary press in Workout A uses bench config for rounding/min
			name: 'Press',
			role: 'secondary',
			sets: [
				{
					setType: 'warmup',
					percentage: 1.0,
					weightBasis: { kind: 'barWeight' },
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
			],
		};

		const result = computeExercise(secondaryPressTemplate, configs);
		expect(result).not.toBeNull();
		expect(result!.sets[0].weight).toBe(45); // bar warmup
		expect(result!.sets[1].weight).toBe(120); // 85% of 140 = 119 → 120
	});

	it('secondary deadlift derives from primary deadlift top set', () => {
		// Working weight = 85% of Workout D Deadlift top set = 85% of 350 = 297.5 → 300 (rounded to 5)
		const set: SetTemplate = {
			setType: 'work',
			percentage: 0.85,
			weightBasis: { kind: 'crossReference', liftId: 'deadlift' },
			minReps: 5,
			maxReps: 5,
			amrap: false,
		};
		expect(computeSetWeight(set, squatConfig, configs)).toBe(300);
	});

	it('secondary squat at 75% of primary squat top set', () => {
		// Working weight = 75% of Workout B Squat top set = 75% of 300 = 225
		const set: SetTemplate = {
			setType: 'work',
			percentage: 0.75,
			weightBasis: { kind: 'crossReference', liftId: 'squat' },
			minReps: 5,
			maxReps: 5,
			amrap: false,
		};
		// 75% of 300 = 225 → 225 (exact), min 135 → 225
		expect(computeSetWeight(set, deadliftConfig, configs)).toBe(225);
	});

	it('assistance exercise (skull crusher) uses own independent weights', () => {
		const template: ExerciseTemplate = {
			liftId: 'skull-crusher',
			name: 'Skull Crusher',
			role: 'assistance',
			sets: [
				{
					setType: 'work',
					percentage: 1.0,
					weightBasis: { kind: 'topSet' },
					minReps: 8,
					maxReps: 8,
					amrap: false,
				},
				{
					setType: 'backoff',
					percentage: 1.0,
					weightBasis: { kind: 'backoff' },
					minReps: 8,
					maxReps: 8,
					amrap: true,
				},
			],
		};

		const result = computeExercise(template, configs);
		expect(result).not.toBeNull();
		expect(result!.sets[0].weight).toBe(60);   // 100% of topSetWeight 60
		expect(result!.sets[1].weight).toBe(50);   // 100% of backoffWeight 51 → rounded to nearest 2.5 = 50
	});

	it('lateral raise with rep ranges (no AMRAP)', () => {
		const lateralRaiseConfig: LiftConfig = {
			id: 'lateral-raise',
			name: 'Lateral Raise',
			topSetWeight: 15,
			backoffWeight: 15,
			increment: 5,
			minimumWeight: 5,
			roundingFactor: 5,
			barWeight: 0,
			gear: 'dumbbell',
		};
		const allConfigs = configMap(lateralRaiseConfig);

		const template: ExerciseTemplate = {
			liftId: 'lateral-raise',
			name: 'Lateral Raise',
			role: 'assistance',
			sets: [
				{
					setType: 'work',
					percentage: 1.0,
					weightBasis: { kind: 'topSet' },
					minReps: 10,
					maxReps: 15,
					amrap: false,
				},
				{
					setType: 'work',
					percentage: 1.0,
					weightBasis: { kind: 'topSet' },
					minReps: 10,
					maxReps: 15,
					amrap: false,
				},
				{
					setType: 'work',
					percentage: 1.0,
					weightBasis: { kind: 'topSet' },
					minReps: 10,
					maxReps: 15,
					amrap: false,
					comment: 'Increase weight when 15 reps achieved on all sets',
				},
			],
		};

		const result = computeExercise(template, allConfigs);
		expect(result).not.toBeNull();
		expect(result!.sets).toHaveLength(3);
		for (const set of result!.sets) {
			expect(set.weight).toBe(15);
			expect(set.minReps).toBe(10);
			expect(set.maxReps).toBe(15);
			expect(set.amrap).toBe(false);
		}
	});

	it('deadlift primary has no bar warmup (starts at 45%)', () => {
		const template: ExerciseTemplate = {
			liftId: 'deadlift',
			name: 'Deadlift',
			role: 'primary',
			sets: [
				{
					setType: 'warmup',
					percentage: 0.45,
					weightBasis: { kind: 'topSet' },
					minReps: 5,
					maxReps: 5,
					amrap: false,
				},
				{
					setType: 'warmup',
					percentage: 0.65,
					weightBasis: { kind: 'topSet' },
					minReps: 3,
					maxReps: 3,
					amrap: false,
				},
				{
					setType: 'warmup',
					percentage: 0.85,
					weightBasis: { kind: 'topSet' },
					minReps: 2,
					maxReps: 2,
					amrap: false,
				},
				{
					setType: 'work',
					percentage: 1.0,
					weightBasis: { kind: 'topSet' },
					minReps: 3,
					maxReps: 5,
					amrap: false,
					comment: 'If 5 reps completed, increase by 5 lbs next week',
				},
				{
					setType: 'backoff',
					percentage: 1.0,
					weightBasis: { kind: 'backoff' },
					minReps: 5,
					maxReps: 8,
					amrap: true,
					comment: 'Optional backoff',
				},
			],
		};

		const result = computeExercise(template, configs);
		expect(result).not.toBeNull();
		// 45% of 350 = 157.5 → 160 (rounded to 5)
		expect(result!.sets[0].weight).toBe(160);
		// 65% of 350 = 227.5 → 230
		expect(result!.sets[1].weight).toBe(230);
		// 85% of 350 = 297.5 → 300
		expect(result!.sets[2].weight).toBe(300);
		// 100% of 350 = 350
		expect(result!.sets[3].weight).toBe(350);
		// 100% of backoff 300 = 300
		expect(result!.sets[4].weight).toBe(300);
	});
});
