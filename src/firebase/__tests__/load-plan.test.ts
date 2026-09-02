import { describe, expect, it } from 'vitest'
import { buildFirebaseLoadQueue, runFirebaseLoadQueue } from '../load-plan.ts'

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
			{ dataset: 'schedule', scope: 'all' },
			{ dataset: 'dayFlags', scope: 'all' },
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
			async ({ dataset, scope }) => {
				calls.push(`${dataset}:${scope}`)
				if (dataset === 'garminActivities' && scope === 'currentYear') await priorityPending
			},
			async () => {
				calls.push('afterPriority')
			},
		)

		await Promise.resolve()
		expect(calls).toEqual(['garminActivities:currentYear', 'settings:all'])
		releasePriority()
		await running
		expect(calls.indexOf('afterPriority')).toBeGreaterThan(calls.indexOf('settings:all'))
		expect(calls.indexOf('garminActivities:otherYears')).toBeGreaterThan(calls.indexOf('settings:all'))
		expect(calls.indexOf('exercises:all')).toBeGreaterThan(calls.indexOf('settings:all'))
	})
})
