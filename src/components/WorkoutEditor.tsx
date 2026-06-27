import { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowLeft, MessageSquare, Plus, Trash2 } from 'lucide-react';
import type { SetTemplate, WeightBasis, SetType, LiftConfig, ExerciseRole } from '../model/index.js';
import type { WorkoutDefinition } from '../data/sample-workouts.js';

/** Local state for an exercise being edited. */
export interface EditableExercise {
	liftId: string;
	role: ExerciseRole;
	sets: SetTemplate[];
}

/** Local state for a workout being edited. */
export interface EditableWorkout {
	id: string;
	name: string;
	exercises: EditableExercise[];
}

interface WorkoutEditorProps {
	/** Existing definition to edit, or undefined for a new workout. */
	existing?: WorkoutDefinition;
	/** All current definitions (used for ID uniqueness checks). */
	allDefinitions: WorkoutDefinition[];
	/** Available lifts from configs. */
	configs: LiftConfig[];
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
 * committing only when the text parses to a finite number.
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
				if (raw.trim() !== '' && Number.isFinite(n)) onCommit(n);
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

/** Convert a WorkoutDefinition to the local editable format. */
export function toEditable(def: WorkoutDefinition): EditableWorkout {
	return {
		id: def.id,
		name: def.name,
		exercises: def.templates.map((t) => ({
			liftId: t.liftId,
			role: t.role,
			sets: t.sets.map((s) => ({ ...s })),
		})),
	};
}

/** Convert the local editable format back to a WorkoutDefinition. */
export function fromEditable(e: EditableWorkout, configs: LiftConfig[], existing?: WorkoutDefinition): WorkoutDefinition {
	const liftMap = new Map(configs.map((c) => [c.id, c.name]));
	return {
		id: e.id,
		name: e.name,
		favorite: existing?.favorite,
		templates: e.exercises.map((ex) => {
			const liftName = liftMap.get(ex.liftId) ?? ex.liftId;
			return {
				liftId: ex.liftId,
				name: liftName,
				role: ex.role,
				sets: ex.sets,
			};
		}),
	};
}

export function WorkoutEditor({
	existing,
	allDefinitions,
	configs,
	onSave,
	onCancel,
	onDelete,
}: WorkoutEditorProps) {
	const [workout, setWorkout] = useState<EditableWorkout>(() =>
		existing
			? toEditable(existing)
			: {
					id: '',
					name: '',
					exercises: [],
				},
	);
	const [saving, setSaving] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [commentTarget, setCommentTarget] = useState<{ exerciseIdx: number; setIdx: number } | null>(null);

	const isNew = !existing;

	// Available lifts sorted by name
	const lifts = useMemo(
		() => [...configs].sort((a, b) => a.name.localeCompare(b.name)),
		[configs],
	);

	// IDs already used by other definitions (excluding current if editing)
	const usedIds = useMemo(() => {
		const ids = new Set(allDefinitions.map((d) => d.id));
		if (existing) ids.delete(existing.id);
		return ids;
	}, [allDefinitions, existing]);

	// Validation
	const autoId = nameToId(workout.name);
	const effectiveId = isNew ? (workout.id || autoId) : workout.id;
	const errors: string[] = [];
	if (!workout.name.trim()) errors.push('Workout name is required');
	if (!effectiveId) errors.push('Workout ID is required');
	if (isNew && usedIds.has(effectiveId)) errors.push(`ID "${effectiveId}" is already in use`);
	if (workout.exercises.length === 0) errors.push('Add at least one exercise');
	for (let i = 0; i < workout.exercises.length; i++) {
		const ex = workout.exercises[i];
		if (!ex.liftId) errors.push(`Exercise ${i + 1}: select a lift`);
		if (ex.sets.length === 0) errors.push(`Exercise ${i + 1}: add at least one set`);
	}
	const isValid = errors.length === 0;

	// --- Workout-level updates ---
	const updateName = useCallback((name: string) => {
		setWorkout((prev) => ({ ...prev, name }));
	}, []);

	const updateId = useCallback((id: string) => {
		setWorkout((prev) => ({ ...prev, id }));
	}, []);

	// --- Exercise-level updates ---
	const addExercise = useCallback(() => {
		if (lifts.length === 0) return;
		setWorkout((prev) => ({
			...prev,
			exercises: [
				...prev.exercises,
				{ liftId: lifts[0].id, role: 'assistance', sets: [defaultSet()] },
			],
		}));
	}, [lifts]);

	const removeExercise = useCallback((idx: number) => {
		setWorkout((prev) => ({
			...prev,
			exercises: prev.exercises.filter((_, i) => i !== idx),
		}));
	}, []);

	const updateExercise = useCallback(
		(idx: number, patch: Partial<EditableExercise>) => {
			setWorkout((prev) => ({
				...prev,
				exercises: prev.exercises.map((ex, i) =>
					i === idx ? { ...ex, ...patch } : ex,
				),
			}));
		},
		[],
	);

	// --- Set-level updates ---
	const addSet = useCallback((exerciseIdx: number) => {
		setWorkout((prev) => ({
			...prev,
			exercises: prev.exercises.map((ex, i) => {
				if (i !== exerciseIdx) return ex;
				const last = ex.sets[ex.sets.length - 1];
				return {
					...ex,
					sets: [...ex.sets, last ? { ...last } : defaultSet()],
				};
			}),
		}));
	}, []);

	const removeSet = useCallback((exerciseIdx: number, setIdx: number) => {
		setWorkout((prev) => ({
			...prev,
			exercises: prev.exercises.map((ex, i) => {
				if (i !== exerciseIdx) return ex;
				return {
					...ex,
					sets: ex.sets.filter((_, si) => si !== setIdx),
				};
			}),
		}));
	}, []);

	const updateSet = useCallback(
		(exerciseIdx: number, setIdx: number, patch: Partial<SetTemplate>) => {
			setWorkout((prev) => ({
				...prev,
				exercises: prev.exercises.map((ex, ei) => {
					if (ei !== exerciseIdx) return ex;
					return {
						...ex,
						sets: ex.sets.map((s, si) =>
							si === setIdx ? { ...s, ...patch } : s,
						),
					};
				}),
			}));
		},
		[],
	);

	const updateWeightBasis = useCallback(
		(exerciseIdx: number, setIdx: number, kind: string, extraValue?: string) => {
			let wb: WeightBasis;
			switch (kind) {
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
					wb = { kind: 'fixed', weight: Number(extraValue) || 0 };
					break;
				case 'relative:topSet':
					wb = { kind: 'relative', reference: 'topSet', offset: Number(extraValue) || 0 };
					break;
				case 'relative:backoff':
					wb = { kind: 'relative', reference: 'backoff', offset: Number(extraValue) || 0 };
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
			</section>

			{/* Exercises */}
			<>
				{workout.exercises.map((exercise, exerciseIdx) => (
						<section key={exerciseIdx} className="editor-exercise">
							<div className="editor-exercise-header">
								<span className="editor-exercise-number">
									Exercise {exerciseIdx + 1}
								</span>
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
											updateExercise(exerciseIdx, { liftId: e.target.value })
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
									<span className="editor-col-remove"></span>
								</div>
								{exercise.sets.map((set, setIdx) => (
									<div key={setIdx} className="editor-set-row">
										<select
											className={`editor-set-type set-type-select set-type-${set.setType}`}
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
										<input
											type="text"
											inputMode="decimal"
											className="editor-pct-input"
											value={set.weightBasis.kind === 'barWeight' || set.weightBasis.kind === 'fixed' || set.weightBasis.kind === 'relative' ? '' : Math.round(set.percentage * 100)}
											placeholder={set.weightBasis.kind === 'barWeight' || set.weightBasis.kind === 'fixed' || set.weightBasis.kind === 'relative' ? '—' : ''}
											disabled={set.weightBasis.kind === 'barWeight' || set.weightBasis.kind === 'fixed' || set.weightBasis.kind === 'relative'}
											onFocus={(e) => e.target.select()}
											onChange={(e) =>
												updateSet(exerciseIdx, setIdx, {
													percentage: (Number(e.target.value) || 0) / 100,
												})
											}
										/>
										<div className="editor-basis-group">
											<select
												className="editor-basis-select"
												value={set.weightBasis.kind === 'relative' ? `relative:${set.weightBasis.reference}` : set.weightBasis.kind}
												onChange={(e) => {
													const wb = set.weightBasis;
													const prevValue =
														wb.kind === 'crossReference' ? wb.liftId
														: wb.kind === 'fixed' ? String(wb.weight)
														: wb.kind === 'relative' ? String(wb.offset)
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
													value={set.weightBasis.weight}
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
										<input
											type="text"
											inputMode="numeric"
											className="editor-rep-input"
											value={set.minReps}
											onFocus={(e) => e.target.select()}
											onChange={(e) =>
												updateSet(exerciseIdx, setIdx, {
													minReps: Number(e.target.value) || 0,
												})
											}
										/>
										<input
											type="text"
											inputMode="numeric"
											className="editor-rep-input"
											value={set.maxReps}
											onFocus={(e) => e.target.select()}
											onChange={(e) =>
												updateSet(exerciseIdx, setIdx, {
													maxReps: Number(e.target.value) || 0,
												})
											}
										/>
										<label className="editor-amrap-check">
											<input
												type="checkbox"
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
				const currentComment = workout.exercises[exerciseIdx]?.sets[setIdx]?.comment ?? '';
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


