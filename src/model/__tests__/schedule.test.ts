import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkoutDefinition } from '../../data/sample-workouts.js';
import type { ExerciseCycleStage, Workout, WorkoutScheduleEntry } from '../types.js';
import type { ParsedLogRow } from '../logs.js';
import {
	createScheduleOpportunity, cycleOpportunityCount, matchesScheduledOccurrence,
	planWholeCycle, workoutCycleLabels,
} from '../schedule.js';
import { buildTodaysPlan, WorkoutSelect } from '../../components/WorkoutSelect.js';
import { CalendarView, groupLogByDate, SessionDetail } from '../../components/CalendarView.js';
import { CalendarPush } from '../../components/CalendarPush.js';

const definition: WorkoutDefinition = {
	id: 'squat', name: 'Squat cycle', templates: [],
	cycle: {
		baseline: 'trainingMax',
		weeks: [1, 2, 3, 4].map((week) => ({
			id: `w${week}`, name: week === 4 ? 'Deload' : `Week ${week}`,
			exposures: [{ id: `e${week}`, name: 'Main', templates: [] }],
		})),
	},
};
const stage = (overrides: Partial<ExerciseCycleStage> = {}): ExerciseCycleStage => ({
	exerciseId: 'squat', iterationId: 'iteration-1', iteration: 1,
	week: 2, weekCount: 4, exposure: 1, exposureCount: 1, weekName: '3s', exposureName: 'Main',
	...overrides,
});
const workout: Workout = {
	id: 'squat', name: 'Squat cycle', favorite: true,
	exercises: [{ liftId: 'squat', name: 'Squat', role: 'primary', sets: [], cycleStage: stage() }],
};
const row = (overrides: Partial<ParsedLogRow> = {}): ParsedLogRow => ({
	date: '2026-09-21', workoutId: 'squat', startTime: '09:00', endTime: '10:00',
	exerciseName: 'Squat', liftId: 'squat', setNumber: 1, setType: 'work',
	plannedWeight: 140, plannedReps: 3, actualWeight: 140, actualReps: 3, completed: true,
	...overrides,
});
const clear = async () => ({ flagsCleared: 0, scheduleCleared: 0, calendarEventsDeleted: 0, errors: [] });
afterEach(() => vi.useRealTimers());

describe('whole-cycle opportunity planning', () => {
	it('plans all four weeks without pinning prescriptions to dates', () => {
		const before = structuredClone(definition);
		const entries = planWholeCycle(definition, '2026-09-21', [0]);
		expect(entries.map((entry) => entry.date)).toEqual(['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12']);
		expect(entries.every((entry) => entry.workoutId === 'squat' && entry.cycleId === 'squat')).toBe(true);
		expect(new Set(entries.map((entry) => entry.occurrenceId)).size).toBe(4);
		expect(entries.every((entry) => !('week' in entry) && !('exposure' in entry))).toBe(true);
		expect(definition).toEqual(before);
	});

	it('counts every ordered within-week exposure and aligns selected weekdays from any start date', () => {
		const varied = structuredClone(definition);
		varied.cycle!.weeks[0].exposures.push({ id: 'light', name: 'Light', templates: [] });
		expect(cycleOpportunityCount(varied)).toBe(5);
		expect(planWholeCycle(varied, '2026-09-23', [0, 3]).map((entry) => entry.date)).toEqual([
			'2026-09-24', '2026-09-28', '2026-10-01', '2026-10-08', '2026-10-15',
		]);
	});

	it('supports ordinary one-week workouts and rejects empty days/invalid dates', () => {
		const ordinary = { id: 'bench', name: 'Bench', templates: [] };
		expect(planWholeCycle(ordinary, '2026-12-31', [0])).toEqual([
			expect.objectContaining({ date: '2027-01-04', workoutId: 'bench', cycleId: 'bench' }),
		]);
		expect(planWholeCycle(definition, '2026-09-21', [])).toEqual([]);
		expect(planWholeCycle(definition, '2026-09-21', [9])).toEqual([]);
		expect(planWholeCycle(definition, '2026-02-30', [0])).toEqual([]);
		expect(planWholeCycle(definition, '', [0])).toEqual([]);
	});

	it('leaves cardio, rest, clear and blocker semantics unchanged', () => {
		for (const workoutId of ['cardio:run', 'rest', '__rest__', 'blocker']) {
			expect(createScheduleOpportunity('2026-09-21', workoutId)).toEqual({ date: '2026-09-21', workoutId });
		}
		const first = createScheduleOpportunity('2026-09-21', 'squat');
		const second = createScheduleOpportunity('2026-09-21', 'squat');
		expect(first.occurrenceId).not.toBe(second.occurrenceId);
	});

	it('exposes whole-cycle planning inside the existing planner', () => {
		const markup = renderToStaticMarkup(createElement(CalendarPush, {
			workouts: [workout], definitions: [definition], cardioActivities: [],
			onUpdateSchedule: () => undefined, onClear: clear,
		}));
		expect(markup).toContain('Plan a whole cycle');
		expect(markup).toContain('Repeat weekly schedule');
	});
});

