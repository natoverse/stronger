import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CalendarView } from '../CalendarView.js';

describe('CalendarView month schedule', () => {
	it('renders color-coded workouts and active day flags in the current month', () => {
		const now = new Date();
		const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
		const markup = renderToStaticMarkup(createElement(CalendarView, {
			workouts: [{ id: 'workout-a', name: 'Strength A', exercises: [], favorite: false }],
			cardioActivities: [{ id: 'run', name: 'Run' }],
			workoutSchedule: [
				{ date: today, workoutId: 'workout-a' },
				{ date: today, workoutId: 'cardio:run' },
				{ date: today, workoutId: 'rest' },
			],
			dayFlags: [{
				date: today,
				flags: { home: true, elsewhere: false, travel: true, visitors: false, alcohol: false, blocked: false },
			}],
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
		expect(markup).toContain(monthLabel);
		expect(markup).toContain('calendar-month-dot-strength');
		expect(markup).toContain('calendar-month-dot-cardio');
		expect(markup).toContain('calendar-month-dot-rest');
		expect(markup).toContain('calendar-month-flag-home calendar-month-flag-active');
		expect(markup).toContain('calendar-month-flag-travel calendar-month-flag-active');
		expect(markup).toContain('calendar-month-flag-elsewhere');
		expect(markup).toContain('Elsewhere: inactive');
		expect(markup).toContain('All workouts');
		expect(markup.match(/aria-pressed="true"/g)).toHaveLength(2);
		expect(markup).toContain('Monthly');
		expect(markup).toContain('calendar-fixed-section');
		expect(markup).toContain('calendar-days-scroll');
		expect(markup).toContain('Load previous days');
		expect(markup).not.toContain('>History<');
		expect(markup).toContain('Show next month');
		expect(markup).not.toContain(`Remove ${monthLabel}`);
	});
});
