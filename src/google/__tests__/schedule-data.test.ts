import { describe, it, expect } from 'vitest'
import { parseScheduleRow, scheduleEntryToRow } from '../sheets.ts'

/* ------------------------------------------------------------------ */
/*  parseScheduleRow                                                    */
/* ------------------------------------------------------------------ */

describe('parseScheduleRow', () => {
it('parses a valid schedule row', () => {
expect(parseScheduleRow(['2025-01-15', 'A'])).toEqual({
date: '2025-01-15',
workoutId: 'A',
})
})

it('trims whitespace', () => {
expect(parseScheduleRow([' 2025-03-01 ', ' B '])).toEqual({
date: '2025-03-01',
workoutId: 'B',
})
})

it('returns null for empty row', () => {
expect(parseScheduleRow([])).toBeNull()
})

it('returns null for row with only one column and no flags', () => {
expect(parseScheduleRow(['2025-01-15'])).toBeNull()
})

it('returns null for empty date', () => {
expect(parseScheduleRow(['', 'A'])).toBeNull()
})

it('returns null for empty workoutId and no flags', () => {
expect(parseScheduleRow(['2025-01-15', ''])).toBeNull()
})

it('returns null for invalid date format', () => {
expect(parseScheduleRow(['Jan 15 2025', 'A'])).toBeNull()
expect(parseScheduleRow(['2025/01/15', 'A'])).toBeNull()
expect(parseScheduleRow(['15-01-2025', 'A'])).toBeNull()
})

it('returns null for null input', () => {
expect(parseScheduleRow(null as unknown as string[])).toBeNull()
})

it('accepts rows with extra columns (ignores them)', () => {
expect(parseScheduleRow(['2025-01-15', 'A', '', '', '', '', '', 'extra'])).toEqual({
date: '2025-01-15',
workoutId: 'A',
})
})

it('parses flag columns', () => {
expect(parseScheduleRow(['2025-01-15', 'A', 'TRUE', '', 'TRUE', '', '', ''])).toEqual({
date: '2025-01-15',
workoutId: 'A',
flags: { home: true, elsewhere: false, travel: true, visitors: false, alcohol: false, blocked: false },
})
})

it('accepts flag-only rows (no workoutId)', () => {
expect(parseScheduleRow(['2025-01-15', '', 'TRUE', '', '', '', '', ''])).toEqual({
date: '2025-01-15',
workoutId: '',
flags: { home: true, elsewhere: false, travel: false, visitors: false, alcohol: false, blocked: false },
})
})

it('returns null for row with no workoutId and no flags', () => {
expect(parseScheduleRow(['2025-01-15', '', '', '', '', '', '', ''])).toBeNull()
})

it('parses blocked flag', () => {
expect(parseScheduleRow(['2025-01-15', '', '', '', '', '', '', 'TRUE'])).toEqual({
date: '2025-01-15',
workoutId: '',
flags: { home: false, elsewhere: false, travel: false, visitors: false, alcohol: false, blocked: true },
})
})

it('parses alcohol flag', () => {
expect(parseScheduleRow(['2025-01-15', '', '', '', '', '', 'TRUE', ''])).toEqual({
date: '2025-01-15',
workoutId: '',
flags: { home: false, elsewhere: false, travel: false, visitors: false, alcohol: true, blocked: false },
})
})
})

/* ------------------------------------------------------------------ */
/*  scheduleEntryToRow                                                  */
/* ------------------------------------------------------------------ */

