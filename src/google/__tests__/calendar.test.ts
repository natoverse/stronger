import { describe, it, expect, afterEach, vi } from 'vitest'
import { generateEventDates, buildDeepLink, getEventDate, generateStrongerId, embedStrongerId, extractStrongerId, syncScheduleWithCalendar, STRONGER_ID_PREFIX, STRONGER_ID_SUFFIX } from '../calendar.ts'
import type { WorkoutScheduleEntry } from '../../model/types.ts'

describe('generateEventDates', () => {
	it('generates one date per week for Monday (dayIndex 0)', () => {
		const dates = generateEventDates('2026-04-06', 0, 3)
		expect(dates).toEqual(['2026-04-06', '2026-04-13', '2026-04-20'])
	})

	it('generates dates for Wednesday (dayIndex 2)', () => {
		const dates = generateEventDates('2026-04-06', 2, 2)
		expect(dates).toEqual(['2026-04-08', '2026-04-15'])
	})

	it('generates dates for Sunday (dayIndex 6)', () => {
		const dates = generateEventDates('2026-04-06', 6, 2)
		expect(dates).toEqual(['2026-04-12', '2026-04-19'])
	})

	it('handles a single week', () => {
		const dates = generateEventDates('2026-04-06', 4, 1)
		expect(dates).toEqual(['2026-04-10'])
	})

	it('returns empty array for zero weeks', () => {
		const dates = generateEventDates('2026-04-06', 0, 0)
		expect(dates).toEqual([])
	})

	it('rolls over month boundaries', () => {
		const dates = generateEventDates('2026-04-27', 0, 2)
		expect(dates).toEqual(['2026-04-27', '2026-05-04'])
	})

	it('rolls over year boundaries', () => {
		const dates = generateEventDates('2026-12-28', 0, 2)
		expect(dates).toEqual(['2026-12-28', '2027-01-04'])
	})
})

describe('buildDeepLink', () => {
	const base = 'https://example.github.io/stronger/'

	it('builds a workout deep link', () => {
		const link = buildDeepLink('squat-a', base)
		expect(link).toBe('https://example.github.io/stronger/#/workout/squat-a')
	})

	it('encodes special characters in workout IDs', () => {
		const link = buildDeepLink('bench press/heavy', base)
		expect(link).toBe('https://example.github.io/stronger/#/workout/bench%20press%2Fheavy')
	})
})

describe('getEventDate', () => {
	it('extracts date from all-day event', () => {
		expect(getEventDate({ start: { date: '2026-04-10' } })).toBe('2026-04-10')
	})

	it('extracts date from timed event', () => {
		expect(getEventDate({ start: { dateTime: '2026-04-10T14:00:00Z' } })).toBe('2026-04-10')
	})

	it('prefers date over dateTime', () => {
		expect(getEventDate({ start: { date: '2026-04-10', dateTime: '2026-04-11T09:00:00Z' } })).toBe('2026-04-10')
	})

	it('returns undefined when start is missing', () => {
		expect(getEventDate({})).toBeUndefined()
	})

	it('returns undefined when start has no date fields', () => {
		expect(getEventDate({ start: {} })).toBeUndefined()
	})
})

describe('generateStrongerId', () => {
	it('returns a string starting with s-', () => {
		const id = generateStrongerId()
		expect(id).toMatch(/^s-[a-z0-9]+-[a-z0-9]+$/)
	})

	it('generates unique IDs on successive calls', () => {
		const ids = new Set(Array.from({ length: 100 }, () => generateStrongerId()))
		expect(ids.size).toBe(100)
	})
})

describe('embedStrongerId', () => {
	it('appends the stronger ID tag to a description', () => {
		const result = embedStrongerId('Open workout: https://example.com', 's-abc-123')
		expect(result).toBe(`Open workout: https://example.com\n${STRONGER_ID_PREFIX}s-abc-123${STRONGER_ID_SUFFIX}`)
	})

	it('works with empty descriptions', () => {
		const result = embedStrongerId('', 's-xyz')
		expect(result).toBe(`\n${STRONGER_ID_PREFIX}s-xyz${STRONGER_ID_SUFFIX}`)
	})
})

