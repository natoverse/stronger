import { describe, it, expect } from 'vitest'
import { parseFlagRow, flagEntryToRow, parseWorkoutScheduleRow, workoutScheduleEntryToRow } from '../sheets.ts'

/* ------------------------------------------------------------------ */
/*  parseFlagRow                                                        */
/* ------------------------------------------------------------------ */

describe('parseFlagRow', () => {
	it('parses a valid flag row', () => {
		expect(parseFlagRow(['2025-01-15', 'TRUE', '', '', '', '', ''])).toEqual({
			date: '2025-01-15',
			flags: { home: true, elsewhere: false, travel: false, visitors: false, alcohol: false, blocked: false },
		})
	})

	it('returns null for empty row', () => {
		expect(parseFlagRow([])).toBeNull()
	})

	it('returns null when no flags are set', () => {
		expect(parseFlagRow(['2025-01-15', '', '', '', '', '', ''])).toBeNull()
	})

	it('returns null for invalid date', () => {
		expect(parseFlagRow(['Jan 15 2025', 'TRUE', '', '', '', '', ''])).toBeNull()
	})

	it('returns null for null input', () => {
		expect(parseFlagRow(null as unknown as string[])).toBeNull()
	})

	it('parses multiple flags', () => {
		expect(parseFlagRow(['2025-01-15', 'TRUE', '', 'TRUE', '', 'TRUE', ''])).toEqual({
			date: '2025-01-15',
			flags: { home: true, elsewhere: false, travel: true, visitors: false, alcohol: true, blocked: false },
		})
	})

	it('parses blocked flag', () => {
		expect(parseFlagRow(['2025-01-15', '', '', '', '', '', 'TRUE'])).toEqual({
			date: '2025-01-15',
			flags: { home: false, elsewhere: false, travel: false, visitors: false, alcohol: false, blocked: true },
		})
	})
})

/* ------------------------------------------------------------------ */
/*  flagEntryToRow                                                      */
/* ------------------------------------------------------------------ */

describe('flagEntryToRow', () => {
	it('converts a flag entry to a row', () => {
		expect(flagEntryToRow({
			date: '2025-01-15',
			flags: { home: true, elsewhere: false, travel: false, visitors: false, alcohol: false, blocked: false },
		})).toEqual(['2025-01-15', 'TRUE', '', '', '', '', ''])
	})

	it('round-trips through parseFlagRow', () => {
		const entry = {
			date: '2025-01-15',
			flags: { home: true, elsewhere: false, travel: true, visitors: false, alcohol: false, blocked: true },
		}
		const row = flagEntryToRow(entry)
		expect(parseFlagRow(row)).toEqual(entry)
	})
})

/* ------------------------------------------------------------------ */
/*  parseWorkoutScheduleRow                                             */
/* ------------------------------------------------------------------ */

describe('parseWorkoutScheduleRow', () => {
	it('parses a valid workout schedule row', () => {
		expect(parseWorkoutScheduleRow(['2025-01-15', 'A'])).toEqual({
			date: '2025-01-15',
			workoutId: 'A',
		})
	})

	it('trims whitespace', () => {
		expect(parseWorkoutScheduleRow([' 2025-03-01 ', ' B '])).toEqual({
			date: '2025-03-01',
			workoutId: 'B',
		})
	})

	it('returns null for empty row', () => {
		expect(parseWorkoutScheduleRow([])).toBeNull()
	})

	it('returns null for empty date', () => {
		expect(parseWorkoutScheduleRow(['', 'A'])).toBeNull()
	})

	it('returns null for invalid date format', () => {
		expect(parseWorkoutScheduleRow(['Jan 15 2025', 'A'])).toBeNull()
	})

	it('returns null for row with no workoutId and no calendar fields', () => {
		expect(parseWorkoutScheduleRow(['2025-01-15', ''])).toBeNull()
	})

	it('returns null for null input', () => {
		expect(parseWorkoutScheduleRow(null as unknown as string[])).toBeNull()
	})

	it('parses calendarEventId', () => {
		expect(parseWorkoutScheduleRow(['2025-01-15', 'A', 'evt-123'])).toEqual({
			date: '2025-01-15',
			workoutId: 'A',
			calendarEventId: 'evt-123',
		})
	})

	it('parses strongerId', () => {
		expect(parseWorkoutScheduleRow(['2025-01-15', 'A', '', 's-abc-123'])).toEqual({
			date: '2025-01-15',
			workoutId: 'A',
			strongerId: 's-abc-123',
		})
	})

	it('parses both calendarEventId and strongerId', () => {
		expect(parseWorkoutScheduleRow(['2025-01-15', 'A', 'evt-1', 's-xyz'])).toEqual({
			date: '2025-01-15',
			workoutId: 'A',
			calendarEventId: 'evt-1',
			strongerId: 's-xyz',
		})
	})

	it('keeps row with only calendarEventId (no workoutId)', () => {
		expect(parseWorkoutScheduleRow(['2025-01-15', '', 'orphan-event'])).toEqual({
			date: '2025-01-15',
			workoutId: '',
			calendarEventId: 'orphan-event',
		})
	})

	it('keeps row with only strongerId (no workoutId)', () => {
		expect(parseWorkoutScheduleRow(['2025-01-15', '', '', 's-orphan'])).toEqual({
			date: '2025-01-15',
			workoutId: '',
			strongerId: 's-orphan',
		})
	})
})

/* ------------------------------------------------------------------ */
/*  workoutScheduleEntryToRow                                           */
/* ------------------------------------------------------------------ */

describe('workoutScheduleEntryToRow', () => {
	it('converts a basic entry to a row', () => {
		expect(workoutScheduleEntryToRow({ date: '2025-01-15', workoutId: 'A' })).toEqual([
			'2025-01-15', 'A', '', '',
		])
	})

	it('converts entry with calendarEventId', () => {
		expect(workoutScheduleEntryToRow({
			date: '2025-01-15',
			workoutId: 'A',
			calendarEventId: 'evt-123',
		})).toEqual(['2025-01-15', 'A', 'evt-123', ''])
	})

	it('converts entry with strongerId', () => {
		expect(workoutScheduleEntryToRow({
			date: '2025-01-15',
			workoutId: 'A',
			strongerId: 's-abc-123',
		})).toEqual(['2025-01-15', 'A', '', 's-abc-123'])
	})

	it('converts entry with both calendar fields', () => {
		expect(workoutScheduleEntryToRow({
			date: '2025-01-15',
			workoutId: 'A',
			calendarEventId: 'evt-1',
			strongerId: 's-xyz',
		})).toEqual(['2025-01-15', 'A', 'evt-1', 's-xyz'])
	})

	it('round-trips through parseWorkoutScheduleRow', () => {
		const entries = [
			{ date: '2025-01-15', workoutId: 'A' },
			{ date: '2025-03-01', workoutId: 'B', calendarEventId: 'evt-1' },
			{ date: '2025-12-25', workoutId: 'C', strongerId: 's-test' },
			{ date: '2025-06-15', workoutId: 'D', calendarEventId: 'evt-2', strongerId: 's-abc' },
		]
		for (const entry of entries) {
			const row = workoutScheduleEntryToRow(entry)
			expect(parseWorkoutScheduleRow(row)).toEqual(entry)
		}
	})
})
