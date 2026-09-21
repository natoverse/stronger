import type { WorkoutDefinition } from '../data/sample-workouts.js';
import type { ParsedLogRow } from './logs.js';
import type { ExerciseCycleStage, Workout, WorkoutScheduleEntry } from './types.js';
import { BLOCKER_ID, REST_ID } from './types.js';
import { normalizeCycle } from './cycles.js';

export function createScheduleOpportunity(date: string, workoutId: string): WorkoutScheduleEntry {
	if (!workoutId || workoutId === '__rest__' || workoutId === REST_ID
		|| workoutId === BLOCKER_ID || workoutId.startsWith('cardio:')) {
		return { date, workoutId };
	}
	return {
		date,
		workoutId,
		cycleId: workoutId,
		strongerId: crypto.randomUUID(),
	};
}

/** New appointments reuse their existing Google-sync identity; older explicit IDs stay readable. */
export function scheduleOccurrenceId(entry: WorkoutScheduleEntry): string | undefined {
	return entry.occurrenceId ?? (entry.cycleId ? entry.strongerId : undefined);
}

export function cycleOpportunityCount(definition: WorkoutDefinition): number {
	return normalizeCycle(definition).weeks.length;
}

/** One opportunity every seven days; legacy day selections only align the first date. */
export function planWholeCycle(
	definition: WorkoutDefinition,
	startDate: string,
	weekdays: number[],
): WorkoutScheduleEntry[] {
	const selected = new Set(weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day < 7));
	if (selected.size === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return [];
	const [year, month, day] = startDate.split('-').map(Number);
	const date = new Date(year, month - 1, day);
	if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return [];
	const entries: WorkoutScheduleEntry[] = [];
	while (!selected.has((date.getDay() + 6) % 7)) date.setDate(date.getDate() + 1);
	const count = cycleOpportunityCount(definition);
	for (let index = 0; index < count; index++) {
		const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
		entries.push(createScheduleOpportunity(iso, definition.id));
		date.setDate(date.getDate() + 7);
	}
	return entries;
}

export function matchesScheduledOccurrence(
	entry: WorkoutScheduleEntry,
	row: Pick<ParsedLogRow, 'date' | 'workoutId' | 'occurrenceId'>,
): boolean {
	if (entry.workoutId !== row.workoutId) return false;
	const occurrenceId = scheduleOccurrenceId(entry);
	return occurrenceId
		? occurrenceId === row.occurrenceId
		: entry.date === row.date;
}

export function formatCycleStage(stage: ExerciseCycleStage): string {
	return `Week ${stage.week}/${stage.weekCount}`
		+ (stage.weekName ? ` — ${stage.weekName}` : '')
		+ (stage.exposureCount > 1
			? ` · Exposure ${stage.exposure}/${stage.exposureCount}${stage.exposureName ? ` — ${stage.exposureName}` : ''}`
			: '');
}

/** One-week cards stay familiar; independently progressing exercises must not imply a global stage. */
export function workoutCycleLabels(workout: Workout): string[] {
	if (!workout.exercises.some((exercise) => (exercise.cycleStage?.weekCount ?? 1) > 1)) return [];
	const stages = workout.exercises.map((exercise) => exercise.cycleStage);
	const first = stages[0];
	if (first && stages.every((stage) => stage
		&& stage.week === first.week && stage.weekCount === first.weekCount
		&& stage.exposure === first.exposure && stage.exposureCount === first.exposureCount
		&& stage.iteration === first.iteration)) {
		return [`Week ${first.week}/${first.weekCount}`
			+ (first.exposureCount > 1 ? ` · Exposure ${first.exposure}/${first.exposureCount}` : '')];
	}
	return workout.exercises.map((exercise) => `${exercise.name}: ${exercise.cycleStage
		? `${formatCycleStage(exercise.cycleStage)} · Iteration ${exercise.cycleStage.iteration}`
		: 'Stage unavailable'}`);
}
