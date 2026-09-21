import { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Copy, Eye, MessageSquare, Plus, Trash2 } from 'lucide-react';
import type { SetTemplate, WeightBasis, SetType, LiftConfig, ExerciseRole, CycleBaseline, ExerciseTemplate } from '../model/types.js';
import { computeSetWeight } from '../model/compute.js';
import type { WorkoutDefinition } from '../data/sample-workouts.js';

/** Local state for an exercise being edited. */
export interface EditableExercise {
	id?: string;
	liftId: string;
	role: ExerciseRole;
	sets: SetTemplate[];
}

/** Local state for a workout being edited. */
export interface EditableWorkout {
	id: string;
	name: string;
	exercises: EditableExercise[];
	cycle?: { baseline: CycleBaseline; weeks: EditableWeek[] };
}

export interface EditableExposure {
	id: string;
	name: string;
	exercises: EditableExercise[];
}

export interface EditableWeek {
	id: string;
	name: string;
	exposures: EditableExposure[];
}

interface WorkoutEditorProps {
	/** Existing definition to edit, or undefined for a new workout. */
	existing?: WorkoutDefinition;
	/** Optional initial values for a new unsaved workout. */
	initialDefinition?: WorkoutDefinition;
	/** All current definitions (used for ID uniqueness checks). */
	allDefinitions: WorkoutDefinition[];
	/** IDs with saved progress remain reserved even after their definition is deleted. */
	reservedIds?: string[];
	/** Available lifts from configs. */
	configs: LiftConfig[];
	roundWarmupPlateMath?: boolean;
	onSave: (definition: WorkoutDefinition) => void;
	onCancel: () => void;
	/** Called when the user deletes this workout. Only available when editing an existing workout. */
	onDelete?: (workoutId: string) => void;
}

const SET_TYPES: SetType[] = ['warmup', 'work', 'backoff', 'joker'];
const ROLES: ExerciseRole[] = ['primary', 'secondary', 'assistance'];

function setTypeLabel(type: SetType): string {
	switch (type) {
		case 'warmup': return 'Warm-up';
		case 'work': return 'Work';
		case 'backoff': return 'Backoff';
		case 'joker': return 'Joker';
	}
}

function roleLabel(role: ExerciseRole): string {
	switch (role) {
		case 'primary': return 'Primary';
		case 'secondary': return 'Secondary';
		case 'assistance': return 'Assistance';
	}
}

/**
 * Offset input for a `relative` weight basis. Uses local text state so that
 * an in-progress negative value (a lone "-") is not coerced to 0 mid-typing,
 * keeping incomplete input visible while validation blocks saving.
 */
