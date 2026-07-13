import { useState, useCallback, useEffect, useRef } from 'react';
import { ArrowLeft, Minus, Plus, Sun, SunDim, X } from 'lucide-react';
import type { ComputedSet, ComputedExercise, PreviousSetData, SetResult, SetType, Workout, LiftConfig, AppSettings } from '../model/index.js';
import { useWakeLock } from '../hooks/useWakeLock.js';
import { saveDraft } from '../hooks/useWorkoutDraft.js';
import { useRestTimer, resolveTimerExercise, formatElapsed } from '../hooks/useRestTimer.js';

interface WorkoutViewProps {
	workout: Workout;
	previousSets?: PreviousSetData[][] | null;
	startTime: string;
	/** Pre-filled results restored from a draft (e.g. after page refresh). */
	draftResults?: SetResult[][] | null;
	/** User-configurable app settings. */
	appSettings: AppSettings;
	/** All available exercise configs, used for the "Add Exercise" picker. */
	configs: LiftConfig[];
	onBack: () => void;
	onFinish: (workout: Workout, results: SetResult[][]) => void;
}

/**
 * Build a comment string that includes rep-range / AMRAP hints (when present)
 * merged with any existing set comment.
 */
function buildComment(set: ComputedSet): string | undefined {
	const parts: string[] = [];
	const hasRange = set.minReps !== set.maxReps;
	if (hasRange) {
		parts.push(`${set.minReps}–${set.maxReps} reps`);
	}
	if (set.amrap) {
		parts.push('AMRAP');
	}
	if (set.comment) {
		parts.push(set.comment);
	}
	return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** Label for set type, with a visual class. */
function setTypeLabel(type: SetType): string {
	switch (type) {
		case 'warmup':
			return 'Warm-up';
		case 'work':
			return 'Work';
		case 'backoff':
			return 'Backoff';
		case 'joker':
			return 'Joker';
	}
}

/** All available set types for the dropdown. */
const SET_TYPES: SetType[] = ['warmup', 'work', 'backoff', 'joker'];

function initResults(workout: Workout): SetResult[][] {
	return workout.exercises.map((ex) =>
		ex.sets.map((set) => ({
			actualWeight: set.weight,
			actualReps: set.maxReps,
			completed: false,
			actualSetType: set.setType,
		})),
	);
}

export function WorkoutView({ workout, previousSets, startTime, draftResults, appSettings, configs, onBack, onFinish }: WorkoutViewProps) {
	const { active: wakeLockActive, reacquire: reacquireWakeLock } = useWakeLock(appSettings.keepScreenOn);

	const [results, setResults] = useState<SetResult[][]>(() => {
		// Restore from draft if shapes match; otherwise start fresh.
		if (draftResults && draftResults.length === workout.exercises.length) {
			const shapesMatch = workout.exercises.every(
				(ex, i) => draftResults[i].length >= ex.sets.length,
			);
			if (shapesMatch) return draftResults;
		}
		return initResults(workout);
	});
	const [addedSets, setAddedSets] = useState<ComputedSet[][]>(() => {
		// If the draft had extra sets beyond the planned ones, reconstruct addedSets.
		if (draftResults && draftResults.length === workout.exercises.length) {
			return workout.exercises.map((ex, i) => {
				const extra = draftResults[i].length - ex.sets.length;
				if (extra <= 0) return [];
				const lastPlanned = ex.sets[ex.sets.length - 1];
				return Array.from({ length: extra }, () => ({ ...lastPlanned }));
			});
		}
		return workout.exercises.map(() => []);
	});
	const [addedExercises, setAddedExercises] = useState<ComputedExercise[]>([]);
	const [showExercisePicker, setShowExercisePicker] = useState(false);
	const restTimer = useRestTimer();

	/** The full exercise list: planned exercises + any user-added ones. */
	const allExercises = [...workout.exercises, ...addedExercises];
	/** A virtual workout object that includes added exercises. */
	const effectiveWorkout: Workout = { ...workout, exercises: allExercises };

	// Persist results to localStorage on every change so a refresh doesn't lose progress.
	const isFirstRender = useRef(true);
	useEffect(() => {
		// Skip the very first render when restoring a draft (no new info to save).
		if (isFirstRender.current) {
			isFirstRender.current = false;
			return;
		}
		saveDraft({ workoutId: workout.id, startTime, results });
	}, [results, workout.id, startTime]);

	function updateSet(
		exerciseIdx: number,
		setIdx: number,
		patch: Partial<SetResult>,
	) {
		setResults((prev) =>
			prev.map((ex, ei) =>
				ei !== exerciseIdx
					? ex
					: ex.map((s, si) =>
							si !== setIdx ? s : { ...s, ...patch },
						),
			),
		);

		// Start rest timer when a set is checked as complete
		if (patch.completed === true && appSettings.showRestTimer) {
			const totalSetsPerExercise = results.map((ex) => ex.length);
			const targetExercise = resolveTimerExercise(exerciseIdx, setIdx, totalSetsPerExercise);
			restTimer.start(targetExercise);
		}
	}

	const addSet = useCallback(
		(exerciseIdx: number) => {
			const exercise = allExercises[exerciseIdx];
			if (!exercise) return;
			const extraSets = addedSets[exerciseIdx];
			const allSets = [...exercise.sets, ...extraSets];
			const lastSet = allSets[allSets.length - 1];
			if (!lastSet) return;

			const newSet: ComputedSet = { ...lastSet };

			setAddedSets((prev) =>
				prev.map((sets, i) =>
					i === exerciseIdx ? [...sets, newSet] : sets,
				),
			);
			setResults((prev) =>
				prev.map((ex, i) =>
					i === exerciseIdx
						? [
								...ex,
								{
									actualWeight: lastSet.weight,
									actualReps: lastSet.minReps,
									completed: false,
									actualSetType: lastSet.setType,
								},
							]
						: ex,
				),
			);
		},
		[allExercises, addedSets],
	);

	const addExercise = useCallback(
		(config: LiftConfig) => {
			const newExercise: ComputedExercise = {
				liftId: config.id,
				name: config.name,
				role: 'assistance',
				sets: [
					{
						setType: 'work',
						weight: config.barWeight,
						minReps: 5,
						maxReps: 5,
						amrap: false,
					},
				],
			};

			setAddedExercises((prev) => [...prev, newExercise]);
			setAddedSets((prev) => [...prev, []]);
			setResults((prev) => [
				...prev,
				[
					{
						actualWeight: config.barWeight,
						actualReps: 5,
						completed: false,
						actualSetType: 'work',
					},
				],
			]);
			setShowExercisePicker(false);
		},
		[],
	);

	const totalSets = results.flat().length;
	const completedSets = results.flat().filter((s) => s.completed).length;

	function handleFinish() {
		restTimer.stop();
		onFinish(effectiveWorkout, results);
	}

	return (
		<div className="workout-view">
			<header className="workout-header">
				<div className="workout-header-row">
					<button className="btn-back" onClick={onBack}>
						<ArrowLeft size={20} /> Back
					</button>
					<h1 className="workout-title">{workout.name}</h1>
					<span className="progress-badge">
						{completedSets}/{totalSets}
					</span>
					{appSettings.keepScreenOn && (
						<button
							className={`btn-wake-lock ${wakeLockActive ? 'active' : 'inactive'}`}
							onClick={reacquireWakeLock}
							title={wakeLockActive ? 'Screen staying on' : 'Tap to keep screen on'}
						>
							{wakeLockActive ? <Sun size={16} /> : <SunDim size={16} />}
						</button>
					)}
					<button className="btn-finish" onClick={handleFinish}>
						Finish
					</button>
				</div>
				<div className="workout-header-timer">
					{appSettings.showRestTimer && restTimer.exerciseIdx !== null && (
						<span className="rest-timer" aria-label="Rest timer">{formatElapsed(restTimer.elapsed)}</span>
					)}
				</div>
			</header>

			{allExercises.map((exercise, exerciseIdx) => {
				const allSets = [...exercise.sets, ...addedSets[exerciseIdx]];
				return (
				<section key={exerciseIdx} className="exercise-card">
					<h2 className="exercise-name">
						{exercise.name}
						<span className={`role-tag role-${exercise.role}`}>{exercise.role}</span>
					</h2>
					<div className="sets-list">
						{allSets.map((set, setIdx) => {
							const result = results[exerciseIdx][setIdx];
							const comment = buildComment(set);
							const prev = previousSets?.[exerciseIdx]?.[setIdx];
							return (
								<div
									key={setIdx}
									className={`set-row ${result.completed ? 'set-completed' : ''}`}
								>
									<label className="set-checkbox">
										<input
											type="checkbox"
											checked={result.completed}
											onChange={(e) =>
												updateSet(
													exerciseIdx,
													setIdx,
													{
														completed:
															e.target.checked,
													},
												)
											}
										/>
									</label>
									<select
										className={`set-type-select set-type-${result.actualSetType}`}
										value={result.actualSetType}
										onChange={(e) =>
											updateSet(
												exerciseIdx,
												setIdx,
												{
													actualSetType:
														e.target
															.value as SetType,
												},
											)
										}
									>
										{SET_TYPES.map((t) => (
											<option key={t} value={t}>
												{setTypeLabel(t)}
											</option>
										))}
									</select>
									<div className="set-fields">
										{prev && (
											<span className="set-previous">
												{prev.weight}×{prev.reps}
											</span>
										)}
										<label className="field-group">
											<span className="field-label">
												lbs
											</span>
											<input
												type="number"
												className="field-input"
												value={result.actualWeight}
												onFocus={(e) => e.target.select()}
												onChange={(e) =>
													updateSet(
														exerciseIdx,
														setIdx,
														{
															actualWeight:
																Number(
																	e.target
																		.value,
																) || 0,
														},
													)
												}
											/>
										</label>
										<span className="field-separator">
											×
										</span>
										<label className="field-group">
											<span className="field-label">
												reps
											</span>
											<div className="rep-stepper">
												<button
													type="button"
													className="rep-stepper-btn"
													aria-label="Decrease reps"
													onClick={() =>
														updateSet(
															exerciseIdx,
															setIdx,
															{
																actualReps: Math.max(
																	0,
																	result.actualReps -
																		1,
																),
															},
														)
													}
												>
													<Minus size={16} />
												</button>
												<input
													type="number"
													className="field-input"
													value={result.actualReps}
													onFocus={(e) => e.target.select()}
													onChange={(e) =>
														updateSet(
															exerciseIdx,
															setIdx,
															{
																actualReps:
																	Number(
																		e.target
																			.value,
																	) || 0,
															},
														)
													}
												/>
												<button
													type="button"
													className="rep-stepper-btn"
													aria-label="Increase reps"
													onClick={() =>
														updateSet(
															exerciseIdx,
															setIdx,
															{
																actualReps:
																	result.actualReps +
																	1,
															},
														)
													}
												>
													<Plus size={16} />
												</button>
											</div>
										</label>
									</div>
									{appSettings.showSetComments && comment && (
										<p className="set-comment">
											{comment}
										</p>
									)}
								</div>
							);
						})}
						<button
							type="button"
							className="btn-add-set"
							onClick={() => addSet(exerciseIdx)}
						>
							<Plus size={16} /> Add Set
						</button>
					</div>
				</section>
				);
			})}

			<button
				type="button"
				className="btn-add-exercise"
				onClick={() => setShowExercisePicker(true)}
			>
				<Plus size={16} /> Add Exercise
			</button>

			{showExercisePicker && (
				<div className="exercise-picker-overlay" onClick={() => setShowExercisePicker(false)}>
					<div className="exercise-picker" onClick={(e) => e.stopPropagation()}>
						<div className="exercise-picker-header">
							<h3>Add Exercise</h3>
							<button className="btn-close-picker" onClick={() => setShowExercisePicker(false)}>
								<X size={20} />
							</button>
						</div>
						<div className="exercise-picker-list">
							{configs.map((config) => (
								<button
									key={config.id}
									className="exercise-picker-item"
									onClick={() => addExercise(config)}
								>
									<span className="exercise-picker-name">{config.name}</span>
									<span className="exercise-picker-detail">{config.barWeight} lbs · {config.gear}</span>
								</button>
							))}
						</div>
					</div>
				</div>
			)}

		</div>
	);
}
