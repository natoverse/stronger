import type { WorkoutDefinition } from '../data/sample-workouts.js';
import type { ParsedLogRow } from './logs.js';
import type { ExerciseCycleStage, Workout, WorkoutScheduleEntry } from './types.js';
import { BLOCKER_ID, REST_ID } from './types.js';

export function createScheduleOpportunity(date: string, workoutId: string): WorkoutScheduleEntry {
	if (!workoutId || workoutId === '__rest__' || workoutId === REST_ID
		|| workoutId === BLOCKER_ID || workoutId.startsWith('cardio:')) {
		return { date, workoutId };
	}
	return {
		date,
		workoutId,
		cycleId: workoutId,
		occurrenceId: crypto.randomUUID(),
	};
}

export function cycleOpportunityCount(definition: WorkoutDefinition): number {
	return definition.cycle
		? definition.cycle.weeks.reduce((count, week) => count + week.exposures.length, 0)
		: 1;
}

/** Dates are opportunities, not prescribed stages; missed dates never create catch-up work. */
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
	const weeks = definition.cycle?.weeks ?? [{ exposures: [{}] }];
	for (let index = 0; index < weeks.length; index++) {
		const earliest = new Date(year, month - 1, day + index * 7);
		if (date < earliest) date.setTime(earliest.getTime());
		let remaining = weeks[index].exposures.length;
		while (remaining > 0) {
			if (selected.has((date.getDay() + 6) % 7)) {
				const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
				entries.push(createScheduleOpportunity(iso, definition.id));
				remaining -= 1;
			}
			date.setDate(date.getDate() + 1);
		}
	}
	return entries;
}

export function matchesScheduledOccurrence(
	entry: WorkoutScheduleEntry,
	row: Pick<ParsedLogRow, 'date' | 'workoutId' | 'occurrenceId'>,
): boolean {
	if (entry.workoutId !== row.workoutId) return false;
	return entry.occurrenceId
		? entry.occurrenceId === row.occurrenceId
		: entry.date === row.date;
}

export function formatCycleStage(stage: ExerciseCycleStage): string {
	return `Week ${stage.week}/${stage.weekCount}`
		+ (stage.weekName ? ` — ${stage.weekName}` : '')
		+ ` · Exposure ${stage.exposure}/${stage.exposureCount}`
		+ (stage.exposureName ? ` — ${stage.exposureName}` : '');
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