describe('extractStrongerId', () => {
	it('extracts the stronger ID from a description', () => {
		const desc = `Open workout: https://example.com\n${STRONGER_ID_PREFIX}s-abc-123${STRONGER_ID_SUFFIX}`
		expect(extractStrongerId(desc)).toBe('s-abc-123')
	})

	it('returns undefined for descriptions without a stronger ID', () => {
		expect(extractStrongerId('Just a normal description')).toBeUndefined()
	})

	it('returns undefined for undefined input', () => {
		expect(extractStrongerId(undefined)).toBeUndefined()
	})

	it('returns undefined for empty string', () => {
		expect(extractStrongerId('')).toBeUndefined()
	})

	it('round-trips with embedStrongerId', () => {
		const original = 's-test-id-42'
		const desc = embedStrongerId('My workout', original)
		expect(extractStrongerId(desc)).toBe(original)
	})

	it('handles descriptions with multiple lines before the tag', () => {
		const desc = `Line 1\nLine 2\n${STRONGER_ID_PREFIX}s-multi${STRONGER_ID_SUFFIX}`
		expect(extractStrongerId(desc)).toBe('s-multi')
	})
})


describe('syncScheduleWithCalendar - custom labels', () => {
	const resolveWorkoutName = (workoutId: string) => (workoutId === 'cardio:hike' ? 'Cardio' : null)

	afterEach(() => {
		delete (globalThis as { window?: unknown }).window
	})

	function mockGapi(events: {
		insert?: ReturnType<typeof vi.fn>
		list?: ReturnType<typeof vi.fn>
		update?: ReturnType<typeof vi.fn>
		delete?: ReturnType<typeof vi.fn>
	}) {
		;(globalThis as { window?: unknown }).window = {
			gapi: {
				client: {
					calendar: {
						events: {
							insert: events.insert ?? vi.fn(),
							list: events.list ?? vi.fn().mockResolvedValue({ result: { items: [] } }),
							update: events.update ?? vi.fn(),
							delete: events.delete ?? vi.fn(),
						},
					},
				},
			},
		}
	}

	it('uses the custom label as the title when creating a new event', async () => {
		const insert = vi.fn().mockResolvedValue({ result: { id: 'evt-1' } })
		mockGapi({ insert })

		const schedule: WorkoutScheduleEntry[] = [
			{ date: '2026-05-01', workoutId: 'cardio:hike', label: "Angel's Rest Trail" },
		]

		const { result } = await syncScheduleWithCalendar('primary', schedule, resolveWorkoutName)

		expect(insert).toHaveBeenCalledTimes(1)
		expect(insert.mock.calls[0][0].resource.summary).toBe("Angel's Rest Trail")
		expect(result.created).toBe(1)
	})

	it('updates the calendar event title when a label is edited after sync', async () => {
		const update = vi.fn().mockResolvedValue({})
		const list = vi.fn().mockResolvedValue({
			result: {
				items: [
					{
						id: 'evt-1',
						summary: 'Cardio',
						description: `Cardio\n${STRONGER_ID_PREFIX}s-1${STRONGER_ID_SUFFIX}`,
						start: { date: '2026-05-01' },
						end: { date: '2026-05-01' },
					},
				],
			},
		})
		mockGapi({ update, list })

		const schedule: WorkoutScheduleEntry[] = [
			{
				date: '2026-05-01',
				workoutId: 'cardio:hike',
				label: "Angel's Rest Trail",
				calendarEventId: 'evt-1',
				strongerId: 's-1',
			},
		]

		const { result } = await syncScheduleWithCalendar('primary', schedule, resolveWorkoutName)

		expect(update).toHaveBeenCalledTimes(1)
		expect(update.mock.calls[0][0].resource.summary).toBe("Angel's Rest Trail")
		expect(result.updated).toBe(1)
	})

	it('does not update the event title when the label is unchanged', async () => {
		const update = vi.fn().mockResolvedValue({})
		const list = vi.fn().mockResolvedValue({
			result: {
				items: [
					{
						id: 'evt-1',
						summary: "Angel's Rest Trail",
						description: `Angel's Rest Trail\n${STRONGER_ID_PREFIX}s-1${STRONGER_ID_SUFFIX}`,
						start: { date: '2026-05-01' },
						end: { date: '2026-05-01' },
					},
				],
			},
		})
		mockGapi({ update, list })

		const schedule: WorkoutScheduleEntry[] = [
			{
				date: '2026-05-01',
				workoutId: 'cardio:hike',
				label: "Angel's Rest Trail",
				calendarEventId: 'evt-1',
				strongerId: 's-1',
			},
		]

		const { result } = await syncScheduleWithCalendar('primary', schedule, resolveWorkoutName)

		expect(update).not.toHaveBeenCalled()
		expect(result.updated).toBe(0)
	})
})
