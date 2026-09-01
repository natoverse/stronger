import {
	collection,
	deleteDoc,
	doc,
	getDocs,
	getDoc,
	setDoc,
	writeBatch,
	type DocumentData,
	type QueryDocumentSnapshot,
} from 'firebase/firestore'
import type {
	CardioActivity,
	DayFlagEntry,
	FoodItem,
	GarminWellnessEntry,
	LiftConfig,
	MealCategory,
	MealItem,
	MealLogEntry,
	WithingsMeasurement,
	WorkoutScheduleEntry,
} from '../model/index.ts'
import type { StravaActivity } from '../model/types.ts'
import type { WorkoutDefinition } from '../data/sample-workouts.ts'
import type { ParsedLogRow } from '../google/sheets.ts'
import { firestore } from './client.ts'

export const SCHEMA_VERSION = 1

type StoredLogRow = ParsedLogRow & {
	_migrationSourceRow?: number
	_documentSequence?: number
}

type StoredRecentFood = FoodItem & {
	_recentOrder?: number
}

type CollectionName =
	| 'exercises'
	| 'workouts'
	| 'workoutSessions'
	| 'dayFlags'
	| 'schedule'
	| 'cardioActivities'
	| 'mealItems'
	| 'mealLog'
	| 'favoriteFoods'
	| 'recentFoods'
	| 'garminActivities'
	| 'garminWellness'
	| 'withingsMeasurements'

function userDoc(uid: string) {
	return doc(firestore, 'users', uid)
}

function userCollection(uid: string, name: CollectionName) {
	return collection(userDoc(uid), name)
}

function clean<T>(snapshot: QueryDocumentSnapshot<DocumentData>): T {
	const value = snapshot.data()
	delete value.createdAt
	delete value.updatedAt
	return value as T
}

function idPart(value: string): string {
	return encodeURIComponent(value).split('.').join('%2E')
}

async function readCollection<T>(uid: string, name: CollectionName): Promise<T[]> {
	const snapshot = await getDocs(userCollection(uid, name))
	return snapshot.docs.map((item) => clean<T>(item))
}

async function replaceCollection<T>(
	uid: string,
	name: CollectionName,
	values: T[],
	getId: (value: T, index: number) => string,
): Promise<void> {
	const existing = await getDocs(userCollection(uid, name))
	const desired = new Set(values.map(getId))
	const operations: Array<(batch: ReturnType<typeof writeBatch>) => void> = []

	for (const existingDoc of existing.docs) {
		if (!desired.has(existingDoc.id)) operations.push((batch) => batch.delete(existingDoc.ref))
	}
	values.forEach((value, index) => {
		const ref = doc(userCollection(uid, name), getId(value, index))
		operations.push((batch) => batch.set(ref, { ...value as object, updatedAt: new Date().toISOString() }))
	})

	for (let start = 0; start < operations.length; start += 400) {
		const batch = writeBatch(firestore)
		for (const operation of operations.slice(start, start + 400)) operation(batch)
		await batch.commit()
	}
}

export async function ensureUser(uid: string): Promise<void> {
	const ref = userDoc(uid)
	const snapshot = await getDoc(ref)
	const now = new Date().toISOString()
	await setDoc(ref, {
		schemaVersion: SCHEMA_VERSION,
		updatedAt: now,
		...(snapshot.exists() ? {} : { createdAt: now }),
	}, { merge: true })
}

export function readConfigZone(uid: string): Promise<LiftConfig[] | null> {
	return readCollection<LiftConfig>(uid, 'exercises').then((items) => items.length ? items : null)
}

export function writeDefaultConfig(uid: string, configs: LiftConfig[]): Promise<void> {
	return replaceCollection(uid, 'exercises', configs, (item) => idPart(item.id))
}

export function writeConfigValues(uid: string, configs: LiftConfig[]): Promise<void> {
	return writeDefaultConfig(uid, configs)
}

export function readWorkoutDefs(uid: string, _liftNames?: Map<string, string>): Promise<WorkoutDefinition[] | null> {
	return readCollection<WorkoutDefinition>(uid, 'workouts').then((items) => items.length ? items : null)
}

