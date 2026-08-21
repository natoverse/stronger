import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CalendarView } from '../CalendarView.js';

describe('CalendarView month schedule', () => {
	it('renders the current month and one dot per scheduled workout', () => {
		const now = new Date();
		const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
		const markup = renderToStaticMarkup(createElement(CalendarView, {
			workouts: [],
			cardioActivities: [],
			workoutSchedule: [
				{ date: today, workoutId: 'workout-a' },
				{ date: today, workoutId: 'workout-b' },
			],
			dayFlags: [],
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
		expect(markup.match(/class="calendar-month-dot"/g)).toHaveLength(2);
		expect(markup).toContain('All workouts');
	});
});