function RelativeOffsetInput({
	offset,
	onCommit,
}: {
	offset: number;
	onCommit: (value: number) => void;
}) {
	const [text, setText] = useState(String(offset));

	// Re-sync only when the committed `offset` prop changes externally
	// (e.g. switching the reference). `text` is intentionally excluded from
	// the dependency array: depending on it would re-run this effect on every
	// keystroke and clobber a valid in-progress entry such as a lone "-".
	// The guard skips the reset when the text already represents the offset.
	useEffect(() => {
		if (!Number.isFinite(offset)) return;
		const parsed = Number(text);
		if (Number.isFinite(parsed) && parsed === offset) return;
		setText(String(offset));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [offset]);

	return (
		<input
			type="text"
			inputMode="text"
			className="editor-basis-extra-input"
			value={text}
			placeholder="± lbs"
			onFocus={(e) => e.target.select()}
			onChange={(e) => {
				const raw = e.target.value;
				setText(raw);
				const n = Number(raw);
				onCommit(raw.trim() !== '' && Number.isFinite(n) ? n : NaN);
			}}
		/>
	);
}

/** Generate a kebab-case ID from a workout name. */
export function nameToId(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

/** Default set template for newly added sets. */
function defaultSet(): SetTemplate {
	return {
		setType: 'work',
		percentage: 1.0,
		weightBasis: { kind: 'topSet' },
		minReps: 5,
		maxReps: 5,
		amrap: false,
	};
}

/** Move a set to a new position without mutating the original list. */
export function moveItem<T>(sets: T[], fromIndex: number, toIndex: number): T[] {
	if (
		fromIndex < 0
		|| fromIndex >= sets.length
		|| toIndex < 0
		|| toIndex >= sets.length
		|| fromIndex === toIndex
	) {
		return sets;
	}
	const reordered = [...sets];
	const [set] = reordered.splice(fromIndex, 1);
	reordered.splice(toIndex, 0, set);
	return reordered;
}

export const moveSet = moveItem<SetTemplate>;

function editableExercises(templates: ExerciseTemplate[]): EditableExercise[] {
	const occurrences = new Map<string, number>();
	return templates.map((template) => {
		const occurrence = occurrences.get(template.liftId) ?? 0;
		occurrences.set(template.liftId, occurrence + 1);
		return {
			id: template.id ?? `${template.liftId}:${occurrence}`,
			liftId: template.liftId,
			role: template.role,
			sets: structuredClone(template.sets),
		};
	});
}

export function copyExposure(source: EditableExposure, destination?: EditableWorkout): EditableExposure {
	const copy = { ...structuredClone(source), id: crypto.randomUUID(), name: `${source.name} (Copy)` };
	if (destination) {
		const existing = destination.cycle?.weeks.flatMap((week) => week.exposures.flatMap((exposure) => exposure.exercises)) ?? destination.exercises;
		const used = new Set<string>();
		copy.exercises = copy.exercises.map((exercise) => {
			const candidates = existing.filter((item) => item.liftId === exercise.liftId && item.id && !used.has(item.id));
			const match = candidates.find((item) => item.id === exercise.id)
				?? candidates.find((item) => item.role === exercise.role)
				?? candidates[0];
			const id = match?.id ?? exercise.id;
			if (id) used.add(id);
			return { ...exercise, ...(id ? { id } : {}) };
		});
	}
	return copy;
}

export function copyWeek(source: EditableWeek, destination?: EditableWorkout): EditableWeek {
	return {
		...structuredClone(source),
		id: crypto.randomUUID(),
		name: `${source.name} (Copy)`,
		exposures: source.exposures.map((exposure) => ({ ...copyExposure(exposure, destination), name: exposure.name })),
	};
}

export function updateExposureExercises(
	workout: EditableWorkout,
	weekIndex: number,
	exposureIndex: number,
	update: (exercises: EditableExercise[]) => EditableExercise[],
): EditableWorkout {
	if (!workout.cycle) return { ...workout, exercises: update(workout.exercises) };
	const cycle = {
		...workout.cycle,
		weeks: workout.cycle.weeks.map((week, wi) => wi !== weekIndex ? week : {
			...week,
			exposures: week.exposures.map((exposure, ei) => ei !== exposureIndex ? exposure : {
				...exposure, exercises: update(exposure.exercises),
			}),
		}),
	};
	return { ...workout, cycle, exercises: cycle.weeks[0]?.exposures[0]?.exercises ?? [] };
}

/** Convert a WorkoutDefinition to the local editable format. */
export function toEditable(def: WorkoutDefinition): EditableWorkout {
	const weeks = def.cycle
		? def.cycle.weeks.map((week) => ({
			...week,
			exposures: week.exposures.map((exposure) => ({
				id: exposure.id, name: exposure.name, exercises: editableExercises(exposure.templates),
			})),
		}))
		: [{ id: 'week-1', name: 'Week 1', exposures: [
			{ id: 'session-1', name: 'Session 1', exercises: editableExercises(def.templates) },
		] }];
	return {
		id: def.id,
		name: def.name,
		exercises: weeks[0]?.exposures[0]?.exercises ?? [],
		cycle: { baseline: def.cycle?.baseline ?? 'topSet', weeks },
	};
}

/** Convert the local editable format back to a WorkoutDefinition. */
export function fromEditable(e: EditableWorkout, configs: LiftConfig[], existing?: WorkoutDefinition): WorkoutDefinition {
	const liftMap = new Map(configs.map((c) => [c.id, c.name]));
	const templates = (exercises: EditableExercise[]): ExerciseTemplate[] => exercises.map((ex) => ({
		...(ex.id ? { id: ex.id } : {}),
		liftId: ex.liftId,
		name: liftMap.get(ex.liftId) ?? ex.liftId,
		role: ex.role,
		sets: structuredClone(ex.sets),
	}));
	const cycle = e.cycle ? {
		baseline: e.cycle.baseline,
		weeks: e.cycle.weeks.map((week) => ({
			id: week.id, name: week.name.trim(),
			exposures: week.exposures.map((exposure) => ({
				id: exposure.id, name: exposure.name.trim(), templates: templates(exposure.exercises),
			})),
		})),
	} : undefined;
	return {
		id: e.id,
		name: e.name.trim(),
		favorite: existing?.favorite,
		templates: cycle ? structuredClone(cycle.weeks[0]?.exposures[0]?.templates ?? []) : templates(e.exercises),
		...(cycle ? { cycle } : {}),
	};
}

export function validateEditableWorkout(workout: EditableWorkout, configs: LiftConfig[]): string[] {
	const errors: string[] = [];
	if (!workout.name.trim()) errors.push('Workout name is required');
	const configMap = new Map(configs.map((config) => [config.id, config]));
	const weeks = workout.cycle?.weeks ?? [{ name: 'Week 1', exposures: [{ name: 'Session 1', exercises: workout.exercises }] }];
	if (!weeks.length) errors.push('Add at least one week');
	weeks.forEach((week, wi) => {
		const weekLabel = `Week ${wi + 1}`;
		if (!week.name.trim()) errors.push(`${weekLabel}: enter a name`);
		if (!week.exposures.length) errors.push(`${weekLabel}: add at least one session`);
		week.exposures.forEach((exposure, ei) => {
			const stage = `${weekLabel}, session ${ei + 1}`;
			if (!exposure.name.trim()) errors.push(`${stage}: enter a name`);
			if (!exposure.exercises.length) errors.push(`${stage}: add at least one exercise`);
			const identities = new Set<string>();
			exposure.exercises.forEach((exercise, xi) => {
				const label = `${stage}, exercise ${xi + 1}`;
				const config = configMap.get(exercise.liftId);
				if (!config) errors.push(`${label}: select an available lift`);
				if (exercise.id && identities.has(exercise.id)) errors.push(`${label}: duplicate exercise identity; remove and add this exercise again`);
				if (exercise.id) identities.add(exercise.id);
				if (!exercise.sets.length) errors.push(`${label}: add at least one set`);
				if (config && exercise.sets.some((set) => set.weightBasis.kind === 'trainingMax')) {
					if (!Number.isFinite(config.trainingMax) || config.trainingMax! <= 0) {
						errors.push(`${label}: set a positive Training Max (TM) for ${config.name} in Exercises`);
					}
					if (workout.cycle?.baseline === 'trainingMax'
						&& exercise.sets.some((set) => set.setType !== 'warmup' && set.weightBasis.kind === 'trainingMax')
						&& (!Number.isFinite(config.trainingMaxIncrement) || config.trainingMaxIncrement! < 0)) {
						errors.push(`${label}: set a nonnegative TM increment for ${config.name} in Exercises (0 means no increase)`);
					}
				}
				exercise.sets.forEach((set, si) => {
					const setLabel = `${label}, set ${si + 1}`;
					if (!Number.isInteger(set.minReps) || set.minReps <= 0 || !Number.isInteger(set.maxReps) || set.maxReps < set.minReps) {
						errors.push(`${setLabel}: enter positive whole-number reps with maximum at least minimum`);
					}
					const basis = set.weightBasis;
					if (!['fixed', 'barWeight', 'relative'].includes(basis.kind) && (!Number.isFinite(set.percentage) || set.percentage <= 0)) {
						errors.push(`${setLabel}: percentage must be finite and greater than zero`);
					}
					if (basis.kind === 'fixed' && (!Number.isFinite(basis.weight) || basis.weight < 0)) {
						errors.push(`${setLabel}: fixed weight must be finite and nonnegative`);
					}
					if (basis.kind === 'relative' && !Number.isFinite(basis.offset)) errors.push(`${setLabel}: enter a finite weight offset`);
					if (basis.kind === 'crossReference' && !configMap.has(basis.liftId)) errors.push(`${setLabel}: select an available cross-reference lift`);
				});
			});
		});
	});
	return errors;
}

export function weightBasisLabel(set: SetTemplate, configs: LiftConfig[]): string {
	const basis = set.weightBasis;
	switch (basis.kind) {
		case 'fixed': return `Fixed ${basis.weight} lbs`;
		case 'barWeight': return 'Bar weight';
		case 'relative': return `${basis.reference === 'topSet' ? 'Top set' : 'Backoff'} ${basis.offset < 0 ? '−' : '+'} ${Math.abs(basis.offset)} lbs`;
		case 'crossReference': return `${set.percentage * 100}% of ${configs.find((config) => config.id === basis.liftId)?.name ?? basis.liftId} top set`;
		case 'trainingMax': return `${Number((set.percentage * 100).toFixed(4))}% of Training Max (TM)`;
		case 'backoff': return `${Number((set.percentage * 100).toFixed(4))}% of backoff`;
		case 'topSet': return `${Number((set.percentage * 100).toFixed(4))}% of top set`;
	}
}

export function previewExposure(exposure: EditableExposure, configs: LiftConfig[], roundWarmupPlateMath = false) {
	const configMap = new Map(configs.map((config) => [config.id, config]));
	return exposure.exercises.map((exercise) => {
		const config = configMap.get(exercise.liftId);
		if (!config) throw new Error(`Select an available lift for ${exercise.liftId || 'this exercise'}`);
		return {
			name: config.name,
			sets: exercise.sets.map((set) => {
				const weight = computeSetWeight(set, config, configMap, { roundWarmupPlateMath });
				if (weight === null || !Number.isFinite(weight)) throw new Error(`${config.name}: check this set's weight basis and shared exercise settings`);
				return { ...set, weight, basisLabel: weightBasisLabel(set, configs) };
			}),
		};
	});
}

function initialEditableWorkout(
	existing?: WorkoutDefinition,
	initialDefinition?: WorkoutDefinition,
): EditableWorkout {
	if (existing) return toEditable(existing);
	if (initialDefinition) return toEditable(initialDefinition);
	return toEditable({ id: '', name: '', templates: [] });
}

export function WorkoutEditor({
	existing,
	initialDefinition,
	allDefinitions,
	reservedIds = [],
	configs,
	roundWarmupPlateMath = false,
	onSave,
	onCancel,
	onDelete,
}: WorkoutEditorProps) {
	const [workout, setWorkout] = useState<EditableWorkout>(() =>
		initialEditableWorkout(existing, initialDefinition),
	);
	const [saving, setSaving] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [commentTarget, setCommentTarget] = useState<{ exerciseIdx: number; setIdx: number } | null>(null);
	const [weekIndex, setWeekIndex] = useState(0);
	const [exposureIndex, setExposureIndex] = useState(0);
	const [showPreview, setShowPreview] = useState(false);
	const cycle = workout.cycle!;
	const week = cycle.weeks[weekIndex];
	const exposure = week?.exposures[exposureIndex];
	const exercises = exposure?.exercises ?? [];

	const isNew = !existing;
	const copySources = [
		{ name: 'This cycle', workout },
		...allDefinitions.filter((definition) => definition.id !== existing?.id).map((definition) => ({
			name: definition.name, workout: toEditable(definition),
		})),
	];
	const weekSources = copySources.flatMap((source) => source.workout.cycle!.weeks.map((sourceWeek) => ({
		label: `${source.name} — ${sourceWeek.name}`, week: sourceWeek,
	})));
	const exposureSources = weekSources.flatMap((source) => source.week.exposures.map((sourceExposure) => ({
		label: `${source.label} — ${sourceExposure.name}`, exposure: sourceExposure,
	})));

	// Available lifts sorted by name
	const lifts = useMemo(
		() => [...configs].sort((a, b) => a.name.localeCompare(b.name)),
		[configs],
	);

	// IDs already used by other definitions (excluding current if editing)
	const usedIds = useMemo(() => {
		const ids = new Set([...allDefinitions.map((d) => d.id), ...reservedIds]);
		if (existing) ids.delete(existing.id);
		return ids;
	}, [allDefinitions, existing, reservedIds]);

	// Validation
	const autoId = nameToId(workout.name);
	const effectiveId = isNew ? (workout.id || autoId) : workout.id;
	const errors = validateEditableWorkout(workout, configs);
	if (!effectiveId) errors.push('Workout ID is required');
	if (isNew && usedIds.has(effectiveId)) errors.push(`ID "${effectiveId}" is already in use`);
	const isValid = errors.length === 0;

	const preview = (() => {
		if (!showPreview || !week || !exposure) return { exercises: [], errors: [] };
		const previewErrors = validateEditableWorkout({
			...workout, cycle: { ...cycle, weeks: [{ ...week, exposures: [exposure] }] },
		}, configs);
		if (previewErrors.length) return { exercises: [], errors: previewErrors };
		try {
			return { exercises: previewExposure(exposure, configs, roundWarmupPlateMath), errors: [] };
		} catch (error) {
			return { exercises: [], errors: [error instanceof Error ? error.message : 'Check shared exercise weight settings'] };
		}
	})();

	const updateWeeks = (update: (weeks: EditableWeek[]) => EditableWeek[]) => {
		setCommentTarget(null);
		setWorkout((previous) => {
			const weeks = update(previous.cycle!.weeks);
			return { ...previous, cycle: { ...previous.cycle!, weeks }, exercises: weeks[0]?.exposures[0]?.exercises ?? [] };
		});
	};
	const updateExposures = (update: (exposures: EditableExposure[]) => EditableExposure[]) => {
		updateWeeks((weeks) => weeks.map((item, index) => index === weekIndex ? { ...item, exposures: update(item.exposures) } : item));
	};
	const appendWeek = (newWeek?: EditableWeek) => {
		setWeekIndex(cycle.weeks.length);
		setExposureIndex(0);
		updateWeeks((weeks) => [...weeks, newWeek ?? {
			id: crypto.randomUUID(), name: `Week ${weeks.length + 1}`,
			exposures: [{ id: crypto.randomUUID(), name: 'Session 1', exercises: [] }],
		}]);
	};
	const appendExposure = (newExposure?: EditableExposure) => {
		setExposureIndex(week.exposures.length);
		updateExposures((items) => [...items, newExposure ?? {
			id: crypto.randomUUID(), name: `Session ${items.length + 1}`, exercises: [],
		}]);
	};

	const editExercises = useCallback((update: (items: EditableExercise[]) => EditableExercise[]) => {
		setWorkout((previous) => updateExposureExercises(previous, weekIndex, exposureIndex, update));
	}, [weekIndex, exposureIndex]);

	const identityForLift = (liftId: string, remaining: EditableExercise[]) => {
		const used = new Set(remaining.map((exercise) => exercise.id));
		return cycle.weeks.flatMap((item) => item.exposures.flatMap((session) => session.exercises))
			.find((exercise) => exercise.liftId === liftId && exercise.id && !used.has(exercise.id))?.id ?? crypto.randomUUID();
	};

	// --- Workout-level updates ---
	const updateName = useCallback((name: string) => {
		setWorkout((prev) => ({ ...prev, name }));
	}, []);

	const updateId = useCallback((id: string) => {
		setWorkout((prev) => ({ ...prev, id }));
	}, []);

	// --- Exercise-level updates ---
	const addExercise = () => {
		if (lifts.length === 0) return;
		const id = identityForLift(lifts[0].id, exercises);
		editExercises((items) => [...items, { id, liftId: lifts[0].id, role: 'assistance', sets: [defaultSet()] }]);
	};

	const removeExercise = useCallback((idx: number) => {
		editExercises((items) => items.filter((_, i) => i !== idx));
	}, [editExercises]);

	const updateExercise = useCallback(
		(idx: number, patch: Partial<EditableExercise>) => {
			editExercises((items) => items.map((ex, i) =>
					i === idx ? { ...ex, ...patch } : ex,
			));
		},
		[editExercises],
	);

	// --- Set-level updates ---
	const addSet = useCallback((exerciseIdx: number) => {
		editExercises((items) => items.map((ex, i) => {
				if (i !== exerciseIdx) return ex;
				const last = ex.sets[ex.sets.length - 1];
				return {
					...ex,
					sets: [...ex.sets, last ? structuredClone(last) : defaultSet()],
				};
			}));
	}, [editExercises]);

	const removeSet = useCallback((exerciseIdx: number, setIdx: number) => {
		editExercises((items) => items.map((ex, i) => {
				if (i !== exerciseIdx) return ex;
				return {
					...ex,
					sets: ex.sets.filter((_, si) => si !== setIdx),
				};
			}));
	}, [editExercises]);

	const reorderSet = useCallback((exerciseIdx: number, setIdx: number, direction: -1 | 1) => {
		editExercises((items) => items.map((ex, i) =>
				i === exerciseIdx
					? { ...ex, sets: moveSet(ex.sets, setIdx, setIdx + direction) }
					: ex,
			));
	}, [editExercises]);

	const updateSet = useCallback(
		(exerciseIdx: number, setIdx: number, patch: Partial<SetTemplate>) => {
			editExercises((items) => items.map((ex, ei) => {
					if (ei !== exerciseIdx) return ex;
					return {
						...ex,
						sets: ex.sets.map((s, si) =>
							si === setIdx ? { ...s, ...patch } : s,
						),
					};
				}));
		},
		[editExercises],
	);

	const updateWeightBasis = useCallback(
		(exerciseIdx: number, setIdx: number, kind: string, extraValue?: string) => {
			let wb: WeightBasis;
			switch (kind) {
				case 'trainingMax':
					wb = { kind: 'trainingMax' };
					break;
				case 'backoff':
					wb = { kind: 'backoff' };
					break;
				case 'barWeight':
					wb = { kind: 'barWeight' };
					break;
				case 'crossReference': {
					const refLiftId = extraValue || lifts[0]?.id;
					if (!refLiftId) return; // no lifts available
					wb = { kind: 'crossReference', liftId: refLiftId };
					break;
				}
				case 'fixed':
					wb = { kind: 'fixed', weight: extraValue === undefined ? 0 : extraValue.trim() ? Number(extraValue) : NaN };
					break;
				case 'relative:topSet':
					wb = { kind: 'relative', reference: 'topSet', offset: extraValue === undefined ? 0 : Number(extraValue) };
					break;
				case 'relative:backoff':
					wb = { kind: 'relative', reference: 'backoff', offset: extraValue === undefined ? 0 : Number(extraValue) };
					break;
				default:
					wb = { kind: 'topSet' };
					break;
			}
			updateSet(exerciseIdx, setIdx, { weightBasis: wb });
		},
		[lifts, updateSet],
	);

	// --- Save ---
	const handleSave = useCallback(() => {
		if (!isValid || saving) return;
		setSaving(true);
		const def = fromEditable(
			{ ...workout, id: effectiveId },
			configs,
			existing,
		);
		onSave(def);
	}, [isValid, saving, workout, effectiveId, configs, existing, onSave]);

	// --- Delete ---
	const handleDelete = useCallback(() => {
		if (!existing || !onDelete) return;
		if (!confirmDelete) {
			setConfirmDelete(true);
			return;
		}
		setConfirmDelete(false);
		onDelete(existing.id);
	}, [existing, onDelete, confirmDelete]);

	return (
		<div className="workout-editor">
			<header className="workout-header">
				<button className="btn-back" onClick={onCancel}>
					<ArrowLeft size={20} /> Cancel
				</button>
				<h1 className="workout-title">
					{isNew ? 'New Workout' : 'Edit Workout'}
				</h1>
				<button
					className="btn-finish"
					disabled={!isValid || saving}
					onClick={handleSave}
				>
					{saving ? 'Saving…' : 'Save'}
				</button>
			</header>

			{/* Workout metadata */}
			<section className="editor-section">
				<label className="editor-field">
					<span className="editor-field-label">Workout Name</span>
					<input
						type="text"
						className="editor-text-input"
						value={workout.name}
						placeholder="e.g. Workout A — Bench / Press"
						onChange={(e) => updateName(e.target.value)}
					/>
				</label>
				{isNew && (
					<label className="editor-field">
						<span className="editor-field-label">
							ID <span className="editor-field-hint">{autoId ? `(auto: ${autoId})` : ''}</span>
						</span>
						<input
							type="text"
							className="editor-text-input editor-id-input"
							value={workout.id}
							placeholder={autoId || 'auto-generated from name'}
							onChange={(e) => updateId(e.target.value)}
						/>
					</label>
				)}
				<label className="editor-field">
					<span className="editor-field-label">Progression baseline</span>
					<select className="editor-select" value={cycle.baseline} onChange={(event) =>
						setWorkout((previous) => ({ ...previous, cycle: { ...previous.cycle!, baseline: event.target.value as CycleBaseline } }))
					}>
						<option value="topSet">Top set / backoff</option>
						<option value="trainingMax">Training Max (TM)</option>
					</select>
				</label>
				<p className="cycle-editor-hint">
					Each workout is a named cycle. Exercises progress independently when you confirm completed work.
					{cycle.baseline === 'trainingMax'
						? ' TM increases are reviewed only after each exercise finishes its final session, including deload weeks, using its separate TM increment.'
						: ' Top-set and backoff increases use performance and the normal increment, reviewed at each exercise’s iteration boundary.'}
					{' '}The baseline does not change individual set weight bases.
				</p>
				<p className="cycle-editor-hint">
					Edits to templates and shared exercise inputs apply when each exercise begins its next iteration.
					Pending prescriptions and unfinished sessions stay frozen. Copying creates independent prescriptions, not live links.
				</p>
			</section>

			<section className="editor-section cycle-stage-editor" aria-label="Cycle weeks and sessions">
				<h2>Weeks and sessions</h2>
				<label className="editor-field">
					<span className="editor-field-label">Week to edit or preview</span>
					<select className="editor-select" value={week?.id ?? ''} onChange={(event) => {
						setWeekIndex(cycle.weeks.findIndex((item) => item.id === event.target.value));
						setExposureIndex(0);
						setCommentTarget(null);
					}}>
						{!week && <option value="">Add a week below</option>}
						{cycle.weeks.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.name || 'Unnamed week'}</option>)}
					</select>
				</label>
				{week && <>
					<label className="editor-field">
						<span className="editor-field-label">Week name</span>
						<input className="editor-text-input" value={week.name} onChange={(event) => updateWeeks((items) =>
							items.map((item, index) => index === weekIndex ? { ...item, name: event.target.value } : item)
						)} />
					</label>
					<div className="cycle-stage-actions">
						<button type="button" disabled={weekIndex === 0} onClick={() => {
							updateWeeks((items) => moveItem(items, weekIndex, weekIndex - 1));
							setWeekIndex(weekIndex - 1);
						}}><ArrowUp size={16} /> Move week up</button>
						<button type="button" disabled={weekIndex === cycle.weeks.length - 1} onClick={() => {
							updateWeeks((items) => moveItem(items, weekIndex, weekIndex + 1));
							setWeekIndex(weekIndex + 1);
						}}><ArrowDown size={16} /> Move week down</button>
						<button type="button" onClick={() => appendWeek(copyWeek(week))}><Copy size={16} /> Duplicate week</button>
						<button type="button" onClick={() => {
							updateWeeks((items) => items.filter((_, index) => index !== weekIndex));
							setWeekIndex(Math.max(0, weekIndex - 1));
							setExposureIndex(0);
						}}><Trash2 size={16} /> Delete week</button>
					</div>
				</>}
				<button type="button" className="btn-add-exercise" onClick={() => appendWeek()}><Plus size={18} /> Add week</button>
				<label className="editor-field">
					<span className="editor-field-label">Copy week from</span>
					<select className="editor-select" value="" onChange={(event) => {
						if (event.target.value !== '') appendWeek(copyWeek(weekSources[Number(event.target.value)].week, workout));
					}}>
						<option value="">Choose a week to copy…</option>
						{weekSources.map((source, index) => <option key={index} value={index}>{source.label}</option>)}
					</select>
				</label>
				{week && <div className="cycle-exposure-editor">
					<label className="editor-field">
						<span className="editor-field-label">Within-week session to edit or preview</span>
						<select className="editor-select" value={exposure?.id ?? ''} onChange={(event) => {
							setExposureIndex(week.exposures.findIndex((item) => item.id === event.target.value));
							setCommentTarget(null);
						}}>
							{!exposure && <option value="">Add a session below</option>}
							{week.exposures.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.name || 'Unnamed session'}</option>)}
						</select>
					</label>
					{exposure && <>
						<label className="editor-field">
							<span className="editor-field-label">Session name</span>
							<input className="editor-text-input" value={exposure.name} onChange={(event) => updateExposures((items) =>
								items.map((item, index) => index === exposureIndex ? { ...item, name: event.target.value } : item)
							)} />
						</label>
						<div className="cycle-stage-actions">
							<button type="button" disabled={exposureIndex === 0} onClick={() => {
								updateExposures((items) => moveItem(items, exposureIndex, exposureIndex - 1));
								setExposureIndex(exposureIndex - 1);
							}}><ArrowUp size={16} /> Move session up</button>
							<button type="button" disabled={exposureIndex === week.exposures.length - 1} onClick={() => {
								updateExposures((items) => moveItem(items, exposureIndex, exposureIndex + 1));
								setExposureIndex(exposureIndex + 1);
							}}><ArrowDown size={16} /> Move session down</button>
							<button type="button" onClick={() => appendExposure(copyExposure(exposure))}><Copy size={16} /> Duplicate session</button>
							<button type="button" onClick={() => {
								updateExposures((items) => items.filter((_, index) => index !== exposureIndex));
								setExposureIndex(Math.max(0, exposureIndex - 1));
							}}><Trash2 size={16} /> Delete session</button>
						</div>
					</>}
					<button type="button" className="btn-add-exercise" onClick={() => appendExposure()}><Plus size={18} /> Add session</button>
					<label className="editor-field">
						<span className="editor-field-label">Copy session from</span>
						<select className="editor-select" value="" onChange={(event) => {
							if (event.target.value !== '') appendExposure(copyExposure(exposureSources[Number(event.target.value)].exposure, workout));
						}}>
							<option value="">Choose a session to copy…</option>
							{exposureSources.map((source, index) => <option key={index} value={index}>{source.label}</option>)}
						</select>
					</label>
				</div>}
				<p className="cycle-editor-hint">Weeks are programming order, not calendar deadlines. Each exercise visits its sessions in order; individual sets are not progression steps.</p>
			</section>

			{exposure && <section className="editor-section cycle-preview">
				<h2>Week {weekIndex + 1} of {cycle.weeks.length}: {week.name} · Session {exposureIndex + 1}: {exposure.name}</h2>
				<button type="button" className="btn-add-exercise" aria-expanded={showPreview} onClick={() => setShowPreview(!showPreview)}>
					<Eye size={18} /> {showPreview ? 'Hide preview' : 'Preview session'}
				</button>
				{showPreview && <>
					<p className="cycle-editor-hint">Preview uses current shared inputs and rounding/minimum settings. It never starts or advances an exercise. Pending snapshots may differ.</p>
					{preview.errors.length > 0 && <div role="alert">{preview.errors.map((error, index) => <p className="editor-error" key={index}>{error}</p>)}</div>}
					{preview.exercises.map((exercise, index) => <div key={index}>
						<h3>{exercise.name}</h3>
						<ol className="cycle-preview-sets">{exercise.sets.map((set, index) => <li key={index}>
							<span>{setTypeLabel(set.setType)} · {set.amrap ? `${set.minReps}+ (AMRAP)` : set.minReps === set.maxReps ? set.minReps : `${set.minReps}–${set.maxReps}`} reps</span>
							<span>{set.basisLabel}</span>
							<strong>{set.weight} lbs</strong>
						</li>)}</ol>
					</div>)}
				</>}
			</section>}

			{/* Exercises */}
			<>
				{exercises.map((exercise, exerciseIdx) => (
						<section key={`${exposure?.id}:${exercise.id ?? exerciseIdx}`} className="editor-exercise">
							<div className="editor-exercise-header">
								<span className="editor-exercise-number">
									Exercise {exerciseIdx + 1}
								</span>
								<button type="button" className="btn-move-set" aria-label={`Move exercise ${exerciseIdx + 1} up`} disabled={exerciseIdx === 0} onClick={() => editExercises((items) => moveItem(items, exerciseIdx, exerciseIdx - 1))}><ArrowUp size={16} /></button>
								<button type="button" className="btn-move-set" aria-label={`Move exercise ${exerciseIdx + 1} down`} disabled={exerciseIdx === exercises.length - 1} onClick={() => editExercises((items) => moveItem(items, exerciseIdx, exerciseIdx + 1))}><ArrowDown size={16} /></button>
								<button
									type="button"
									className="btn-remove-exercise"
									aria-label="Remove exercise"
									onClick={() => removeExercise(exerciseIdx)}
								>
									<Trash2 size={16} />
								</button>
							</div>
							<div className="editor-exercise-meta">
								<label className="editor-field editor-field-inline">
									<span className="editor-field-label">Lift</span>
									<select
										className="editor-select"
										value={exercise.liftId}
										onChange={(e) =>
											updateExercise(exerciseIdx, {
												liftId: e.target.value,
												id: identityForLift(e.target.value, exercises.filter((_, index) => index !== exerciseIdx)),
											})
										}
									>
										{!exercise.liftId && <option value="">Select…</option>}
										{lifts.map((l) => (
											<option key={l.id} value={l.id}>
												{l.name}
											</option>
										))}
									</select>
								</label>
								<label className="editor-field editor-field-inline">
									<span className="editor-field-label">Role</span>
									<select
										className="editor-select"
										value={exercise.role}
										onChange={(e) =>
											updateExercise(exerciseIdx, {
												role: e.target.value as ExerciseRole,
											})
										}
									>
										{ROLES.map((r) => (
											<option key={r} value={r}>
												{roleLabel(r)}
											</option>
										))}
									</select>
								</label>
							</div>

							{/* Sets */}
							<div className="editor-sets">
								<div className="editor-sets-header">
									<span className="editor-col-type">Type</span>
									<span className="editor-col-pct">%</span>
									<span className="editor-col-basis">Basis</span>
									<span className="editor-col-reps">Min</span>
									<span className="editor-col-reps">Max</span>
									<span className="editor-col-amrap">AMRAP</span>
									<span className="editor-col-comment"></span>
									<span className="editor-col-move"></span>
									<span className="editor-col-remove"></span>
								</div>
								{exercise.sets.map((set, setIdx) => (
									<div key={setIdx} className="editor-set-row">
										<select
											className={`editor-set-type set-type-select set-type-${set.setType}`}
											aria-label={`Type for set ${setIdx + 1}`}
											value={set.setType}
											onChange={(e) =>
												updateSet(exerciseIdx, setIdx, {
													setType: e.target.value as SetType,
												})
											}
										>
											{SET_TYPES.map((t) => (
												<option key={t} value={t}>
													{setTypeLabel(t)}
												</option>
											))}
										</select>
										<label className="editor-number-field">
											<span className="editor-mobile-label">Percent</span>
											<input
											type="text"
											inputMode="decimal"
											className="editor-pct-input"
											aria-label={`Percentage for set ${setIdx + 1}`}
											value={set.weightBasis.kind === 'barWeight' || set.weightBasis.kind === 'fixed' || set.weightBasis.kind === 'relative' ? '' : Number((set.percentage * 100).toFixed(4))}
											placeholder={set.weightBasis.kind === 'barWeight' || set.weightBasis.kind === 'fixed' || set.weightBasis.kind === 'relative' ? '—' : ''}
											disabled={set.weightBasis.kind === 'barWeight' || set.weightBasis.kind === 'fixed' || set.weightBasis.kind === 'relative'}
											onFocus={(e) => e.target.select()}
											onChange={(e) =>
												updateSet(exerciseIdx, setIdx, {
													percentage: (Number(e.target.value) || 0) / 100,
												})
											}
											/>
										</label>
										<div className="editor-basis-group">
											<select
												className="editor-basis-select"
												aria-label={`Weight basis for set ${setIdx + 1}`}
												value={set.weightBasis.kind === 'relative' ? `relative:${set.weightBasis.reference}` : set.weightBasis.kind}
												onChange={(e) => {
													const wb = set.weightBasis;
													const prevValue =
															wb.kind === 'crossReference' && e.target.value === 'crossReference' ? wb.liftId
															: wb.kind === 'fixed' && e.target.value === 'fixed' ? String(wb.weight)
															: wb.kind === 'relative' && e.target.value.startsWith('relative:') ? String(wb.offset)
														: undefined;
													updateWeightBasis(
														exerciseIdx,
														setIdx,
														e.target.value,
														prevValue,
													);
												}}
											>
												<option value="topSet">Top set</option>
												<option value="trainingMax">Training Max (TM)</option>
												<option value="backoff">Backoff</option>
												<option value="barWeight">Bar weight</option>
												<option value="crossReference">Cross-ref</option>
												<option value="fixed">Fixed</option>
												<option value="relative:topSet">Top set ±</option>
												<option value="relative:backoff">Backoff ±</option>
											</select>
											{set.weightBasis.kind === 'crossReference' && (
												<select
													className="editor-basis-extra"
													value={set.weightBasis.liftId}
													onChange={(e) =>
														updateWeightBasis(
															exerciseIdx,
															setIdx,
															'crossReference',
															e.target.value,
														)
													}
												>
													{lifts.map((l) => (
														<option key={l.id} value={l.id}>
															{l.name}
														</option>
													))}
												</select>
											)}
											{set.weightBasis.kind === 'fixed' && (
												<input
													type="text"
													inputMode="decimal"
													className="editor-basis-extra-input"
													value={Number.isFinite(set.weightBasis.weight) ? set.weightBasis.weight : ''}
													placeholder="lbs"
													onFocus={(e) => e.target.select()}
													onChange={(e) =>
														updateWeightBasis(
															exerciseIdx,
															setIdx,
															'fixed',
															e.target.value,
														)
													}
												/>
											)}
											{set.weightBasis.kind === 'relative' && (() => {
												const wb = set.weightBasis;
												return (
													<RelativeOffsetInput
														offset={wb.offset}
														onCommit={(n) =>
															updateWeightBasis(
																exerciseIdx,
																setIdx,
																`relative:${wb.reference}`,
																String(n),
															)
														}
													/>
												);
											})()}
										</div>
										<label className="editor-number-field">
											<span className="editor-mobile-label">Min reps</span>
											<input
											type="text"
											inputMode="numeric"
											className="editor-rep-input"
											aria-label={`Minimum reps for set ${setIdx + 1}`}
											value={set.minReps}
											onFocus={(e) => e.target.select()}
											onChange={(e) =>
												updateSet(exerciseIdx, setIdx, {
													minReps: Number(e.target.value) || 0,
												})
											}
											/>
										</label>
										<label className="editor-number-field">
											<span className="editor-mobile-label">Max reps</span>
											<input
											type="text"
											inputMode="numeric"
											className="editor-rep-input"
											aria-label={`Maximum reps for set ${setIdx + 1}`}
											value={set.maxReps}
											onFocus={(e) => e.target.select()}
											onChange={(e) =>
												updateSet(exerciseIdx, setIdx, {
													maxReps: Number(e.target.value) || 0,
												})
											}
											/>
										</label>
										<label className="editor-amrap-check">
											<input
												type="checkbox"
												aria-label={`AMRAP for set ${setIdx + 1}`}
												checked={set.amrap}
												onChange={(e) =>
													updateSet(exerciseIdx, setIdx, {
														amrap: e.target.checked,
													})
												}
											/>
										</label>
										<button
											type="button"
											className={`btn-set-comment ${set.comment ? 'has-comment' : ''}`}
											aria-label="Edit comment"
											onClick={() => setCommentTarget({ exerciseIdx, setIdx })}
										>
											<MessageSquare size={14} />
										</button>
										<div className="editor-set-move">
											<button
												type="button"
												className="btn-move-set"
												aria-label={`Move set ${setIdx + 1} up`}
												disabled={setIdx === 0}
												onClick={() => reorderSet(exerciseIdx, setIdx, -1)}
											>
												<ArrowUp size={12} />
											</button>
											<button
												type="button"
												className="btn-move-set"
												aria-label={`Move set ${setIdx + 1} down`}
												disabled={setIdx === exercise.sets.length - 1}
												onClick={() => reorderSet(exerciseIdx, setIdx, 1)}
											>
												<ArrowDown size={12} />
											</button>
										</div>
										<button
											type="button"
											className="btn-remove-set"
											aria-label="Remove set"
											onClick={() => removeSet(exerciseIdx, setIdx)}
										>
											<Trash2 size={14} />
										</button>
									</div>
								))}
								<button
									type="button"
									className="btn-add-set"
									onClick={() => addSet(exerciseIdx)}
								>
									<Plus size={16} /> Add Set
								</button>
							</div>
						</section>
					))}

					<button
						type="button"
						className="btn-add-exercise"
						disabled={!exposure || lifts.length === 0}
						onClick={addExercise}
					>
						<Plus size={20} /> Add Exercise
					</button>
				</>

			{/* Validation errors */}
			{errors.length > 0 && (
				<div className="editor-errors">
					{errors.map((err, i) => (
						<p key={i} className="editor-error">{err}</p>
					))}
				</div>
			)}

			{/* Delete workout */}
			{!isNew && onDelete && (
				<section className="editor-section editor-delete-section">
					{!confirmDelete ? (
						<button
							type="button"
							className="btn-delete-workout"
							onClick={handleDelete}
						>
							<Trash2 size={16} /> Delete Workout
						</button>
					) : (
						<div className="editor-delete-confirm">
							<span className="editor-delete-confirm-label">
								Delete "{workout.name}"?
							</span>
							<button
								type="button"
								className="btn-delete-workout-confirm"
								onClick={handleDelete}
							>
								Confirm Delete
							</button>
							<button
								type="button"
								className="btn-delete-workout-cancel"
								onClick={() => setConfirmDelete(false)}
							>
								Cancel
							</button>
						</div>
					)}
				</section>
			)}

			{/* Comment editing overlay */}
			{commentTarget && (() => {
				const { exerciseIdx, setIdx } = commentTarget;
				const currentComment = exercises[exerciseIdx]?.sets[setIdx]?.comment ?? '';
				return (
					<div className="comment-overlay" onClick={() => setCommentTarget(null)}>
						<div className="comment-overlay-content" onClick={(e) => e.stopPropagation()}>
							<h3 className="comment-overlay-title">Set Comment</h3>
							<textarea
								className="comment-overlay-input"
								value={currentComment}
								placeholder="Add a note for this set…"
								rows={3}
								autoFocus
								onChange={(e) =>
									updateSet(exerciseIdx, setIdx, {
										comment: e.target.value || undefined,
									})
								}
							/>
							<button
								type="button"
								className="comment-overlay-done"
								onClick={() => setCommentTarget(null)}
							>
								Done
							</button>
						</div>
					</div>
				);
			})()}
		</div>
	);
}
