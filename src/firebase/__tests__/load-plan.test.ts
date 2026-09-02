import { describe, expect, it } from 'vitest'
import { buildFirebaseLoadQueue, runFirebaseLoadQueue } from '../load-plan.ts'

describe('Firebase route load plan', () => {
	it('loads Garmin activities before every unrelated dataset', () => {
		const queue = buildFirebaseLoadQueue('garmin-activities')

		expect(queue.priority[0]).toBe('garminActivities')
		expect(queue.priority).toEqual(['garminActivities', 'settings'])
		expect(queue.deferred).not.toContain('garminActivities')
		expect(queue.deferred).not.toContain('settings')
	})

	it('loads all calendar requirements before background data', () => {
		const queue = buildFirebaseLoadQueue('calendar')

		expect(queue.priority).toEqual([
			'schedule',
			'dayFlags',
			'workoutSessions',
			'exercises',
			'workouts',
			'cardioActivities',
			'settings',
		])
		expect(new Set([...queue.priority, ...queue.deferred]).size).toBe(14)
	})

	it('loads workout history for home-screen completion state', () => {
		expect(buildFirebaseLoadQueue('list').priority).toContain('workoutSessions')
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
			async (dataset) => {
				calls.push(dataset)
				if (dataset === 'garminActivities') await priorityPending
			},
			async () => {
				calls.push('afterPriority')
			},
		)

		await Promise.resolve()
		expect(calls).toEqual(['garminActivities', 'settings'])
		releasePriority()
		await running
		expect(calls.indexOf('afterPriority')).toBeGreaterThan(calls.indexOf('settings'))
		expect(calls.indexOf('exercises')).toBeGreaterThan(calls.indexOf('settings'))
	})
})
