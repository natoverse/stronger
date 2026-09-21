import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEventItem } from '../types.js';
import type { WorkoutScheduleEntry } from '../../model/types.js';
import { embedCycleMetadata, extractCycleMetadata, syncScheduleWithCalendar } from '../calendar.js';

const base = 'https://example.com/stronger/';
const name = (id: string) => id === 'squat' ? 'Squat cycle' : id === 'rest' ? 'Rest' : id === 'cardio:run' ? 'Run' : null;
const id = (value: string) => value === 'Squat cycle' ? 'squat' : value === 'Run' ? 'cardio:run' : null;
function mockCalendar(items: CalendarEventItem[] = []) {
	let nextId = 0;
	const events = {
		list: vi.fn().mockResolvedValue({ result: { items } }),
		insert: vi.fn().mockImplementation(async () => ({ result: { id: `new-${++nextId}` } })),
		update: vi.fn().mockResolvedValue({ result: {} }),
		delete: vi.fn().mockResolvedValue({}),
	};
	vi.stubGlobal('window', { location: { href: base }, gapi: { client: { calendar: { events } } } });
	return events;
}
function event(occurrenceId: string, overrides: Partial<CalendarEventItem> = {}): CalendarEventItem {
	return {
		id: `event-${occurrenceId}`, summary: 'Squat cycle', start: { date: '2026-09-21' },
		description: embedCycleMetadata(`Open workout: ${base}#/workout/squat\n[stronger:s-${occurrenceId}]`, {
			cycleId: 'squat', occurrenceId,
		}),
		...overrides,
	};
}
afterEach(() => vi.unstubAllGlobals());

describe('calendar cycle metadata', () => {
	it('round-trips opaque IDs safely and replaces only known tags', () => {
		const metadata = { cycleId: 'squat / [cycle] ü', occurrenceId: 'occurrence?=&[]\n' };
		const description = embedCycleMetadata('User note\n[stronger:s-1]', metadata);
		expect(extractCycleMetadata(description)).toEqual(metadata);
		expect(embedCycleMetadata(description, metadata)).toBe(description);
		expect(description).toContain('User note\n[stronger:s-1]');
		expect(extractCycleMetadata('Legacy event')).toEqual({});
		expect(extractCycleMetadata('[stronger-cycle:%broken]\n[stronger-occurrence:valid]')).toEqual({ occurrenceId: 'valid' });
	});

	it('pushes distinct same-day occurrences without losing unrelated events', async () => {
		const events = mockCalendar();
		const schedule: WorkoutScheduleEntry[] = [
			{ date: '2026-09-21', workoutId: 'squat', cycleId: 'squat', occurrenceId: 'first' },
			{ date: '2026-09-21', workoutId: 'squat', cycleId: 'squat', occurrenceId: 'second' },
			{ date: '2027-02-01', workoutId: 'blocker', label: 'Trip' },
			{ date: '2026-09-21', workoutId: 'cardio:run' },
			{ date: '2026-09-22', workoutId: 'rest' },
		];
		const { updatedSchedule, result } = await syncScheduleWithCalendar('primary', schedule, name, id);
		expect(result.created).toBe(4);
		expect(updatedSchedule).toHaveLength(5);
		expect(updatedSchedule).toContainEqual(schedule[2]);
		const descriptions = events.insert.mock.calls.map(([request]) => extractCycleMetadata(request.resource.description));
		expect(descriptions).toContainEqual({ cycleId: 'squat', occurrenceId: 'first' });
		expect(descriptions).toContainEqual({ cycleId: 'squat', occurrenceId: 'second' });
	});

	it('recovers every distinct occurrence from Google, including date moves and custom titles', async () => {
		mockCalendar([
			event('first', { summary: 'Later session', start: { date: '2027-03-01' } }),
			event('second', { start: { date: '2027-03-01' } }),
		]);
		const { updatedSchedule, result } = await syncScheduleWithCalendar('primary', [], name, id);
		expect(result.pulledCreations).toBe(2);
		expect(updatedSchedule).toEqual([
			expect.objectContaining({ date: '2027-03-01', workoutId: 'squat', cycleId: 'squat', occurrenceId: 'first', label: 'Later session' }),
			expect.objectContaining({ date: '2027-03-01', workoutId: 'squat', cycleId: 'squat', occurrenceId: 'second' }),
		]);
	});

	it('preserves identity when Google moves a linked appointment', async () => {
		mockCalendar([event('first', { start: { date: '2026-10-05' } })]);
		const entry = {
			date: '2026-09-21', workoutId: 'squat', cycleId: 'squat', occurrenceId: 'first',
			strongerId: 's-first', calendarEventId: 'event-first',
		};
		const { updatedSchedule, result } = await syncScheduleWithCalendar('primary', [entry], name, id);
		expect(updatedSchedule).toEqual([{ ...entry, date: '2026-10-05' }]);
		expect(result.pulledDateChanges).toBe(1);
	});

	it('fills missing local metadata from a linked event without changing its stage or date', async () => {
		const events = mockCalendar([event('first')]);
		const { updatedSchedule } = await syncScheduleWithCalendar('primary', [{
			date: '2026-09-21', workoutId: 'squat', strongerId: 's-first', calendarEventId: 'event-first',
		}], name, id);
		expect(updatedSchedule[0]).toMatchObject({ cycleId: 'squat', occurrenceId: 'first' });
		expect(events.update).not.toHaveBeenCalled();
	});

	it('stamps missing remote metadata and retains it through later title changes', async () => {
		const events = mockCalendar([event('first', { description: 'My note\n[stronger:s-first]' })]);
		const entry = {
			date: '2026-09-21', workoutId: 'squat', cycleId: 'squat', occurrenceId: 'first',
			strongerId: 's-first', calendarEventId: 'event-first', label: 'Lunch lifting',
		};
		await syncScheduleWithCalendar('primary', [entry], name, id);
		const resource = events.update.mock.calls[0][0].resource;
		expect(resource.summary).toBe('Lunch lifting');
		expect(resource.description).toContain('My note\n[stronger:s-first]');
		expect(extractCycleMetadata(resource.description)).toEqual({ cycleId: 'squat', occurrenceId: 'first' });
	});

	it('still deduplicates legacy events by workout and date', async () => {
		mockCalendar([
			{ id: 'legacy-a', summary: 'Squat cycle', start: { date: '2026-09-21' } },
			{ id: 'legacy-b', summary: 'Squat cycle', start: { date: '2026-09-21' } },
		]);
		const { updatedSchedule } = await syncScheduleWithCalendar('primary', [], name, id);
		expect(updatedSchedule).toHaveLength(1);
		expect(updatedSchedule[0].occurrenceId).toBeUndefined();
	});
});