describe('scheduleEntryToRow', () => {
it('converts a schedule entry to a spreadsheet row', () => {
expect(scheduleEntryToRow({ date: '2025-01-15', workoutId: 'A' })).toEqual([
'2025-01-15',
'A',
'',
'',
'',
'',
'',
'',
'',
'',
])
})

it('converts a schedule entry with flags', () => {
expect(
scheduleEntryToRow({
date: '2025-01-15',
workoutId: 'A',
flags: { home: true, elsewhere: false, travel: true, visitors: false, alcohol: false, blocked: false },
}),
).toEqual(['2025-01-15', 'A', 'TRUE', '', 'TRUE', '', '', '', '', ''])
})

it('converts a flag-only row', () => {
expect(
scheduleEntryToRow({
date: '2025-01-15',
workoutId: '',
flags: { home: false, elsewhere: true, travel: false, visitors: true, alcohol: false, blocked: false },
}),
).toEqual(['2025-01-15', '', '', 'TRUE', '', 'TRUE', '', '', '', ''])
})

it('converts a blocked flag row', () => {
expect(
scheduleEntryToRow({
date: '2025-01-15',
workoutId: '',
flags: { home: false, elsewhere: false, travel: false, visitors: false, alcohol: false, blocked: true },
}),
).toEqual(['2025-01-15', '', '', '', '', '', '', 'TRUE', '', ''])
})

it('converts an alcohol flag row', () => {
expect(
scheduleEntryToRow({
date: '2025-01-15',
workoutId: '',
flags: { home: false, elsewhere: false, travel: false, visitors: false, alcohol: true, blocked: false },
}),
).toEqual(['2025-01-15', '', '', '', '', '', 'TRUE', '', '', ''])
})

it('round-trips through parseScheduleRow', () => {
const entries = [
{ date: '2025-01-15', workoutId: 'A' },
{ date: '2025-03-01', workoutId: 'B' },
{ date: '2025-12-25', workoutId: 'C' },
]
for (const entry of entries) {
const row = scheduleEntryToRow(entry)
expect(parseScheduleRow(row)).toEqual(entry)
}
})

it('round-trips entries with flags', () => {
const entry = {
date: '2025-01-15',
workoutId: 'A',
flags: { home: true, elsewhere: false, travel: false, visitors: true, alcohol: false, blocked: false },
}
const row = scheduleEntryToRow(entry)
expect(parseScheduleRow(row)).toEqual(entry)
})

it('round-trips blocked flag', () => {
const entry = {
date: '2025-01-15',
workoutId: '',
flags: { home: false, elsewhere: false, travel: false, visitors: false, alcohol: false, blocked: true },
}
const row = scheduleEntryToRow(entry)
expect(parseScheduleRow(row)).toEqual(entry)
})

it('converts a schedule entry with calendarEventId', () => {
expect(
scheduleEntryToRow({
date: '2025-01-15',
workoutId: 'A',
calendarEventId: 'abc123',
}),
).toEqual(['2025-01-15', 'A', '', '', '', '', '', '', 'abc123', ''])
})

it('round-trips entries with calendarEventId', () => {
const entry = {
date: '2025-01-15',
workoutId: 'A',
calendarEventId: 'event-xyz',
}
const row = scheduleEntryToRow(entry)
expect(parseScheduleRow(row)).toEqual(entry)
})

it('converts a schedule entry with strongerId', () => {
expect(
scheduleEntryToRow({
date: '2025-01-15',
workoutId: 'A',
strongerId: 's-abc-123',
}),
).toEqual(['2025-01-15', 'A', '', '', '', '', '', '', '', 's-abc-123'])
})

it('converts a schedule entry with calendarEventId and strongerId', () => {
expect(
scheduleEntryToRow({
date: '2025-01-15',
workoutId: 'A',
calendarEventId: 'evt-1',
strongerId: 's-abc-123',
}),
).toEqual(['2025-01-15', 'A', '', '', '', '', '', '', 'evt-1', 's-abc-123'])
})

it('round-trips entries with strongerId', () => {
const entry = {
date: '2025-01-15',
workoutId: 'A',
strongerId: 's-test-xyz',
}
const row = scheduleEntryToRow(entry)
expect(parseScheduleRow(row)).toEqual(entry)
})

it('round-trips entries with calendarEventId and strongerId', () => {
const entry = {
date: '2025-01-15',
workoutId: 'A',
calendarEventId: 'evt-1',
strongerId: 's-test-xyz',
}
const row = scheduleEntryToRow(entry)
expect(parseScheduleRow(row)).toEqual(entry)
})
})

/* ------------------------------------------------------------------ */
/*  parseScheduleRow – calendarEventId                                  */
/* ------------------------------------------------------------------ */

describe('parseScheduleRow – calendarEventId', () => {
it('parses calendarEventId from column 8', () => {
expect(parseScheduleRow(['2025-01-15', 'A', '', '', '', '', '', '', 'evt-id'])).toEqual({
date: '2025-01-15',
workoutId: 'A',
calendarEventId: 'evt-id',
})
})

it('omits calendarEventId when column 8 is empty', () => {
expect(parseScheduleRow(['2025-01-15', 'A', '', '', '', '', '', '', ''])).toEqual({
date: '2025-01-15',
workoutId: 'A',
})
})

it('omits calendarEventId when column 8 is missing', () => {
expect(parseScheduleRow(['2025-01-15', 'A'])).toEqual({
date: '2025-01-15',
workoutId: 'A',
})
})

it('parses calendarEventId alongside flags', () => {
expect(parseScheduleRow(['2025-01-15', 'A', 'TRUE', '', '', '', '', '', 'cal-event'])).toEqual({
date: '2025-01-15',
workoutId: 'A',
flags: { home: true, elsewhere: false, travel: false, visitors: false, alcohol: false, blocked: false },
calendarEventId: 'cal-event',
})
})

it('keeps row with only calendarEventId (no workoutId, no flags)', () => {
expect(parseScheduleRow(['2025-01-15', '', '', '', '', '', '', '', 'orphan-event'])).toEqual({
date: '2025-01-15',
workoutId: '',
calendarEventId: 'orphan-event',
})
})
})

/* ------------------------------------------------------------------ */
/*  parseScheduleRow – strongerId                                       */
/* ------------------------------------------------------------------ */

describe('parseScheduleRow – strongerId', () => {
it('parses strongerId from column 9', () => {
expect(parseScheduleRow(['2025-01-15', 'A', '', '', '', '', '', '', '', 's-abc-123'])).toEqual({
date: '2025-01-15',
workoutId: 'A',
strongerId: 's-abc-123',
})
})

it('omits strongerId when column 9 is empty', () => {
expect(parseScheduleRow(['2025-01-15', 'A', '', '', '', '', '', '', '', ''])).toEqual({
date: '2025-01-15',
workoutId: 'A',
})
})

it('parses both calendarEventId and strongerId', () => {
expect(parseScheduleRow(['2025-01-15', 'A', '', '', '', '', '', '', 'evt-1', 's-xyz'])).toEqual({
date: '2025-01-15',
workoutId: 'A',
calendarEventId: 'evt-1',
strongerId: 's-xyz',
})
})

it('keeps row with only strongerId (no workoutId, no flags, no calendarEventId)', () => {
expect(parseScheduleRow(['2025-01-15', '', '', '', '', '', '', '', '', 's-orphan'])).toEqual({
date: '2025-01-15',
workoutId: '',
strongerId: 's-orphan',
})
})

it('parses strongerId alongside flags and calendarEventId', () => {
expect(parseScheduleRow(['2025-01-15', 'A', 'TRUE', '', '', '', '', '', 'evt-1', 's-xyz'])).toEqual({
date: '2025-01-15',
workoutId: 'A',
flags: { home: true, elsewhere: false, travel: false, visitors: false, alcohol: false, blocked: false },
calendarEventId: 'evt-1',
strongerId: 's-xyz',
})
})
})