export function writeWorkoutDefs(uid: string, definitions: WorkoutDefinition[]): Promise<void> {
	return replaceCollection(uid, 'workouts', definitions, (item) => idPart(item.id))
}

export const writeDefaultWorkoutDefs = writeWorkoutDefs

export function readCardioActivities(uid: string): Promise<CardioActivity[] | null> {
	return readCollection<CardioActivity>(uid, 'cardioActivities').then((items) => items.length ? items : null)
}

export function writeCardioActivities(uid: string, activities: CardioActivity[]): Promise<void> {
	return replaceCollection(uid, 'cardioActivities', activities, (item) => idPart(item.id))
}

export const writeDefaultCardioActivities = writeCardioActivities

export function logDocumentId(row: StoredLogRow): string {
	return [
		idPart(row.startTime),
		idPart(row.liftId || row.exerciseName),
		idPart(row.exerciseName),
		row.setNumber,
		...(row._migrationSourceRow == null ? [] : [`row-${row._migrationSourceRow}`]),
		...(row._documentSequence == null ? [] : [`sequence-${row._documentSequence}`]),
	].join('_')
}

export async function appendLogRows(uid: string, rows: (string | number | boolean)[][]): Promise<void> {
	const parsed: StoredLogRow[] = rows
		.flatMap((row, index) => {
			const value = rowToParsedLogRow(row)
			return value ? [{ ...value, _documentSequence: index }] : []
		})
	for (let start = 0; start < parsed.length; start += 400) {
		const batch = writeBatch(firestore)
		for (const row of parsed.slice(start, start + 400)) {
			batch.set(doc(userCollection(uid, 'workoutSessions'), logDocumentId(row)), {
				...row,
				updatedAt: new Date().toISOString(),
			})
		}

		await batch.commit()
	}
}

export function rowToParsedLogRow(row: (string | number | boolean)[]): ParsedLogRow | null {
	if (row.length < 13) return null
	const strings = row.map(String)
	const setNumber = Number(strings[6])
	const plannedWeight = Number(strings[8])
	const plannedReps = Number(strings[9])
	const actualWeight = Number(strings[10])
	const actualReps = Number(strings[11])
	if (!strings[0] || !strings[1] || !strings[3] || !strings[4] || !Number.isFinite(setNumber)) return null
	return {
		date: strings[0],
		startTime: strings[1],
		endTime: strings[2],
		workoutId: strings[3],
		exerciseName: strings[4],
		liftId: strings[5],
		setNumber,
		setType: strings[7],
		plannedWeight: Number.isFinite(plannedWeight) ? plannedWeight : 0,
		plannedReps: Number.isFinite(plannedReps) ? plannedReps : 0,
		actualWeight: Number.isFinite(actualWeight) ? actualWeight : 0,
		actualReps: Number.isFinite(actualReps) ? actualReps : 0,
		completed: strings[12].toUpperCase() === 'TRUE',
	}
}

export function sortLogRows(rows: ParsedLogRow[]): ParsedLogRow[] {
	return rows.sort((left, right) => {
			const a = left as StoredLogRow
			const b = right as StoredLogRow
			const sessionOrder = a.startTime.localeCompare(b.startTime)
			if (sessionOrder !== 0) return sessionOrder
			const aOrder = a._migrationSourceRow ?? a._documentSequence ?? Number.MAX_SAFE_INTEGER
			const bOrder = b._migrationSourceRow ?? b._documentSequence ?? Number.MAX_SAFE_INTEGER
			return aOrder - bOrder
		})
}

export function readLogZone(uid: string): Promise<ParsedLogRow[]> {
	return readCollection<StoredLogRow>(uid, 'workoutSessions').then(sortLogRows)
}

