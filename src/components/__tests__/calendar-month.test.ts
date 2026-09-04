import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CalendarView, getDayLocation, orderScheduledWorkouts, toggleCalendarPanel } from '../CalendarView.js';
import { CalendarPush } from '../CalendarPush.js';

describe('CalendarView month schedule', () => {
	it('treats every toolbar panel as a mutually exclusive toggle', () => {
		expect(toggleCalendarPanel(null, 'plan')).toBe('plan');
		expect(toggleCalendarPanel('monthly', 'plan')).toBe('plan');
		expect(toggleCalendarPanel('plan', 'monthly')).toBe('monthly');
		expect(toggleCalendarPanel('monthly', 'monthly')).toBeNull();
	});

	it('places clear controls below schedule filling in the Plan panel', () => {
		const markup = renderToStaticMarkup(createElement(CalendarPush, {
			workouts: [],
			cardioActivities: [],
			onUpdateSchedule: () => undefined,
			onClear: async () => ({
				flagsCleared: 0,
				scheduleCleared: 0,
				calendarEventsDeleted: 0,
				errors: [],
			}),
		}));

		expect(markup.indexOf('<h3>Plan</h3>')).toBeLessThan(markup.indexOf('<h3>Clear Schedule</h3>'));
		expect(markup).toContain('class="calendar-clear"');
	});

	it('uses the last active location when legacy flags contain multiple locations', () => {
		expect(getDayLocation({ home: true, elsewhere: true, travel: false, visitors: false, alcohol: false, blocked: false })).toBe('elsewhere');
		expect(getDayLocation({ home: true, elsewhere: true, travel: true, visitors: false, alcohol: false, blocked: false })).toBe('travel');
		expect(getDayLocation()).toBe('home');
	});

	it('orders cardio before strength and rest without changing order within each type', () => {
		expect(orderScheduledWorkouts([
			'strength-b',
			'rest',
			'cardio:run',
			'strength-a',
			'cardio:bike',
		])).toEqual([
			'cardio:run',
			'cardio:bike',
			'strength-b',
			'strength-a',
			'rest',
		]);
	});

	it('orders blocker before cardio, strength, and rest', () => {
		expect(orderScheduledWorkouts([
			'strength-a',
			'rest',
			'cardio:run',
			'blocker',
		])).toEqual([
			'blocker',
			'cardio:run',
			'strength-a',
			'rest',
		]);
	});

	it('renders up to three color-coded workout tags and day status icons in the current month', () => {
		const now = new Date();
		const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
		const markup = renderToStaticMarkup(createElement(CalendarView, {
			workouts: [{ id: 'workout-a', name: 'Strength A', exercises: [], favorite: false }],
			cardioActivities: [{ id: 'run', name: 'Run' }],
			workoutSchedule: [
				{ date: `${monthPrefix}-15`, workoutId: 'workout-a' },
				{ date: `${monthPrefix}-15`, workoutId: 'cardio:run' },
				{ date: `${monthPrefix}-15`, workoutId: 'hidden-workout' },
				{ date: `${monthPrefix}-16`, workoutId: 'rest' },
				{ date: `${monthPrefix}-17`, workoutId: 'cardio:unknown' },
				{ date: `${monthPrefix}-18`, workoutId: 'deleted-workout' },
			],
			dayFlags: [
				{
					date: `${monthPrefix}-12`,
					flags: { home: true, elsewhere: false, travel: false, visitors: false, alcohol: false, blocked: false },
				},
				{
					date: `${monthPrefix}-13`,
					flags: { home: false, elsewhere: true, travel: false, visitors: false, alcohol: false, blocked: false },
				},
				{
					date: `${monthPrefix}-14`,
					flags: { home: false, elsewhere: false, travel: true, visitors: true, alcohol: true, blocked: true },
				},
			],
			logRows: [],
			onAssign: () => undefined,
			onRemove: () => undefined,
			onUpdateLabel: () => undefined,
			onOpenWorkout: () => undefined,
			onUpdateLogRows: async () => undefined,
			onDeleteSession: async () => undefined,
			onBulkSchedule: () => undefined,
			onUpdateFlags: () => undefined,
			onSyncCalendar: async () => ({
				created: 0,
				updated: 0,
				deleted: 0,
				pulledCreations: 0,
				pulledDateChanges: 0,
				pulledDeletions: 0,
				errors: [],
			}),
			onClearSchedule: async () => ({
				flagsCleared: 0,
				scheduleCleared: 0,
				calendarEventsDeleted: 0,
				errors: [],
			}),
		}));

		const monthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
		const nextMonthLabel = new Date(now.getFullYear(), now.getMonth() + 1, 1)
			.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
		const followingMonthLabel = new Date(now.getFullYear(), now.getMonth() + 2, 1)
			.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
		const visibleDays = [0].reduce(
			(total, offset) => total + new Date(now.getFullYear(), now.getMonth() + offset + 1, 0).getDate(),
			0,
		);
		expect(markup).toContain(monthLabel);
		expect(markup).not.toContain(nextMonthLabel);
		expect(markup).not.toContain(followingMonthLabel);
		expect(markup).toContain('calendar-month-tag-strength');
		expect(markup).toContain('calendar-month-tag-cardio');
		expect(markup).toContain('calendar-month-tag-rest');
		expect(markup).toContain('>Strength A</span>');
		expect(markup).toContain('>Run</span>');
		expect(markup.indexOf('>Run</span>')).toBeLessThan(markup.indexOf('>Strength A</span>'));
		expect(markup).toContain('>Rest</span>');
		expect(markup).toContain('>unknown</span>');
		expect(markup).not.toContain('>cardio:unknown</span>');
		expect(markup).toContain('>deleted-workout</span>');
		expect(markup).toContain('>hidden-workout</span>');
		expect(markup.match(/class="calendar-month-tag calendar-month-tag-/g)).toHaveLength(6);
		expect(markup).toContain('calendar-month-location');
		expect(markup).toContain('lucide-house');
		expect(markup).toContain('lucide-tree-palm');
		expect(markup).toContain('lucide-plane');
		expect(markup).toContain('calendar-month-location-home');
		expect(markup).toContain('calendar-month-location-elsewhere');
		expect(markup).toContain('calendar-month-location-travel');
		expect(markup).toContain('calendar-month-visitors');
		expect(markup).toContain('aria-label="visitors"');
		expect(markup).toContain('calendar-month-day-blocked');
		expect(markup.match(/aria-label="(home|elsewhere|travel)"/g)).toHaveLength(visibleDays);
		expect(markup).not.toContain('calendar-month-flag');
		expect(markup).not.toContain('calendar-month-flag-alcohol');
		expect(markup).not.toContain('Alcohol: active');
		expect(markup).toContain('All workouts');
		expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
		expect(markup).toContain('Monthly');
		expect(markup.indexOf('Monthly')).toBeLessThan(markup.indexOf('Plan'));
		expect(markup).toContain('calendar-fixed-section');
		expect(markup).not.toContain('>Clear</button>');
		expect(markup).toContain('calendar-days-scroll');
		expect(markup).toContain('Load previous days');
		expect(markup).not.toContain('>History<');
		expect(markup).toContain('Show next month');
		expect(markup).not.toContain(`Remove ${monthLabel}`);
		expect(markup).not.toContain(`Remove ${nextMonthLabel}`);
		expect(markup).not.toContain(`Remove ${followingMonthLabel}`);
	});

	it('uses definition names when a scheduled workout is unavailable for execution', () => {
		const now = new Date();
		const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
		const markup = renderToStaticMarkup(createElement(CalendarView, {
			workouts: [],
			workoutDefinitions: [{ id: 'workout-a', name: 'Strength A' }],
			cardioActivities: [],
			workoutSchedule: [{ date: `${monthPrefix}-15`, workoutId: 'workout-a' }],
			dayFlags: [],
			logRows: [],
			onAssign: () => undefined,
			onRemove: () => undefined,
			onUpdateLabel: () => undefined,
			onOpenWorkout: () => undefined,
			onUpdateLogRows: async () => undefined,
			onDeleteSession: async () => undefined,
			onBulkSchedule: () => undefined,
			onUpdateFlags: () => undefined,
			onSyncCalendar: async () => ({
				created: 0,
				updated: 0,
				deleted: 0,
				pulledCreations: 0,
				pulledDateChanges: 0,
				pulledDeletions: 0,
				errors: [],
			}),
			onClearSchedule: async () => ({
				flagsCleared: 0,
				scheduleCleared: 0,
				calendarEventsDeleted: 0,
				errors: [],
			}),
		}));

		expect(markup).toContain('>Strength A</span>');
		expect(markup).not.toContain('>workout-a</span>');
	});

	it('renders a scheduled Blocker as a red, labelable day-list item and month tag', () => {
		const now = new Date();
		const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
		const today = `${monthPrefix}-${String(now.getDate()).padStart(2, '0')}`;
		const markup = renderToStaticMarkup(createElement(CalendarView, {
			workouts: [],
			cardioActivities: [],
			workoutSchedule: [{ date: today, workoutId: 'blocker' }],
			dayFlags: [],
			logRows: [],
			onAssign: () => undefined,
			onRemove: () => undefined,
			onUpdateLabel: () => undefined,
			onOpenWorkout: () => undefined,
			onUpdateLogRows: async () => undefined,
			onDeleteSession: async () => undefined,
			onBulkSchedule: () => undefined,
			onUpdateFlags: () => undefined,
			onSyncCalendar: async () => ({
				created: 0,
				updated: 0,
				deleted: 0,
				pulledCreations: 0,
				pulledDateChanges: 0,
				pulledDeletions: 0,
				errors: [],
			}),
			onClearSchedule: async () => ({
				flagsCleared: 0,
				scheduleCleared: 0,
				calendarEventsDeleted: 0,
				errors: [],
			}),
		}));

		expect(markup).toContain('calendar-month-tag-blocker');
		expect(markup).toContain('calendar-workout-link-blocker');
		expect(markup).toContain('>Blocker</span>');
		expect(markup).toContain('lucide-ban');
		expect(markup).toContain('calendar-label-edit-btn');
	});
});
