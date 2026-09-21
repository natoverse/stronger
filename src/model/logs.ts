import type { ComputedSet, PreviousSetData, SetResult, ExerciseCycleStage, SetTemplate, CycleSessionSnapshot } from './types.ts'

export interface LogContext {
	date: string
	startTime: string
	endTime: string
	workoutId: string
}

/** A set-level workout record, flattened from a stored workout session. */
export interface ParsedLogRow extends LogContext {
	exerciseName: string
	liftId: string
	setNumber: number
	setType: string
	plannedWeight: number
	plannedReps: number
	actualWeight: number
	actualReps: number
	completed: boolean
	cycleStage?: ExerciseCycleStage
	occurrenceId?: string
	plannedTemplate?: SetTemplate
}

export function buildLogRow(
	ctx: LogContext,
	exerciseName: string,
	liftId: string,
	setNumber: number,
	setType: string,
	planned: ComputedSet,
	result: SetResult,
): ParsedLogRow {
	return {
		...ctx,
		exerciseName,
		liftId,
		setNumber,
		setType,
		plannedWeight: planned.weight,
		plannedReps: planned.maxReps,
		actualWeight: result.actualWeight,
		actualReps: result.actualReps,
		completed: result.completed,
		...(planned.prescription ? { plannedTemplate: structuredClone(planned.prescription) } : {}),
	}
}

/**
 * Find the most recent session for a workout and return its actual weights
 * and reps, indexed by exercise position and set position.
 */
export function findPreviousWorkoutSets(
	logRows: ParsedLogRow[],
	workoutId: string,
	snapshot?: CycleSessionSnapshot,
): PreviousSetData[][] | null {
	if (snapshot) {
		const explicitStages = snapshot.progress.exercises.some((item) => item.steps.length > 1 || item.baseline === 'trainingMax');
		if (explicitStages) {
			return snapshot.workout.exercises.map((exercise, index) => {
				const stage = exercise.cycleStage!;
				const matching = logRows.filter((row) => row.workoutId === workoutId
					&& row.cycleStage?.exerciseId === stage.exerciseId
					&& row.cycleStage.iterationId === stage.iterationId
					&& row.cycleStage.week === stage.week
					&& row.cycleStage.exposure === stage.exposure);
				const latest = matching.map((row) => row.startTime).sort().slice(-1)[0];
				return exercise.sets.map((_set, setIndex) => {
					const row = matching.find((row) => row.startTime === latest && row.setNumber === setIndex + 1
						&& JSON.stringify(row.plannedTemplate) === JSON.stringify(snapshot.templates[index].sets[setIndex]));
					return row ? { weight: row.actualWeight, reps: row.actualReps } : undefined;
				}) as PreviousSetData[];
			});
		}
	}
	const matching = logRows.filter((r) => r.workoutId === workoutId)
	if (matching.length === 0) return null

	let latestStart = ''
	for (const row of matching) {
		if (row.startTime > latestStart) {
			latestStart = row.startTime
		}
	}

	const sessionRows = matching.filter((r) => r.startTime === latestStart)
	if (sessionRows.length === 0) return null

	const exerciseOrder: string[] = []
	const exerciseMap = new Map<string, ParsedLogRow[]>()
	for (const row of sessionRows) {
		if (!exerciseMap.has(row.exerciseName)) {
			exerciseOrder.push(row.exerciseName)
			exerciseMap.set(row.exerciseName, [])
		}
		exerciseMap.get(row.exerciseName)!.push(row)
	}

	const result: PreviousSetData[][] = []
	for (const name of exerciseOrder) {
		const rows = exerciseMap.get(name)!
		rows.sort((a, b) => a.setNumber - b.setNumber)
		result.push(
			rows.map((r) => ({ weight: r.actualWeight, reps: r.actualReps })),
		)
	}

	return result
}
