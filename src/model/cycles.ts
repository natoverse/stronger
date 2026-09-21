import type { WorkoutDefinition } from '../data/sample-workouts.js';
import type {
	CycleDefinition, CycleProgress, CycleSessionSnapshot, ExerciseCycleProgress,
	ExerciseTemplate, FrozenExerciseStep, LiftConfig, ProgressionProposal,
	SetResult, Workout,
} from './types.js';
import { computeExercise } from './compute.js';
import { computeProgression } from './progression.js';

export interface TrainingMaxProposal {
	liftId: string;
	liftName: string;
	current: number;
	proposed: number;
	increment: number;
	frozen?: number;
}

export interface CycleTransition {
	exerciseId: string;
	name: string;
	current: string;
	next: string;
	completed: boolean;
	boundary: boolean;
}

export interface CycleFinish {
	progress: CycleProgress;
	proposals: ProgressionProposal[];
	trainingMaxProposals: TrainingMaxProposal[];
	transitions: CycleTransition[];
}

export type BaselineUpdate = { topSetWeight?: number; backoffWeight?: number; trainingMax?: number };

/** Legacy workouts participate in the same repeating one-exposure lifecycle. */
export function normalizeCycle(definition: WorkoutDefinition): CycleDefinition {
	const cycle: CycleDefinition = structuredClone(definition.cycle ?? {
		baseline: 'topSet',
		weeks: [{ id: 'week-1', name: 'Week 1', exposures: [
			{ id: 'session-1', name: 'Session 1', templates: definition.templates },
		] }],
	});
	for (const week of cycle.weeks) {
		for (const exposure of week.exposures) {
			const counts = new Map<string, number>();
			for (const template of exposure.templates) {
				const ordinal = counts.get(template.liftId) ?? 0;
				counts.set(template.liftId, ordinal + 1);
				template.id ??= `${template.liftId}:${ordinal}`;
			}
		}
	}
	return cycle;
}

export function validateCycle(definition: WorkoutDefinition, configs: LiftConfig[]): void {
	if (!definition.name.trim()) throw new Error('Give this cycle a name.');
	const cycle = normalizeCycle(definition);
	if (!['topSet', 'trainingMax'].includes(cycle.baseline)) throw new Error('Choose a cycle progression baseline.');
	if (cycle.weeks.length === 0) throw new Error('Add at least one week.');
	const liftIds = new Map<string, string>();
	for (const week of cycle.weeks) {
		if (!week.name.trim() || week.exposures.length === 0) throw new Error('Each week needs a name and at least one session.');
		for (const exposure of week.exposures) {
			if (!exposure.name.trim() || exposure.templates.length === 0) throw new Error(`${week.name}: add a named session with exercises.`);
			const ids = new Set<string>();
			for (const template of exposure.templates) {
				const id = template.id!;
				if (ids.has(id)) throw new Error(`${exposure.name}: exercise identities must be unique.`);
				ids.add(id);
				if (liftIds.has(id) && liftIds.get(id) !== template.liftId) {
					throw new Error(`${template.name}: the same cycle exercise must reference the same lift in every session.`);
				}
				liftIds.set(id, template.liftId);
				validateTemplate(template, configs, cycle.baseline);
			}
		}
	}
}