export async function updateLogRows(
	uid: string,
	sessionDate: string,
	sessionWorkoutId: string,
	sessionStartTime: string,
	updatedRows: ParsedLogRow[],
): Promise<void> {
	const snapshot = await getDocs(userCollection(uid, 'workoutSessions'))
	const matches = snapshot.docs.filter((item) => {
		const row = item.data() as ParsedLogRow
		return row.date === sessionDate
			&& row.workoutId === sessionWorkoutId
			&& row.startTime === sessionStartTime
	})
	const sequencedRows: StoredLogRow[] = updatedRows.map((row, index) => ({
		...row,
		_documentSequence: index,
	}))
	const desiredIds = new Set(sequencedRows.map(logDocumentId))
	const staleMatches = matches.filter((item) => !desiredIds.has(item.id))
	if (staleMatches.length + sequencedRows.length > 500) {
		throw new Error('Workout session is too large to update atomically.')
	}

	const batch = writeBatch(firestore)
	for (const item of staleMatches) batch.delete(item.ref)
	for (const row of sequencedRows) {
		batch.set(doc(userCollection(uid, 'workoutSessions'), logDocumentId(row)), {
			...row,
			updatedAt: new Date().toISOString(),
		})
	}
	await batch.commit()
}

export async function deleteLogSession(
	uid: string,
	sessionDate: string,
	sessionWorkoutId: string,
	sessionStartTime: string,
): Promise<void> {
	const snapshot = await getDocs(userCollection(uid, 'workoutSessions'))
	const matches = snapshot.docs.filter((item) => {
		const row = item.data() as ParsedLogRow
		return row.date === sessionDate && row.workoutId === sessionWorkoutId && row.startTime === sessionStartTime
	})
	for (let start = 0; start < matches.length; start += 400) {
		const batch = writeBatch(firestore)
		for (const item of matches.slice(start, start + 400)) batch.delete(item.ref)
		await batch.commit()
	}
}

export function readFlags(uid: string): Promise<DayFlagEntry[]> {
	return readCollection<DayFlagEntry>(uid, 'dayFlags')
}

export function writeFlags(uid: string, flags: DayFlagEntry[]): Promise<void> {
	return replaceCollection(uid, 'dayFlags', flags, (entry) => entry.date)
}

export function scheduleDocumentId(entry: WorkoutScheduleEntry): string {
	return idPart(entry.strongerId || `${entry.date}:${entry.workoutId}:${entry.label ?? ''}`)
}

export function readWorkoutSchedule(uid: string): Promise<WorkoutScheduleEntry[]> {
	return readCollection<WorkoutScheduleEntry>(uid, 'schedule')
}

export function writeWorkoutSchedule(uid: string, entries: WorkoutScheduleEntry[]): Promise<void> {
	return replaceCollection(uid, 'schedule', entries, scheduleDocumentId)
}

export const readSchedule = readWorkoutSchedule
export const writeSchedule = writeWorkoutSchedule

export async function readSettings(uid: string): Promise<Map<string, string>> {
	const snapshot = await getDoc(doc(userDoc(uid), 'settings', 'app'))
	if (!snapshot.exists()) return new Map()
	const values = snapshot.data().values as Record<string, string> | undefined
	return new Map(Object.entries(values ?? {}))
}

export async function writeSettings(uid: string, settings: Map<string, string>): Promise<void> {
	await setDoc(doc(userDoc(uid), 'settings', 'app'), {
		values: Object.fromEntries(settings),
		updatedAt: new Date().toISOString(),
	})
}

export function readMealItems(uid: string): Promise<MealItem[]> {
	return readCollection<MealItem>(uid, 'mealItems')
}

export function writeMealItems(uid: string, items: MealItem[]): Promise<void> {
	return replaceCollection(uid, 'mealItems', items, (item) => idPart(item.id))
}

export function readMealFavorites(uid: string): Promise<FoodItem[]> {
	return readCollection<FoodItem>(uid, 'favoriteFoods')
}

export function writeMealFavorites(uid: string, items: FoodItem[]): Promise<void> {
	return replaceCollection(uid, 'favoriteFoods', items, (item) => idPart(item.code))
}

export function readMealRecents(uid: string): Promise<FoodItem[]> {
	return readCollection<StoredRecentFood>(uid, 'recentFoods').then((items) =>
		items.sort((a, b) => (a._recentOrder ?? Number.MAX_SAFE_INTEGER) - (b._recentOrder ?? Number.MAX_SAFE_INTEGER)),
	)
}

