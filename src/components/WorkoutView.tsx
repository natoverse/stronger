import { useState, useCallback } from 'react';
import { ArrowLeft, Minus, Plus } from 'lucide-react';
import type { ComputedSet, PreviousSetData, SetResult, SetType, Workout } from '../model/index.js';

interface WorkoutViewProps {
	workout: Workout;
	previousSets?: PreviousSetData[][] | null;
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

export function WorkoutView({ workout, previousSets, onBack, onFinish }: WorkoutViewProps) {
	const [results, setResults] = useState<SetResult[][]>(() =>
		initResults(workout),
	);
	const [addedSets, setAddedSets] = useState<ComputedSet[][]>(() =>
		workout.exercises.map(() => []),
	);
	const [finished, setFinished] = useState(false);

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
	}

	const addSet = useCallback(
		(exerciseIdx: number) => {
			const exercise = workout.exercises[exerciseIdx];
			const extraSets = addedSets[exerciseIdx];
			const allSets = [...exercise.sets, ...extraSets];
			const lastSet = allSets[allSets.length - 1];

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
		[workout, addedSets],
	);

	const totalSets = results.flat().length;
	const completedSets = results.flat().filter((s) => s.completed).length;

	function handleFinish() {
		setFinished(true);
		onFinish(workout, results);
	}

	if (finished) {
		return (
			<div className="workout-view">
				<div className="finish-summary">
					<h2>Workout Complete!</h2>
					<p>
						{completedSets} of {totalSets} sets completed.
					</p>
					<p className="finish-note">
						Results have been saved to your Google Sheet.
					</p>
					<button className="btn-primary" onClick={onBack}>
						Back to Workouts
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="workout-view">
			<header className="workout-header">
				<button className="btn-back" onClick={onBack}>
					<ArrowLeft size={20} /> Back
				</button>
				<h1 className="workout-title">{workout.name}</h1>
				<span className="progress-badge">
					{completedSets}/{totalSets}
				</span>
				<button className="btn-finish" onClick={handleFinish}>
					Finish
				</button>
			</header>

			{workout.exercises.map((exercise, exerciseIdx) => {
				const allSets = [...exercise.sets, ...addedSets[exerciseIdx]];
				return (
				<section key={exerciseIdx} className="exercise-section">
					<h2 className="exercise-section-name">
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
									{comment && (
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

		</div>
	);
}
