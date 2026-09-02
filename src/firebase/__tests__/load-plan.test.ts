import { describe, expect, it } from 'vitest'
import {
	DATE_WINDOW_INCREMENT_DAYS,
	INITIAL_DATE_WINDOW_DAYS,
	addDateDays,
	buildFirebaseLoadQueue,
	initialDateWindow,
	runFirebaseLoadQueue,
} from '../load-plan.ts'

describe('Firebase route load plan', () => {
	it('loads Garmin activities before every unrelated dataset', () => {
		const queue = buildFirebaseLoadQueue('garmin-activities')

		expect(queue.priority).toEqual([
			{ dataset: 'garminActivities', scope: 'currentYear' },
			{ dataset: 'settings', scope: 'all' },
		])
		expect(queue.deferred[0]).toEqual({ dataset: 'garminActivities', scope: 'otherYears' })
		expect(queue.deferred).not.toContainEqual({ dataset: 'garminActivities', scope: 'all' })
		expect(queue.deferred).not.toContainEqual({ dataset: 'settings', scope: 'all' })
	})

	it('loads all calendar requirements before background data', () => {
		const queue = buildFirebaseLoadQueue('calendar')

		expect(queue.priority).toEqual([
			{ dataset: 'schedule', scope: 'initialWindow' },
			{ dataset: 'dayFlags', scope: 'initialWindow' },
			{ dataset: 'workoutSessions', scope: 'currentYear' },
			{ dataset: 'exercises', scope: 'all' },
			{ dataset: 'workouts', scope: 'all' },
			{ dataset: 'cardioActivities', scope: 'all' },
			{ dataset: 'settings', scope: 'all' },
		])
		expect(queue.deferred[0]).toEqual({ dataset: 'workoutSessions', scope: 'otherYears' })
		expect(new Set([...queue.priority, ...queue.deferred].map(({ dataset }) => dataset)).size).toBe(14)
	})

	it('loads workout history for home-screen completion state', () => {
		expect(buildFirebaseLoadQueue('list').priority)
			.toContainEqual({ dataset: 'workoutSessions', scope: 'currentYear' })
		expect(buildFirebaseLoadQueue('list').priority)
			.toContainEqual({ dataset: 'schedule', scope: 'initialWindow' })
	})

	it('uses a 60-day initial window and 30-day increments', () => {
		expect(INITIAL_DATE_WINDOW_DAYS).toBe(60)
		expect(DATE_WINDOW_INCREMENT_DAYS).toBe(30)
		expect(initialDateWindow('2026-09-02')).toEqual({
			startDate: '2026-09-02',
			endDate: '2026-11-01',
		})
		expect(addDateDays('2026-12-15', DATE_WINDOW_INCREMENT_DAYS)).toBe('2027-01-14')
	})

	it('defers every background load until the priority batch completes', async () => {
		const queue = buildFirebaseLoadQueue('garmin-activities')
		const calls: string[] = []
		let releasePriority: () => void = () => undefined
		const priorityPending = new Promise<void>((resolve) => {
			releasePriority = resolve
		})
		const running = runFirebaseLoadQueue(
			queue,
			async ({ dataset, scope }, phase) => {
				calls.push(`${phase}:${dataset}:${scope}`)
				if (dataset === 'garminActivities' && scope === 'currentYear') await priorityPending
			},
			async () => {
				calls.push('afterPriority')
			},
		)

		await Promise.resolve()
		expect(calls).toEqual([
			'priority:garminActivities:currentYear',
			'priority:settings:all',
		])
		releasePriority()
		await running
		expect(calls.indexOf('afterPriority')).toBeGreaterThan(calls.indexOf('priority:settings:all'))
		expect(calls.indexOf('deferred:garminActivities:otherYears'))
			.toBeGreaterThan(calls.indexOf('priority:settings:all'))
		expect(calls.indexOf('deferred:exercises:all'))
			.toBeGreaterThan(calls.indexOf('priority:settings:all'))
	})
})
