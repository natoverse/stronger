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
 * Round `value` to the nearest multiple of `factor`.
 * Uses standard "round half up" behaviour.
 */
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
): ComputedSet | null {
	const weight = computeSetWeight(set, liftConfig, allConfigs);
	if (weight === null) return null;
	return {
		setType: set.setType,
		weight,
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
): ComputedExercise | null {
	const liftConfig = allConfigs.get(template.liftId);
	if (!liftConfig) {
		return null;
	}

	const sets: ComputedSet[] = [];
	for (const s of template.sets) {
		const computed = computeSet(s, liftConfig, allConfigs);
		if (computed) sets.push(computed);
	}

	return {
		liftId: template.liftId,
		name: template.name,
		role: template.role,
		sets,
	};
}