export function writeMealRecents(uid: string, items: FoodItem[]): Promise<void> {
	const stored: StoredRecentFood[] = items.map((item, index) => ({ ...item, _recentOrder: index }))
	return replaceCollection(uid, 'recentFoods', stored, (item) => idPart(item.code))
}

export function readMealLog(uid: string): Promise<MealLogEntry[]> {
	return readCollection<MealLogEntry>(uid, 'mealLog')
}

export function writeMealLog(uid: string, entries: MealLogEntry[]): Promise<void> {
	return replaceCollection(uid, 'mealLog', entries, (entry) => idPart(entry.id))
}

export async function appendMealLogEntry(uid: string, entry: MealLogEntry): Promise<void> {
	await setDoc(doc(userCollection(uid, 'mealLog'), idPart(entry.id)), {
		...entry,
		updatedAt: new Date().toISOString(),
	})
}

export async function deleteMealLogEntry(uid: string, id: string): Promise<void> {
	await deleteDoc(doc(userCollection(uid, 'mealLog'), idPart(id)))
}

export async function updateMealLogEntry(uid: string, id: string, quantity: number): Promise<void> {
	await setDoc(doc(userCollection(uid, 'mealLog'), idPart(id)), {
		quantity,
		updatedAt: new Date().toISOString(),
	}, { merge: true })
}

export async function updateMealLogEntryCategory(
	uid: string,
	ids: string[],
	category: MealCategory,
): Promise<void> {
	for (let start = 0; start < ids.length; start += 400) {
		const batch = writeBatch(firestore)
		for (const id of ids.slice(start, start + 400)) {
			batch.set(doc(userCollection(uid, 'mealLog'), idPart(id)), {
				category,
				updatedAt: new Date().toISOString(),
			}, { merge: true })
		}
		await batch.commit()
	}
}

export function readGarminActivities(uid: string): Promise<StravaActivity[]> {
	return readCollection<StravaActivity>(uid, 'garminActivities')
}

export function writeGarminActivities(uid: string, items: StravaActivity[]): Promise<void> {
	return replaceCollection(uid, 'garminActivities', items, (item) => idPart(item.stravaId))
}

export function readGarminWellnessEntries(uid: string): Promise<GarminWellnessEntry[]> {
	return readCollection<GarminWellnessEntry>(uid, 'garminWellness')
}

export function writeGarminWellnessEntries(uid: string, items: GarminWellnessEntry[]): Promise<void> {
	return replaceCollection(uid, 'garminWellness', items, (item) => item.date)
}

export function readWithingsMeasurements(uid: string): Promise<WithingsMeasurement[]> {
	return readCollection<WithingsMeasurement>(uid, 'withingsMeasurements')
}

export function writeWithingsMeasurements(uid: string, items: WithingsMeasurement[]): Promise<void> {
	return replaceCollection(uid, 'withingsMeasurements', items, (item) => idPart(item.grpId))
}

export const verifyScheduleTab = async (_uid?: string) => true
export const verifyWorkoutScheduleTab = async (_uid?: string) => true
export const verifyMealFavoritesTab = async (_uid?: string) => true
export const verifyMealRecentsTab = async (_uid?: string) => true
export const verifyGarminTab = async (_uid?: string) => true
export const verifyGarminWellnessTab = async (_uid?: string) => true
export const verifyWithingsTab = async (_uid?: string) => true
export const verifySettingsTab = async (_uid?: string) => true
export const createScheduleTab = async (_uid?: string) => undefined
export const createWorkoutScheduleTab = async (_uid?: string) => undefined
export const createMealFavoritesTab = async (_uid?: string) => undefined
export const createMealRecentsTab = async (_uid?: string) => undefined
export const createWithingsTab = async (_uid?: string) => undefined
export const createSettingsTab = async (_uid?: string) => undefined

export async function withDataRetry<T>(fn: () => Promise<T>): Promise<T> {
	return fn()
}

export const withAuthRetry = withDataRetry