describe('occurrence-aware schedule completion', () => {
	it('matches identity across date moves, not a different appointment for the same workout', () => {
		const entry = { date: '2026-09-28', workoutId: 'squat', occurrenceId: 'first' };
		expect(matchesScheduledOccurrence(entry, row({ occurrenceId: 'first' }))).toBe(true);
		expect(matchesScheduledOccurrence(entry, row({ date: entry.date, occurrenceId: 'second' }))).toBe(false);
		expect(matchesScheduledOccurrence(entry, row({ date: entry.date }))).toBe(false);
		expect(matchesScheduledOccurrence(entry, row({ occurrenceId: 'first', workoutId: 'bench' }))).toBe(false);
		expect(matchesScheduledOccurrence({ date: '2026-09-21', workoutId: 'squat' }, row())).toBe(true);
	});

	it('keeps same-day occurrences distinct and opens current pending work after missed dates', () => {
		const plan = buildTodaysPlan({
			date: '2026-09-28', workouts: [workout],
			workoutSchedule: ['first', 'second'].map((occurrenceId) => ({
				date: '2026-09-28', workoutId: 'squat', cycleId: 'squat', occurrenceId,
			})),
			logRows: [row({ occurrenceId: 'first' })],
		});
		expect(plan).toMatchObject([
			{ kind: 'strength', done: true, occurrenceId: 'first' },
			{ kind: 'strength', done: false, occurrenceId: 'second' },
		]);
		expect(plan[1].kind === 'strength' && plan[1].workout).toBe(workout);
	});

	it('groups distinct occurrences independently even when legacy session keys coincide', () => {
		const grouped = groupLogByDate([row({ occurrenceId: 'first' }), row({ occurrenceId: 'second' })]);
		expect(grouped.get('2026-09-21')).toHaveLength(2);
	});

	it('renders only the completed occurrence as completed in the calendar', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 8, 21, 12));
		const entries: WorkoutScheduleEntry[] = ['first', 'second'].map((occurrenceId) => ({
			date: '2026-09-21', workoutId: 'squat', occurrenceId,
		}));
		const markup = renderToStaticMarkup(createElement(CalendarView, {
			workouts: [workout], definitions: [definition], workoutSchedule: entries,
			cardioActivities: [], dayFlags: [], logRows: [row({ occurrenceId: 'first' })],
			onAssign: () => undefined, onRemove: () => undefined, onUpdateLabel: () => undefined,
			onOpenWorkout: () => undefined, onUpdateLogRows: async () => undefined,
			onDeleteSession: async () => undefined, onBulkSchedule: () => undefined,
			onUpdateFlags: () => undefined, onClearSchedule: clear,
			onSyncCalendar: async () => ({
				created: 0, updated: 0, deleted: 0, pulledCreations: 0, pulledDateChanges: 0, pulledDeletions: 0, errors: [],
			}),
		}));
		expect(markup.match(/class="calendar-completed-bar"/g)).toHaveLength(1);
		expect(markup).toContain('Week 2/4');
	});
});

describe('cycle stage labels and history', () => {
	it('leaves single-week cards unchanged and shows a shared week only for aligned exercises', () => {
		expect(workoutCycleLabels({ ...workout, exercises: [{ ...workout.exercises[0], cycleStage: stage({ week: 1, weekCount: 1 }) }] })).toEqual([]);
		expect(workoutCycleLabels(workout)).toEqual(['Week 2/4']);
		const markup = renderToStaticMarkup(createElement(WorkoutSelect, { workouts: [workout], onSelect: () => undefined }));
		expect(markup).toContain('Week 2/4');
	});

	it('shows individual stages when exercise weeks or exposures diverge', () => {
		const mixed = {
			...workout, exercises: [...workout.exercises, {
				...workout.exercises[0], name: 'Bench', cycleStage: stage({ exerciseId: 'bench', week: 3 }),
			}],
		};
		const markup = renderToStaticMarkup(createElement(WorkoutSelect, { workouts: [mixed], onSelect: () => undefined }));
		expect(markup).toContain('Squat: Week 2/4');
		expect(markup).toContain('Bench: Week 3/4');
		mixed.exercises[1].cycleStage = stage({ exerciseId: 'bench', week: 2, exposure: 2, exposureCount: 2 });
		expect(workoutCycleLabels(mixed)).toHaveLength(2);
		expect(workoutCycleLabels(mixed)[1]).toContain('Exposure 2/2');
	});

	it('shows actionable errors and disables invalid workout starts', () => {
		const markup = renderToStaticMarkup(createElement(WorkoutSelect, {
			workouts: [{ ...workout, error: 'Set a positive training max for Squat.' }],
			onSelect: () => undefined, onEdit: () => undefined,
		}));
		expect(markup).toContain('class="workout-card" disabled=""');
		expect(markup).toContain('Set a positive training max for Squat.');
		expect(markup).toContain('Edit workout');
	});

	it('history preserves and displays exercise stage, iteration and frozen planned target', () => {
		const logged = row({
			cycleStage: stage({ iteration: 3, exposure: 2, exposureCount: 2 }),
			plannedTemplate: {
				setType: 'work', percentage: 0.7, weightBasis: { kind: 'trainingMax' },
				minReps: 3, maxReps: 3, amrap: true,
			},
		});
		const session = groupLogByDate([logged]).get(logged.date)![0];
		const markup = renderToStaticMarkup(createElement(SessionDetail, {
			session, workoutNames: new Map(), onSave: async () => undefined, onClose: () => undefined,
		}));
		expect(markup).toContain('Week 2/4');
		expect(markup).toContain('Exposure 2/2');
		expect(markup).toContain('Iteration 3');
		expect(markup).toContain('Planned: 140 × 3+ (70% TM)');
		expect(session.rows[0]).toBe(logged);
	});
});
