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

export type FirebaseLoadScope = 'all' | 'currentYear' | 'otherYears' | 'initialWindow'

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
const dateWindowDatasets = new Set(loadPlan.dateWindowDatasets as FirebaseDataset[])
const routes = loadPlan.routes as Record<Route['view'], FirebaseDataset[]>
export const INITIAL_DATE_WINDOW_DAYS = loadPlan.initialDateWindowDays
export const DATE_WINDOW_INCREMENT_DAYS = loadPlan.dateWindowIncrementDays

function localDateString(value: Date): string {
	return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

export function addDateDays(date: string, count: number): string {
	const [year, month, day] = date.split('-').map(Number)
	return localDateString(new Date(year, month - 1, day + count))
}

export function initialDateWindow(startDate = localDateString(new Date())) {
	return {
		startDate,
		endDate: addDateDays(startDate, INITIAL_DATE_WINDOW_DAYS),
	}
}

function request(dataset: FirebaseDataset, scope: FirebaseLoadScope = 'all'): FirebaseLoadRequest {
	return { dataset, scope }
}

export function buildFirebaseLoadQueue(view: Route['view']): FirebaseLoadQueue {
	const routeDatasets = [...new Set(routes[view] ?? routes.list)]
	const selected = new Set(routeDatasets)
	const scopeForColdLoad = (dataset: FirebaseDataset): FirebaseLoadScope => {
		if (yearBucketDatasets.has(dataset)) return 'currentYear'
		if (dateWindowDatasets.has(dataset)) return 'initialWindow'
		return 'all'
	}
	const priority = routeDatasets.map((dataset) => request(dataset, scopeForColdLoad(dataset)))
	const otherYears = routeDatasets
		.filter((dataset) => yearBucketDatasets.has(dataset))
		.map((dataset) => request(dataset, 'otherYears'))
	return {
		priority,
		deferred: [
			...otherYears,
			...datasetOrder
				.filter((dataset) => !selected.has(dataset))
				.map((dataset) => request(dataset, scopeForColdLoad(dataset))),
		],
	}
}

export async function runFirebaseLoadQueue(
	queue: FirebaseLoadQueue,
	load: (request: FirebaseLoadRequest, phase: 'priority' | 'deferred') => Promise<void>,
	afterPriority: () => Promise<void> = async () => undefined,
): Promise<void> {
	await Promise.all(queue.priority.map((request) => load(request, 'priority')))
	await Promise.all([
		afterPriority(),
		...queue.deferred.map((request) => load(request, 'deferred')),
	])
}
