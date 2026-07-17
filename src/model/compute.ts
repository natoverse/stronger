import type {
	ComputedExercise,
	ComputedSet,
	ExerciseTemplate,
	LiftConfig,
	SetTemplate,
} from './types.js';

// ---------------------------------------------------------------------------
// Weight calculation helpers
// ---------------------------------------------------------------------------

/**
 * Pre-computed list of "easy plate math" barbell weights:
 * 45 lb bar + any number of 45 lb pairs + at most one 25 lb pair + at most one 10 lb pair.
 *
 * Sequence: 45, 65, 95, 115, 135, 155, 185, 205, 225, 245, 275, 295, 315, ...
 */
const EASY_PLATE_WEIGHTS: readonly number[] = (() => {
	const weights: number[] = [];
	for (let n = 0; n <= 12; n++) {
		for (let b = 0; b <= 1; b++) {
			for (let a = 0; a <= 1; a++) {
				weights.push(45 + 90 * n + 50 * b + 20 * a);
			}
		}
	}
	return weights.sort((x, y) => x - y);
})();

/**
 * If `weight` is within `tolerance` lbs of an "easy plate math" value, return
 * the nearest such value; otherwise return `weight` unchanged.
 */
export function roundToEasyPlateMath(weight: number, tolerance = 5): number {
	let best: number | null = null;
	let bestDiff = Infinity;
	for (const candidate of EASY_PLATE_WEIGHTS) {
		if (candidate > weight + tolerance) break;
		const diff = Math.abs(candidate - weight);
		if (diff <= tolerance && diff < bestDiff) {
			best = candidate;
			bestDiff = diff;
		}
	}
	return best ?? weight;
}


export function roundToNearest(value: number, factor: number): number {
	if (factor <= 0) return value;
	return Math.round(value / factor) * factor;
}

/**
 * Core weight formula: percentage × referenceWeight → round → clamp to min.
 */
export function computeWeight(
	percentage: number,
	referenceWeight: number,
	roundingFactor: number,
	minimumWeight: number,
): number {
	const raw = percentage * referenceWeight;
	const rounded = roundToNearest(raw, roundingFactor);
	return Math.max(rounded, minimumWeight);
}

// ---------------------------------------------------------------------------
// Set / exercise computation
// ---------------------------------------------------------------------------

/**
 * Resolve the reference weight for a single set.
 *
 * @param set          – the set template to resolve
 * @param liftConfig   – the owning lift's configuration
 * @param allConfigs   – lookup map for cross-references
 * @returns the fully calculated weight for this set, or `null` if a
 *          cross-referenced lift is missing from `allConfigs`
 */
export function computeSetWeight(
	set: SetTemplate,
	liftConfig: LiftConfig,
	allConfigs: ReadonlyMap<string, LiftConfig>,
): number | null {
	switch (set.weightBasis.kind) {
		case 'fixed':
			return set.weightBasis.weight;

		case 'barWeight':
			return liftConfig.barWeight;

		case 'topSet':
			return computeWeight(
				set.percentage,
				liftConfig.topSetWeight,
				liftConfig.roundingFactor,
				liftConfig.minimumWeight,
			);

		case 'backoff':
			return computeWeight(
				set.percentage,
				liftConfig.backoffWeight,
				liftConfig.roundingFactor,
				liftConfig.minimumWeight,
			);

		case 'crossReference': {
			const ref = allConfigs.get(set.weightBasis.liftId);
			if (!ref) {
				return null;
			}
			return computeWeight(
				set.percentage,
				ref.topSetWeight,
				liftConfig.roundingFactor,
				liftConfig.minimumWeight,
			);
		}

		case 'relative': {
			const base =
				set.weightBasis.reference === 'topSet'
					? liftConfig.topSetWeight
					: liftConfig.backoffWeight;
			const rounded = roundToNearest(
				base + set.weightBasis.offset,
				liftConfig.roundingFactor,
			);
			return Math.max(rounded, liftConfig.minimumWeight);
		}
	}
}

/**
 * Produce a {@link ComputedSet} from a template.
 * Returns `null` if the set weight cannot be resolved (e.g. missing cross-reference).
 */
export function computeSet(
	set: SetTemplate,
	liftConfig: LiftConfig,
	allConfigs: ReadonlyMap<string, LiftConfig>,
	options?: { roundWarmupPlateMath?: boolean },
): ComputedSet | null {
	const weight = computeSetWeight(set, liftConfig, allConfigs);
	if (weight === null) return null;
	const finalWeight =
		options?.roundWarmupPlateMath && set.setType === 'warmup'
			? roundToEasyPlateMath(weight)
			: weight;
	return {
		setType: set.setType,
		weight: finalWeight,
		minReps: set.minReps,
		maxReps: set.maxReps,
		amrap: set.amrap,
		...(set.comment !== undefined && { comment: set.comment }),
	};
}

/**
 * Compute every set weight for an exercise, producing a week-ready instance.
 *
 * Returns `null` if the template's liftId is not found in `allConfigs`,
 * allowing callers to gracefully skip missing exercises.
 * Sets that cannot be resolved (e.g. missing cross-reference) are silently
 * dropped from the result.
 *
 * @param template   – the exercise template (set list + lift reference)
 * @param allConfigs – all lift configs keyed by id
 * @returns a {@link ComputedExercise} with concrete weights, or `null`
 */
export function computeExercise(
	template: ExerciseTemplate,
	allConfigs: ReadonlyMap<string, LiftConfig>,
	options?: { roundWarmupPlateMath?: boolean },
): ComputedExercise | null {
	const liftConfig = allConfigs.get(template.liftId);
	if (!liftConfig) {
		return null;
	}

	const sets: ComputedSet[] = [];
	for (const s of template.sets) {
		const computed = computeSet(s, liftConfig, allConfigs, options);
		if (computed) sets.push(computed);
	}

	return {
		liftId: template.liftId,
		name: template.name,
		role: template.role,
		sets,
	};
}