function validateTemplate(template: ExerciseTemplate, configs: LiftConfig[], baseline: CycleDefinition['baseline']) {
	const map = new Map(configs.map((config) => [config.id, config]));
	const config = map.get(template.liftId);
	if (!config) throw new Error(`${template.name || template.liftId}: select an existing exercise in the cycle editor.`);
	if (!template.name.trim() || !template.sets.length) throw new Error(`${config.name}: add a named exercise with at least one set.`);
	if (baseline === 'trainingMax') {
		if (!Number.isFinite(config.trainingMax) || (config.trainingMax ?? 0) <= 0) {
			throw new Error(`${config.name}: enter a positive training max in the exercise editor.`);
		}
		if (!Number.isFinite(config.trainingMaxIncrement) || (config.trainingMaxIncrement ?? -1) < 0) {
			throw new Error(`${config.name}: set a separate training-max increment (zero keeps TM unchanged).`);
		}
	}
	for (const set of template.sets) {
		if (!['warmup', 'work', 'backoff', 'joker'].includes(set.setType)
			|| !Number.isInteger(set.minReps) || set.minReps <= 0
			|| !Number.isInteger(set.maxReps) || set.maxReps < set.minReps
			|| typeof set.amrap !== 'boolean') {
			throw new Error(`${config.name}: each set needs a valid type and positive whole-number rep range.`);
		}
		const basis = set.weightBasis;
		if (!basis || !['topSet', 'backoff', 'trainingMax', 'crossReference', 'fixed', 'barWeight', 'relative'].includes(basis.kind)) {
			throw new Error(`${config.name}: choose a valid weight basis.`);
		}
		if (basis.kind === 'fixed') {
			if (!Number.isFinite(basis.weight) || basis.weight < 0) throw new Error(`${config.name}: fixed weight must be nonnegative.`);
		} else if (basis.kind === 'relative') {
			if (!Number.isFinite(basis.offset) || !['topSet', 'backoff'].includes(basis.reference)) throw new Error(`${config.name}: enter a valid relative offset.`);
		} else if (basis.kind !== 'barWeight' && (!Number.isFinite(set.percentage) || set.percentage <= 0)) {
			throw new Error(`${config.name}: percentage must be positive.`);
		}
		if (basis.kind === 'crossReference' && !map.has(basis.liftId)) {
			throw new Error(`${config.name}: cross-referenced exercise ${basis.liftId} is missing.`);
		}
	}
	const computed = computeExercise(template, map);
	if (!computed || computed.sets.length !== template.sets.length || computed.sets.some((set) => !Number.isFinite(set.weight) || set.weight < 0)) {
		throw new Error(`${config.name}: check weights, rounding, minimums, and referenced exercises.`);
	}
}

function stepsByExercise(cycle: CycleDefinition): Map<string, FrozenExerciseStep[]> {
	const sequences = new Map<string, FrozenExerciseStep[]>();
	cycle.weeks.forEach((week, wi) => week.exposures.forEach((exposure, ei) => {
		for (const template of exposure.templates) {
			const id = template.id!;
			if (!sequences.has(id)) sequences.set(id, []);
			sequences.get(id)!.push({
				week: wi + 1, weekCount: cycle.weeks.length,
				exposure: ei + 1, exposureCount: week.exposures.length,
				weekName: week.name, exposureName: exposure.name, template,
			});
		}
	}));
	return sequences;
}

/** Only completed exercises adopt edited definitions/configuration on a new iteration. */
export function prepareCycleProgress(
	definition: WorkoutDefinition,
	configs: LiftConfig[],
	previous?: CycleProgress,
	options: { roundWarmupPlateMath?: boolean } = {},
	createId: () => string = () => crypto.randomUUID(),
): CycleProgress {
	if (previous && previous.workoutId !== definition.id) throw new Error('Cycle progress belongs to a different workout.');
	const cycle = normalizeCycle(definition);
	const sequences = stepsByExercise(cycle);
	const old = new Map(previous?.exercises.map((item) => [item.exerciseId, item]));
	const pending = previous?.exercises.filter((item) => !item.complete) ?? [];
	if (pending.length === 0) validateCycle(definition, configs);
	const ids = [...new Set([...sequences.keys(), ...pending.map((item) => item.exerciseId)])];
	const exercises: ExerciseCycleProgress[] = [];
	for (const exerciseId of ids) {
		const existing = old.get(exerciseId);
		if (existing && !existing.complete) {
			if (!existing.steps[existing.cursor]) throw new Error('Saved cycle stage is invalid. Restore the saved cycle progress before continuing.');
			exercises.push(structuredClone(existing));
			continue;
		}
		const steps = sequences.get(exerciseId);
		if (!steps?.length) continue;
		for (const step of steps) validateTemplate(step.template, configs, cycle.baseline);
		exercises.push({
			exerciseId, iterationId: createId(), iteration: (existing?.iteration ?? 0) + 1,
			cursor: 0, baseline: cycle.baseline, steps: structuredClone(steps),
			configs: structuredClone(configs),
			roundWarmupPlateMath: options.roundWarmupPlateMath ?? false,
			complete: false,
		});
	}
	if (!exercises.length) throw new Error('Add at least one exercise to the cycle.');
	return { workoutId: definition.id, revision: (previous?.revision ?? 0) + 1, exercises,
		...(previous?.lastSessionId ? { lastSessionId: previous.lastSessionId } : {}) };
}

