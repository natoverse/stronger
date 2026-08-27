import { describe, it, expect } from 'vitest';
import { generatePastDays, groupLogByDate, buildDayInfos, buildMonthGrid, includeCalendarDate } from '../CalendarView.js';
import type { LogSession } from '../CalendarView.js';
import type { ParsedLogRow } from '../../google/index.js';

describe('generatePastDays', () => {
	it('generates the correct number of past days', () => {
		const result = generatePastDays('2026-04-04', 3);
		expect(result).toEqual(['2026-04-03', '2026-04-02', '2026-04-01']);
	});

	describe('includeCalendarDate', () => {
		it('fills every day back to an earlier selected date', () => {
			const result = includeCalendarDate(['2026-08-21', '2026-08-22'], '2026-08-01');

			expect(result).toHaveLength(22);
			expect(result[0]).toBe('2026-08-01');
			expect(result[20]).toBe('2026-08-21');
			expect(result[21]).toBe('2026-08-22');
		});

		it('fills every day through the end of a later selected month', () => {
			const result = includeCalendarDate(['2026-12-30', '2026-12-31'], '2027-01-03');

			expect(result).toHaveLength(33);
			expect(result.slice(0, 5)).toEqual([
				'2026-12-30',
				'2026-12-31',
				'2027-01-01',
				'2027-01-02',
				'2027-01-03',
			]);
			expect(result.at(-1)).toBe('2027-01-31');
		});

		it('loads the rest of the month when the selected date is already detailed', () => {
			const result = includeCalendarDate(['2026-08-21', '2026-08-22'], '2026-08-22');

			expect(result).toHaveLength(11);
			expect(result[0]).toBe('2026-08-21');
			expect(result.at(-1)).toBe('2026-08-31');
		});

		it('keeps an already loaded selected month unchanged', () => {
			const dates = Array.from({ length: 11 }, (_, index) => `2026-08-${String(index + 21).padStart(2, '0')}`);
			expect(includeCalendarDate(dates, '2026-08-22')).toBe(dates);
		});
	});
});

describe('buildMonthGrid', () => {
	it('builds a Sunday-first grid for the current month', () => {
		const result = buildMonthGrid(new Date(2026, 7, 21), 0);

		expect(result.label).toBe('August 2026');
		expect(result.dates.slice(0, 6)).toEqual([
			null,
			null,
			null,
			null,
			null,
			null,
		]);
		expect(result.dates[6]).toBe('2026-08-01');
		expect(result.dates).toContain('2026-08-31');
		expect(result.dates.length % 7).toBe(0);
	});

	it('rolls forward across a year boundary', () => {
		const result = buildMonthGrid(new Date(2026, 11, 15), 1);

		expect(result.label).toBe('January 2027');
		expect(result.dates).toContain('2027-01-01');
		expect(result.dates).toContain('2027-01-31');
	});
});

describe('generatePastDays boundaries', () => {
	it('handles month boundaries', () => {
		const result = generatePastDays('2026-03-02', 3);
		expect(result).toEqual(['2026-03-01', '2026-02-28', '2026-02-27']);
	});

	it('returns empty array for count 0', () => {
		const result = generatePastDays('2026-04-04', 0);
		expect(result).toEqual([]);
	});

	it('handles year boundaries', () => {
		const result = generatePastDays('2026-01-02', 3);
		expect(result).toEqual(['2026-01-01', '2025-12-31', '2025-12-30']);
	});
});

function makeLogRow(overrides: Partial<ParsedLogRow> = {}): ParsedLogRow {
	return {
		date: '2026-04-01',
		startTime: '2026-04-01T10:00:00.000Z',
		endTime: '2026-04-01T11:00:00.000Z',
		workoutId: 'workout-a',
		exerciseName: 'Bench Press',
		liftId: 'bench',
		setNumber: 1,
		setType: 'work',
		plannedWeight: 185,
		plannedReps: 5,
		actualWeight: 185,
		actualReps: 5,
		completed: true,
		...overrides,
	};
}

