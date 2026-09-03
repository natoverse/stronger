import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CalendarListEntry } from '../../google/index.js';
import { CalendarSync, selectWritableCalendar } from '../CalendarSync.js';

const calendars: CalendarListEntry[] = [
	{ id: 'shared', summary: 'Shared', accessRole: 'writer' },
	{ id: 'primary', summary: 'Primary', accessRole: 'owner', primary: true },
];

describe('CalendarSync authorization', () => {
	it('selects only an explicitly configured writable calendar', () => {
		expect(selectWritableCalendar(calendars, 'shared')?.id).toBe('shared');
		expect(selectWritableCalendar(calendars, 'missing')).toBeUndefined();
		expect(selectWritableCalendar([{ ...calendars[0], primary: false }], null)).toBeUndefined();
		expect(selectWritableCalendar([], null)).toBeUndefined();
	});

	it('requires calendar discovery before synchronization', () => {
		const markup = renderToStaticMarkup(createElement(CalendarSync, {
			configuredCalendarId: null,
			onSync: async () => ({
				created: 0,
				updated: 0,
				deleted: 0,
				pulledCreations: 0,
				pulledDateChanges: 0,
				pulledDeletions: 0,
				errors: [],
			}),
		}));

		expect(markup).toContain('Preparing Calendar');
		expect(markup).not.toContain('Sync with Calendar</button>');
		expect(markup.match(/calendar-push-btn/g)).toHaveLength(1);
	});
});