export function workoutFromProgress(definition: Pick<WorkoutDefinition, 'id' | 'name' | 'favorite'>, progress: CycleProgress): Workout {
	return {
		id: definition.id, name: definition.name, favorite: definition.favorite ?? false,
		exercises: progress.exercises.map((item) => {
			const step = item.steps[item.cursor];
			if (!step) throw new Error('Saved exercise stage is invalid.');
			const exercise = computeExercise(step.template, new Map(item.configs.map((config) => [config.id, config])), {
				roundWarmupPlateMath: item.roundWarmupPlateMath,
			});
			if (!exercise || exercise.sets.length !== step.template.sets.length) throw new Error(`${step.template.name}: saved prescription has an unresolved exercise.`);
			return {
				...exercise,
				sets: exercise.sets.map((set, index) => ({ ...set, prescription: structuredClone(step.template.sets[index]) })),
				cycleStage: {
					exerciseId: item.exerciseId, iterationId: item.iterationId, iteration: item.iteration,
					week: step.week, weekCount: step.weekCount, exposure: step.exposure,
					exposureCount: step.exposureCount, weekName: step.weekName, exposureName: step.exposureName,
				},
			};
		}),
	};
}

export function createCycleSession(
	definition: WorkoutDefinition, configs: LiftConfig[], previous?: CycleProgress,
	options: { roundWarmupPlateMath?: boolean; occurrenceId?: string } = {},
	createId: () => string = () => crypto.randomUUID(),
): CycleSessionSnapshot {
	const progress = prepareCycleProgress(definition, configs, previous, options, createId);
	const id = createId();
	return {
		id, workout: workoutFromProgress(definition, progress), progress,
		templates: progress.exercises.map((item) => structuredClone(item.steps[item.cursor].template)),
		...(options.occurrenceId ? { occurrenceId: options.occurrenceId } : {}),
	};
}

export function exerciseCompleted(template: ExerciseTemplate, results: SetResult[] = []): boolean {
	const nonWarmup = template.sets.map((set, index) => ({ set, index })).filter(({ set }) => set.setType !== 'warmup');
	const required = nonWarmup.length ? nonWarmup : template.sets.map((set, index) => ({ set, index }));
	return required.length > 0 && required.every(({ index }) => results[index]?.completed === true);
}

function stageLabel(step: FrozenExerciseStep): string {
	const week = step.weekCount > 1 ? `Week ${step.week}/${step.weekCount}` : 'Week 1';
	return `${week}${step.exposureCount > 1 ? ` · Session ${step.exposure}/${step.exposureCount}` : ''}`;
}

