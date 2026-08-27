import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CalendarView, getDayLocation, toggleCalendarPanel } from '../CalendarView.js';

describe('CalendarView month schedule', () => {
	it('treats every toolbar panel as a mutually exclusive toggle', () => {
		expect(toggleCalendarPanel(null, 'plan')).toBe('plan');
		expect(toggleCalendarPanel('monthly', 'plan')).toBe('plan');
		expect(toggleCalendarPanel('plan', 'monthly')).toBe('monthly');
		expect(toggleCalendarPanel('monthly', 'monthly')).toBeNull();
	});

	it('uses the last active location when legacy flags contain multiple locations', () => {
		expect(getDayLocation({ home: true, elsewhere: true, travel: false, visitors: false, alcohol: false, blocked: false })).toBe('elsewhere');
		expect(getDayLocation({ home: true, elsewhere: true, travel: true, visitors: false, alcohol: false, blocked: false })).toBe('travel');
		expect(getDayLocation()).toBe('home');
	});

	it('renders up to two color-coded workout tags and distinct location icons in the current month', () => {
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
					flags: { home: false, elsewhere: false, travel: true, visitors: false, alcohol: true, blocked: false },
				},
			],
			logRows: [],
			onAssign: () => undefined,
			onRemove: () => undefined,
			onUpdateLabel: () => undefined,
			onOpenWorkout: () => undefined,
			onUpdateLogRows: () => undefined,
			onDeleteSession: () => undefined,
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
		const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
		expect(markup).toContain(monthLabel);
		expect(markup).toContain('calendar-month-tag-strength');
		expect(markup).toContain('calendar-month-tag-cardio');
		expect(markup).toContain('calendar-month-tag-rest');
		expect(markup).toContain('>Strength A</span>');
		expect(markup).toContain('>Run</span>');
		expect(markup).toContain('>Rest</span>');
		expect(markup).toContain('>unknown</span>');
		expect(markup).not.toContain('>cardio:unknown</span>');
		expect(markup).toContain('>deleted-workout</span>');
		expect(markup).not.toContain('hidden-workout');
		expect(markup.match(/class="calendar-month-tag calendar-month-tag-/g)).toHaveLength(5);
		expect(markup).toContain('calendar-month-location');
		expect(markup).toContain('lucide-house');
		expect(markup).toContain('lucide-tree-palm');
		expect(markup).toContain('lucide-plane');
		expect(markup).toContain('calendar-month-location-home');
		expect(markup).toContain('calendar-month-location-elsewhere');
		expect(markup).toContain('calendar-month-location-travel');
		expect(markup.match(/aria-label="(home|elsewhere|travel)"/g)).toHaveLength(daysInMonth);
		expect(markup).not.toContain('calendar-month-flag');
		expect(markup).not.toContain('calendar-month-flag-alcohol');
		expect(markup).not.toContain('Alcohol: active');
		expect(markup).toContain('All workouts');
		expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
		expect(markup).toContain('Monthly');
		expect(markup.indexOf('Monthly')).toBeLessThan(markup.indexOf('Plan'));
		expect(markup).toContain('calendar-fixed-section');
		expect(markup).toContain('calendar-days-scroll');
		expect(markup).toContain('Load previous days');
		expect(markup).not.toContain('>History<');
		expect(markup).toContain('Show next month');
		expect(markup).not.toContain(`Remove ${monthLabel}`);
	});
});