describe('groupLogByDate', () => {
	it('groups rows by date and session', () => {
		const rows: ParsedLogRow[] = [
			makeLogRow({ setNumber: 1 }),
			makeLogRow({ setNumber: 2 }),
			makeLogRow({ date: '2026-04-02', startTime: '2026-04-02T09:00:00.000Z' }),
		];

		const result = groupLogByDate(rows);
		expect(result.size).toBe(2);
		expect(result.get('2026-04-01')!.length).toBe(1); // 1 session
		expect(result.get('2026-04-01')![0].rows.length).toBe(2); // 2 sets
		expect(result.get('2026-04-02')!.length).toBe(1);
	});

	it('separates different workouts on the same day', () => {
		const rows: ParsedLogRow[] = [
			makeLogRow({ workoutId: 'a', startTime: '2026-04-01T10:00:00.000Z' }),
			makeLogRow({ workoutId: 'b', startTime: '2026-04-01T14:00:00.000Z' }),
		];

		const result = groupLogByDate(rows);
		expect(result.get('2026-04-01')!.length).toBe(2);
	});

	it('returns empty map for empty input', () => {
		const result = groupLogByDate([]);
		expect(result.size).toBe(0);
	});

	it('uses workoutNames map for session display name when provided', () => {
		const rows: ParsedLogRow[] = [
			makeLogRow({ workoutId: 'workout-a' }),
		];
		const names = new Map([['workout-a', 'Workout A – Upper']]);

		const result = groupLogByDate(rows, names);
		const sessions = result.get('2026-04-01')!;
		expect(sessions[0].workoutName).toBe('Workout A – Upper');
	});

	it('falls back to workoutId when workoutNames is not provided', () => {
		const rows: ParsedLogRow[] = [
			makeLogRow({ workoutId: 'workout-a' }),
		];

		const result = groupLogByDate(rows);
		const sessions = result.get('2026-04-01')!;
		expect(sessions[0].workoutName).toBe('workout-a');
	});
});

describe('buildDayInfos', () => {
	it('merges schedule and log data for each date', () => {
		const dates = ['2026-04-01', '2026-04-02', '2026-04-03'];
		const scheduleMap = new Map<string, string[]>([
			['2026-04-01', ['workout-a']],
			['2026-04-02', ['workout-b']],
		]);

		const session: LogSession = {
			key: { date: '2026-04-01', workoutId: 'workout-a', startTime: '2026-04-01T10:00:00.000Z' },
			workoutName: 'Bench Press',
			rows: [makeLogRow()],
		};

		const logByDate = new Map([['2026-04-01', [session]]]);

		const result = buildDayInfos(dates, scheduleMap, logByDate);
		expect(result.length).toBe(3);

		// Day 1: scheduled + logged
		expect(result[0].scheduled).toEqual(['workout-a']);
		expect(result[0].sessions.length).toBe(1);

		// Day 2: scheduled only
		expect(result[1].scheduled).toEqual(['workout-b']);
		expect(result[1].sessions.length).toBe(0);

		// Day 3: neither
		expect(result[2].scheduled).toEqual([]);
		expect(result[2].sessions.length).toBe(0);
	});

	it('includes unscheduled logged sessions', () => {
		const dates = ['2026-04-01'];
		const scheduleMap = new Map<string, string[]>();
		const session: LogSession = {
			key: { date: '2026-04-01', workoutId: 'workout-x', startTime: '2026-04-01T10:00:00.000Z' },
			workoutName: 'Unscheduled Workout',
			rows: [makeLogRow({ workoutId: 'workout-x' })],
		};
		const logByDate = new Map([['2026-04-01', [session]]]);

		const result = buildDayInfos(dates, scheduleMap, logByDate);
		expect(result[0].scheduled).toEqual([]);
		expect(result[0].sessions.length).toBe(1);
	});

	it('attaches custom labels for the matching date + workoutId', () => {
		const dates = ['2026-04-01', '2026-04-02'];
		const scheduleMap = new Map<string, string[]>([
			['2026-04-01', ['cardio:hike']],
			['2026-04-02', ['workout-b']],
		]);
		const logByDate = new Map<string, LogSession[]>();
		const labelsMap = new Map<string, Record<string, string>>([
			['2026-04-01', { 'cardio:hike': "Angel's Rest Trail" }],
		]);

		const result = buildDayInfos(dates, scheduleMap, logByDate, undefined, labelsMap);
		expect(result[0].labels).toEqual({ 'cardio:hike': "Angel's Rest Trail" });
		expect(result[1].labels).toBeUndefined();
	});
});