/** A confirmation advances each completed exercise once, never once per set/date. */
export function finishCycle(snapshot: CycleSessionSnapshot, results: SetResult[][], current?: CycleProgress): CycleFinish {
	if (current?.lastSessionId === snapshot.id) {
		return { progress: structuredClone(current), proposals: [], trainingMaxProposals: [], transitions: [] };
	}
	if (current && (current.workoutId !== snapshot.progress.workoutId || current.revision !== snapshot.progress.revision)) {
		throw new Error('This saved workout no longer matches the current cycle progress. Your draft is preserved; resume current progress rather than replaying an older finish.');
	}
	const progress = structuredClone(snapshot.progress);
	progress.revision += 1;
	progress.lastSessionId = snapshot.id;
	const proposals = new Map<string, ProgressionProposal>();
	const trainingMaxProposals = new Map<string, TrainingMaxProposal>();
	const transitions: CycleTransition[] = [];
	progress.exercises.forEach((item, index) => {
		const step = item.steps[item.cursor];
		const completed = exerciseCompleted(step.template, results[index]);
		const boundary = completed && item.cursor === item.steps.length - 1;
		if (completed) {
			if (boundary) item.complete = true;
			else item.cursor += 1;
		}
		transitions.push({
			exerciseId: item.exerciseId, name: step.template.name, current: stageLabel(step),
			next: boundary ? `Iteration ${item.iteration + 1} · ${stageLabel(item.steps[0])}` : stageLabel(item.steps[item.cursor]),
			completed, boundary,
		});
		const config = item.configs.find((config) => config.id === step.template.liftId)!;
		if (item.baseline === 'trainingMax') {
			if (boundary) trainingMaxProposals.set(config.id, {
				liftId: config.id, liftName: config.name, current: config.trainingMax!,
				proposed: config.trainingMax! + config.trainingMaxIncrement!, increment: config.trainingMaxIncrement!,
			});
		} else if (completed || item.steps.length === 1) {
			const signals = computeProgression(
				[snapshot.workout.exercises[index]], [results[index] ?? []], item.configs, [step.template],
			);
			if (item.steps.length > 1) {
				const held = new Map(item.progressionProposals?.map((proposal) => [proposal.liftId, proposal]));
				for (const proposal of signals) {
					const previous = held.get(proposal.liftId);
					held.set(proposal.liftId, previous ? {
						...proposal,
						proposedTopSetWeight: Math.max(previous.proposedTopSetWeight, proposal.proposedTopSetWeight),
						proposedBackoffWeight: Math.max(previous.proposedBackoffWeight, proposal.proposedBackoffWeight),
						topSetHit: previous.topSetHit || proposal.topSetHit,
						backoffHit: previous.backoffHit || proposal.backoffHit,
					} : proposal);
				}
				item.progressionProposals = [...held.values()];
			}
			for (const proposal of boundary ? item.progressionProposals ?? signals : item.steps.length === 1 ? signals : []) {
				const existing = proposals.get(proposal.liftId);
				proposals.set(proposal.liftId, existing ? {
					...proposal,
					proposedTopSetWeight: Math.max(existing.proposedTopSetWeight, proposal.proposedTopSetWeight),
					proposedBackoffWeight: Math.max(existing.proposedBackoffWeight, proposal.proposedBackoffWeight),
					topSetHit: existing.topSetHit || proposal.topSetHit,
					backoffHit: existing.backoffHit || proposal.backoffHit,
				} : proposal);
			}
		}
	});
	// A TM-governed lift never receives work/backoff changes in the same review.
	for (const item of progress.exercises) {
		if (item.baseline === 'trainingMax') proposals.delete(item.steps[0].template.liftId);
	}
	return { progress, proposals: [...proposals.values()], trainingMaxProposals: [...trainingMaxProposals.values()], transitions };
}

export function previewCycles(
	configs: LiftConfig[], definitions: WorkoutDefinition[], progress: CycleProgress[],
	options: { roundWarmupPlateMath?: boolean } = {},
): Workout[] {
	return definitions.map((definition) => {
		try {
			const prepared = prepareCycleProgress(definition, configs, progress.find((item) => item.workoutId === definition.id), options, () => 'preview');
			return workoutFromProgress(definition, prepared);
		} catch (error) {
			return { id: definition.id, name: definition.name, favorite: definition.favorite ?? false, exercises: [],
				error: error instanceof Error ? error.message : String(error) };
		}
	});
}
