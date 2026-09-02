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

export type FirebaseLoadScope = 'all' | 'currentYear' | 'otherYears'

export interface FirebaseLoadRequest {
	dataset: FirebaseDataset
	scope: FirebaseLoadScope
}

export interface FirebaseLoadQueue {
	priority: FirebaseLoadRequest[]
	deferred: FirebaseLoadRequest[]
}

const datasetOrder = loadPlan.datasetOrder as FirebaseDataset[]
const yearBucketDatasets = new Set(loadPlan.yearBucketDatasets as FirebaseDataset[])
const routes = loadPlan.routes as Record<Route['view'], FirebaseDataset[]>

function request(dataset: FirebaseDataset, scope: FirebaseLoadScope = 'all'): FirebaseLoadRequest {
	return { dataset, scope }
}

export function buildFirebaseLoadQueue(view: Route['view']): FirebaseLoadQueue {
	const routeDatasets = [...new Set(routes[view] ?? routes.list)]
	const selected = new Set(routeDatasets)
	const priority = routeDatasets.map((dataset) =>
		request(dataset, yearBucketDatasets.has(dataset) ? 'currentYear' : 'all'))
	const otherYears = routeDatasets
		.filter((dataset) => yearBucketDatasets.has(dataset))
		.map((dataset) => request(dataset, 'otherYears'))
	return {
		priority,
		deferred: [
			...otherYears,
			...datasetOrder
				.filter((dataset) => !selected.has(dataset))
				.map((dataset) => request(dataset)),
		],
	}
}

export async function runFirebaseLoadQueue(
	queue: FirebaseLoadQueue,
	load: (request: FirebaseLoadRequest) => Promise<void>,
	afterPriority: () => Promise<void> = async () => undefined,
): Promise<void> {
	await Promise.all(queue.priority.map(load))
	await Promise.all([
		afterPriority(),
		...queue.deferred.map(load),
	])
}
