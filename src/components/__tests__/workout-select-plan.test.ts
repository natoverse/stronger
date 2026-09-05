import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildTodaysPlan, WorkoutSelect } from '../WorkoutSelect.js';
import type { Workout, WorkoutScheduleEntry } from '../../model/index.js';

const workout: Workout = { id: 'A', name: 'Squat Day', exercises: [], favorite: false };

const schedule: WorkoutScheduleEntry[] = [
	{ date: '2026-01-02', workoutId: 'A' },
	{ date: '2026-01-02', workoutId: 'rest' },
	{ date: '2026-01-02', workoutId: 'cardio:run', label: 'Riverside loop' },
	{ date: '2026-01-02', workoutId: 'blocker', label: 'Dentist' },
	{ date: '2026-01-03', workoutId: 'A' },
];

describe('buildTodaysPlan', () => {
	it('orders blockers, cardio, strength, then rest', () => {
		const plan = buildTodaysPlan({
			date: '2026-01-02',
			workoutSchedule: schedule,
			workouts: [workout],
			cardioActivities: [{ id: 'run', name: 'Run' }],
		});
		expect(plan.map((i) => i.kind)).toEqual(['blocker', 'cardio', 'strength', 'rest']);
		expect(plan.map((i) => (i.kind === 'strength' ? i.workout.name : i.name)))
			.toEqual(['Dentist', 'Riverside loop', 'Squat Day', 'Rest']);
	});

	it('falls back to the cardio activity name and skips unknown workouts', () => {
		const plan = buildTodaysPlan({
			date: '2026-01-02',
			workoutSchedule: [
				{ date: '2026-01-02', workoutId: 'cardio:run' },
				{ date: '2026-01-02', workoutId: 'missing' },
			],
			workouts: [workout],
			cardioActivities: [{ id: 'run', name: 'Run' }],
		});
		expect(plan).toEqual([{ kind: 'cardio', workoutId: 'cardio:run', name: 'Run' }]);
	});

	it('marks strength workouts logged today as done', () => {
		const plan = buildTodaysPlan({
			date: '2026-01-02',
			workoutSchedule: [{ date: '2026-01-02', workoutId: 'A' }],
			workouts: [workout],
			logRows: [{ date: '2026-01-02', workoutId: 'A' } as never],
		});
		expect(plan[0]).toMatchObject({ kind: 'strength', done: true });
	});
});

describe('WorkoutSelect today plan rendering', () => {
	it('renders cardio, rest and blocker items without buttons', () => {
		const today = new Date();
		const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
		const markup = renderToStaticMarkup(createElement(WorkoutSelect, {
			workouts: [workout],
			workoutSchedule: [
				{ date, workoutId: 'cardio:run', label: 'Riverside loop' },
				{ date, workoutId: 'rest' },
				{ date, workoutId: 'blocker', label: 'Dentist' },
			],
			cardioActivities: [{ id: 'run', name: 'Run' }],
			onSelect: () => undefined,
		}));
		expect(markup).toContain('plan-info-card-cardio');
		expect(markup).toContain('Riverside loop');
		expect(markup).toContain('plan-info-card-rest');
		expect(markup).toContain('plan-info-card-blocker');
		expect(markup).toContain('Dentist');
		const planSection = markup.slice(markup.indexOf('todays-plan'), markup.indexOf('todays-plan') + 2000);
		expect(planSection.indexOf('plan-info-card-blocker')).toBeLessThan(planSection.indexOf('plan-info-card-rest'));
	});
});
