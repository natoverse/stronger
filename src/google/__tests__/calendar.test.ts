import { describe, it, expect, afterEach, vi } from 'vitest'
import { generateEventDates, buildDeepLink, getEventDate, generateStrongerId, embedStrongerId, extractStrongerId, extractWorkoutId, syncScheduleWithCalendar, STRONGER_ID_PREFIX, STRONGER_ID_SUFFIX } from '../calendar.ts'
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

describe('extractWorkoutId', () => {
	it('extracts and decodes workout IDs from Stronger deep links', () => {
		expect(extractWorkoutId('Open workout: https://example.com/#/workout/bench%20press'))
			.toBe('bench press')
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

	it('rethrows expired authorization so the UI can reconnect', async () => {
		const authError = { status: 401, message: 'Invalid Credentials' }
		const list = vi.fn().mockRejectedValue(authError)
		mockGapi({ list })

		const schedule: WorkoutScheduleEntry[] = [
			{ date: '2026-05-01', workoutId: 'cardio:hike' },
		]

		await expect(syncScheduleWithCalendar('primary', schedule, resolveWorkoutName))
			.rejects.toBe(authError)
	})

	it('does not delete linked schedule entries when the selected calendar is unverified', async () => {
		mockGapi({
			list: vi.fn().mockResolvedValue({ result: { items: [] } }),
		})
		const schedule: WorkoutScheduleEntry[] = [{
			date: '2026-09-03',
			workoutId: 'cardio:hike',
			calendarEventId: 'secondary-event',
			strongerId: 's-secondary',
		}]

		const { updatedSchedule, result, calendarVerified } = await syncScheduleWithCalendar(
			'primary',
			schedule,
			resolveWorkoutName,
			undefined,
			{ requireLinkedMatch: true, referenceDate: '2026-09-03' },
		)

		expect(calendarVerified).toBe(false)
		expect(updatedSchedule).toEqual(schedule)
		expect(result.pulledDeletions).toBe(0)
		expect(result.errors[0]).toContain('does not contain the events')
	})

	it('preserves unmatched entries during the first verified sync', async () => {
		const list = vi.fn().mockResolvedValue({
			result: {
				items: [{
					id: 'matched-event',
					summary: 'Cardio',
					description: `Cardio\n${STRONGER_ID_PREFIX}s-matched${STRONGER_ID_SUFFIX}`,
					start: { date: '2026-09-03' },
					end: { date: '2026-09-03' },
				}],
			},
		})
		mockGapi({ list })
		const schedule: WorkoutScheduleEntry[] = [
			{
				date: '2026-09-03',
				workoutId: 'cardio:hike',
				calendarEventId: 'matched-event',
				strongerId: 's-matched',
			},
			{
				date: '2026-09-04',
				workoutId: 'cardio:hike',
				calendarEventId: 'missing-event',
				strongerId: 's-missing',
			},
		]

		const { updatedSchedule, result, calendarVerified } = await syncScheduleWithCalendar(
			'secondary',
			schedule,
			resolveWorkoutName,
			undefined,
			{
				requireLinkedMatch: true,
				allowRemoteDeletions: false,
				referenceDate: '2026-09-03',
			},
		)

		expect(calendarVerified).toBe(true)
		expect(updatedSchedule).toHaveLength(2)
		expect(result.pulledDeletions).toBe(0)
	})

	it('recovers Stronger-tagged events when the Firebase schedule is empty', async () => {
		const taggedEvent = {
			id: 'training-event',
			summary: 'Custom workout label',
			description: `Open workout: https://example.com/#/workout/squat-a\n${STRONGER_ID_PREFIX}s-training${STRONGER_ID_SUFFIX}`,
			start: { date: '2026-09-05' },
			end: { date: '2026-09-05' },
		}
		const list = vi.fn().mockImplementation((params: { q?: string; pageToken?: string }) => {
			if (!params.q) return Promise.resolve({ result: { items: [] } })
			if (!params.pageToken) {
				return Promise.resolve({ result: { items: [], nextPageToken: 'page-2' } })
			}
			return Promise.resolve({ result: { items: [taggedEvent] } })
		})
		const update = vi.fn()
		mockGapi({ list, update })

		const { updatedSchedule, result, calendarVerified } = await syncScheduleWithCalendar(
			'secondary',
			[],
			(workoutId) => workoutId === 'squat-a' ? 'Squat' : null,
			() => null,
			{ referenceDate: '2026-09-03' },
		)

		expect(calendarVerified).toBe(true)
		expect(updatedSchedule).toEqual([{
			date: '2026-09-05',
			workoutId: 'squat-a',
			calendarEventId: 'training-event',
			strongerId: 's-training',
			label: 'Custom workout label',
		}])
		expect(result.pulledCreations).toBe(1)
		expect(update).not.toHaveBeenCalled()
	})

	it('recovers custom-labeled cardio from the canonical description name', async () => {
		const list = vi.fn().mockResolvedValue({
			result: {
				items: [{
					id: 'hike-event',
					summary: "Angel's Rest Trail",
					description: `Cardio\n${STRONGER_ID_PREFIX}s-hike${STRONGER_ID_SUFFIX}`,
					start: { date: '2026-09-06' },
					end: { date: '2026-09-06' },
				}],
			},
		})
		mockGapi({ list })

		const { updatedSchedule } = await syncScheduleWithCalendar(
			'secondary',
			[],
			resolveWorkoutName,
			(name) => name === 'Cardio' ? 'cardio:hike' : null,
			{ referenceDate: '2026-09-03' },
		)

		expect(updatedSchedule).toEqual([{
			date: '2026-09-06',
			workoutId: 'cardio:hike',
			calendarEventId: 'hike-event',
			strongerId: 's-hike',
			label: "Angel's Rest Trail",
		}])
	})

	it('retains blanked linkage when calendar deletion fails', async () => {
		const event = {
			id: 'event-to-delete',
			summary: 'Cardio',
			description: `Cardio\n${STRONGER_ID_PREFIX}s-delete${STRONGER_ID_SUFFIX}`,
			start: { date: '2026-09-06' },
			end: { date: '2026-09-06' },
		}
		const list = vi.fn().mockResolvedValue({ result: { items: [event] } })
		const deleteEvent = vi.fn().mockRejectedValue(new Error('rate limited'))
		mockGapi({ list, delete: deleteEvent })
		const schedule: WorkoutScheduleEntry[] = [{
			date: '2026-09-06',
			workoutId: '',
			calendarEventId: 'event-to-delete',
			strongerId: 's-delete',
		}]

		const { updatedSchedule, result } = await syncScheduleWithCalendar(
			'secondary',
			schedule,
			resolveWorkoutName,
			(name) => name === 'Cardio' ? 'cardio:hike' : null,
			{ referenceDate: '2026-09-03' },
		)

		expect(updatedSchedule).toEqual(schedule)
		expect(result.errors[0]).toContain('rate limited')
		expect(result.pulledCreations).toBe(0)
	})

	it('rejects an unverified calendar when only blanked entries have links', async () => {
		mockGapi({
			list: vi.fn().mockResolvedValue({ result: { items: [] } }),
		})
		const schedule: WorkoutScheduleEntry[] = [{
			date: '2026-09-06',
			workoutId: '',
			calendarEventId: 'event-on-another-calendar',
			strongerId: 's-blanked',
		}]

		const { updatedSchedule, result, calendarVerified } = await syncScheduleWithCalendar(
			'wrong-calendar',
			schedule,
			resolveWorkoutName,
			undefined,
			{ requireLinkedMatch: true, referenceDate: '2026-09-03' },
		)

		expect(calendarVerified).toBe(false)
		expect(updatedSchedule).toEqual(schedule)
		expect(result.errors[0]).toContain('does not contain the events')
	})

	it('does not pull untagged title matches returned outside the reconciliation window', async () => {
		const list = vi.fn().mockImplementation((params: { q?: string }) => (
			params.q
				? Promise.resolve({
					result: {
						items: [{
							id: 'unrelated-rest',
							summary: 'Rest',
							start: { date: '2027-09-03' },
							end: { date: '2027-09-03' },
						}],
					},
				})
				: Promise.resolve({ result: { items: [] } })
		))
		mockGapi({ list })

		const { updatedSchedule } = await syncScheduleWithCalendar(
			'secondary',
			[],
			() => 'Rest',
			(name) => name === 'Rest' ? '__rest__' : null,
			{ referenceDate: '2026-09-03' },
		)

		expect(updatedSchedule).toEqual([])
	})
})
