import loadPlan from '../../lib/firebase-load-plan.json'
import type { Route } from '../hooks/useHashRouter.ts'

export type FirebaseDataset =
	| 'exercises'
	| 'workouts'
	| 'cardioActivities'
	| 'schedule'
	| 'dayFlags'
	| 'workoutSessions'
	| 'settings'
	| 'garminActivities'
	| 'garminWellness'
	| 'withingsMeasurements'
	| 'mealItems'
	| 'mealLog'
	| 'favoriteFoods'
	| 'recentFoods'

export interface FirebaseLoadQueue {
	priority: FirebaseDataset[]
	deferred: FirebaseDataset[]
}

const datasetOrder = loadPlan.datasetOrder as FirebaseDataset[]
const routes = loadPlan.routes as Record<Route['view'], FirebaseDataset[]>

export function buildFirebaseLoadQueue(view: Route['view']): FirebaseLoadQueue {
	const priority = [...new Set(routes[view] ?? routes.list)]
	const selected = new Set(priority)
	return {
		priority,
		deferred: datasetOrder.filter((dataset) => !selected.has(dataset)),
	}
}

export async function runFirebaseLoadQueue(
	queue: FirebaseLoadQueue,
	load: (dataset: FirebaseDataset) => Promise<void>,
	afterPriority: () => Promise<void> = async () => undefined,
): Promise<void> {
	await Promise.all(queue.priority.map(load))
	await Promise.all([
		afterPriority(),
		...queue.deferred.map(load),
	])
}
