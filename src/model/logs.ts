import type { ComputedSet, PreviousSetData, SetResult } from './types.ts'

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
	}
}

/**
 * Find the most recent session for a workout and return its actual weights
 * and reps, indexed by exercise position and set position.
 */
export function findPreviousWorkoutSets(
	logRows: ParsedLogRow[],
	workoutId: string,
): PreviousSetData[][] | null {
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
