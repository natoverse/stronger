import {
	collection,
	doc,
	documentId,
	getDocs,
	getDoc,
	limit,
	query,
	runTransaction,
	setDoc,
	where,
	writeBatch,
	type DocumentData,
	type QueryDocumentSnapshot,
} from 'firebase/firestore'
import type {
	CardioActivity,
	DayFlagEntry,
	GarminWellnessEntry,
	LiftConfig,
	WithingsMeasurement,
	WorkoutScheduleEntry,
} from '../model/index.ts'
import type { StravaActivity } from '../model/types.ts'
import type { WorkoutDefinition } from '../data/sample-workouts.ts'
import type { ParsedLogRow } from '../google/sheets.ts'
import { firestore } from './client.ts'

export const SCHEMA_VERSION = 2
const BATCH_WRITE_LIMIT = 400
const TRANSACTIONAL_SEED_LIMIT = 250
export type YearBucketReadScope = 'all' | 'currentYear' | 'otherYears'
export type DateWindow = {
	startDate: string
	endDate: string
}

type DatedEntry = {
	date: string
	startTime?: string
}

type StoredYearBucket<T> = {
	period: string
	count: number
	entries: T[]
}

type StoredWorkoutSet = Pick<
	ParsedLogRow,
	| 'setNumber'
	| 'setType'
	| 'plannedWeight'
	| 'plannedReps'
	| 'actualWeight'
	| 'actualReps'
	| 'completed'
>

type StoredWorkoutExercise = {
	liftId: string
	exerciseName: string
	sets: StoredWorkoutSet[]
}

type StoredWorkoutSession = {
	date: string
	startTime: string
	endTime: string
	workoutId: string
	exercises: StoredWorkoutExercise[]
}

type StoredScheduleDay = {
	date: string
	events: Omit<WorkoutScheduleEntry, 'date'>[]
}

type CollectionName =
	| 'exercises'
	| 'workouts'
	| 'workoutSessions'
	| 'dayFlags'
	| 'schedule'
	| 'cardioActivities'
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
	return cleanValue<T>(snapshot.data())
}

function cleanValue<T>(data: DocumentData): T {
	const value = { ...data }
	delete value.createdAt
	delete value.updatedAt
	return value as T
}

function idPart(value: string): string {
	return encodeURIComponent(value).split('.').join('%2E')
}

function yearForDate(date: string): string {
	const year = date.slice(0, 4)
	if (!/^\d{4}$/.test(year)) throw new Error(`Cannot create year bucket for invalid date: ${date}`)
	return year
}

function sortDatedEntries<T extends DatedEntry>(entries: T[]): T[] {
	return [...entries].sort((left, right) =>
		`${left.date}:${left.startTime ?? ''}`.localeCompare(`${right.date}:${right.startTime ?? ''}`))
}

export function groupYearBuckets<T extends DatedEntry>(entries: T[]): StoredYearBucket<T>[] {
	const buckets = new Map<string, StoredYearBucket<T>>()
	for (const entry of sortDatedEntries(entries)) {
		const period = yearForDate(entry.date)
		if (!buckets.has(period)) buckets.set(period, { period, count: 0, entries: [] })
		const bucket = buckets.get(period)!
		bucket.entries.push(entry)
		bucket.count = bucket.entries.length
	}
	return [...buckets.values()]
}

export function flattenYearBuckets<T extends DatedEntry>(buckets: StoredYearBucket<T>[]): T[] {
	return sortDatedEntries(buckets.flatMap((bucket) => bucket.entries))
}

export function mergeYearScopedEntries<T extends DatedEntry>(
	existing: T[],
	loaded: T[],
	scope: YearBucketReadScope,
	currentYear = String(new Date().getFullYear()),
): T[] {
	if (scope === 'all') return sortDatedEntries(loaded)
	const retained = existing.filter((entry) =>
		scope === 'currentYear'
			? !entry.date.startsWith(currentYear)
			: entry.date.startsWith(currentYear))
	return sortDatedEntries([...retained, ...loaded])
}

async function readYearBucketCollection<T extends DatedEntry>(
	uid: string,
	name: CollectionName,
	scope: YearBucketReadScope = 'all',
): Promise<T[]> {
	const collectionRef = userCollection(uid, name)
	const currentYear = String(new Date().getFullYear())
	let buckets: StoredYearBucket<T>[]
	if (scope === 'currentYear') {
		const snapshot = await getDoc(doc(collectionRef, currentYear))
		buckets = snapshot.exists()
			? [cleanValue<StoredYearBucket<T>>(snapshot.data())]
			: []
	} else if (scope === 'otherYears') {
		const [past, future] = await Promise.all([
			getDocs(query(collectionRef, where(documentId(), '<', currentYear))),
			getDocs(query(collectionRef, where(documentId(), '>', currentYear))),
		])
		buckets = [...past.docs, ...future.docs].map((item) => clean<StoredYearBucket<T>>(item))
	} else {
		buckets = await readCollection<StoredYearBucket<T>>(uid, name)
	}
	return flattenYearBuckets(buckets)
}

function replaceYearBucketCollection<T extends DatedEntry>(
	uid: string,
	name: CollectionName,
	entries: T[],
): Promise<void> {
	return replaceCollection(uid, name, groupYearBuckets(entries), (bucket) => bucket.period)
}

async function readCollection<T>(uid: string, name: CollectionName): Promise<T[]> {
	const snapshot = await getDocs(userCollection(uid, name))
	return snapshot.docs.map((item) => clean<T>(item))
}

async function readDateWindowCollection<T>(
	uid: string,
	name: CollectionName,
	window: DateWindow,
): Promise<T[]> {
	const collectionRef = userCollection(uid, name)
	const snapshot = await getDocs(query(
		collectionRef,
		where(documentId(), '>=', window.startDate),
		where(documentId(), '<', window.endDate),
	))
	return snapshot.docs.map((item) => clean<T>(item))
}

export function mergeDateWindowEntries<T extends { date: string }>(
	existing: T[],
	loaded: T[],
	window?: DateWindow,
): T[] {
	if (!window) return loaded
	return [
		...existing.filter((entry) => entry.date < window.startDate || entry.date >= window.endDate),
		...loaded,
	].sort((left, right) => left.date.localeCompare(right.date))
}

async function commitInBatches(
	operations: Array<(batch: ReturnType<typeof writeBatch>) => void>,
): Promise<void> {
	for (let start = 0; start < operations.length; start += BATCH_WRITE_LIMIT) {
		const batch = writeBatch(firestore)
		for (const operation of operations.slice(start, start + BATCH_WRITE_LIMIT)) operation(batch)
		await batch.commit()
	}
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

	await commitInBatches(operations)
}

async function seedCollectionRequireEmpty<T>(
	uid: string,
	name: CollectionName,
	values: T[],
	getId: (value: T, index: number) => string,
	existingDataDescription: string,
): Promise<void> {
	const collectionRef = userCollection(uid, name)
	const nonEmptyLibraryError = `Default ${existingDataDescription} can only be imported into an empty ${existingDataDescription} library; existing data was found, so nothing was changed.`
	const existing = await getDocs(query(collectionRef, limit(1)))
	if (existing.docs.length > 0) {
		throw new Error(nonEmptyLibraryError)
	}
	const refs = values.map((value, index) => ({
		ref: doc(collectionRef, getId(value, index)),
		value,
	}))
	if (refs.length > TRANSACTIONAL_SEED_LIMIT) {
		throw new Error(`Default ${existingDataDescription} import is too large to write safely; nothing was changed.`)
	}
	await runTransaction(firestore, async (transaction) => {
		const snapshots = await Promise.all(refs.map(({ ref }) => transaction.get(ref)))
		if (snapshots.some((snapshot) => snapshot.exists())) {
			throw new Error(nonEmptyLibraryError)
		}
		const now = new Date().toISOString()
		refs.forEach(({ ref, value }) => {
			transaction.set(ref, { ...value as object, updatedAt: now })
		})
	})
}

async function writeDateScopedCollection<T>(
	uid: string,
	name: CollectionName,
	values: T[],
	dates: Iterable<string>,
	getId: (value: T) => string,
): Promise<void> {
	const byId = new Map(values.map((value) => [getId(value), value]))
	const operations = [...new Set(dates)].map((date) => {
		const ref = doc(userCollection(uid, name), date)
		const value = byId.get(date)
		return (batch: ReturnType<typeof writeBatch>) => {
			if (value) {
				batch.set(ref, { ...value as object, updatedAt: new Date().toISOString() })
			} else {
				batch.delete(ref)
			}
		}
	})
	await commitInBatches(operations)
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

export function writeDefaultWorkoutDefs(uid: string, definitions: WorkoutDefinition[]): Promise<void> {
	return seedCollectionRequireEmpty(uid, 'workouts', definitions, (item) => idPart(item.id), 'workouts')
}

export function readCardioActivities(uid: string): Promise<CardioActivity[] | null> {
	return readCollection<CardioActivity>(uid, 'cardioActivities').then((items) => items.length ? items : null)
}

export function writeCardioActivities(uid: string, activities: CardioActivity[]): Promise<void> {
	return replaceCollection(uid, 'cardioActivities', activities, (item) => idPart(item.id))
}

export const writeDefaultCardioActivities = writeCardioActivities

function workoutSessionKey(
	session: Pick<ParsedLogRow, 'date' | 'startTime' | 'workoutId'>,
): string {
	return `${session.date}:${session.startTime}:${session.workoutId}`
}

export function groupWorkoutSessionRows(rows: ParsedLogRow[]): StoredWorkoutSession[] {
	const sessions = new Map<string, StoredWorkoutSession>()
	for (const row of rows) {
		const sessionId = workoutSessionKey(row)
		if (!sessions.has(sessionId)) {
			sessions.set(sessionId, {
				date: row.date,
				startTime: row.startTime,
				endTime: row.endTime,
				workoutId: row.workoutId,
				exercises: [],
			})
		}

		const session = sessions.get(sessionId)!
		if (row.endTime) session.endTime = row.endTime
		const previousExercise = session.exercises[session.exercises.length - 1]
		const previousSet = previousExercise?.sets[previousExercise.sets.length - 1]
		const sameExercise = previousExercise !== undefined
			&& previousExercise.liftId === row.liftId
			&& previousExercise.exerciseName === row.exerciseName
			&& previousSet !== undefined
			&& row.setNumber > previousSet.setNumber
		const exercise = sameExercise
			? previousExercise
			: {
				liftId: row.liftId,
				exerciseName: row.exerciseName,
				sets: [],
			}
		if (!sameExercise) session.exercises.push(exercise)
		exercise.sets.push({
			setNumber: row.setNumber,
			setType: row.setType,
			plannedWeight: row.plannedWeight,
			plannedReps: row.plannedReps,
			actualWeight: row.actualWeight,
			actualReps: row.actualReps,
			completed: row.completed,
		})
	}
	return [...sessions.values()]
}

export function flattenWorkoutSessions(sessions: StoredWorkoutSession[]): ParsedLogRow[] {
	return [...sessions]
		.sort((left, right) =>
			`${left.date}|${left.startTime}`.localeCompare(`${right.date}|${right.startTime}`))
		.flatMap((session) =>
			session.exercises.flatMap((exercise) =>
				exercise.sets.map((set) => ({
					date: session.date,
					startTime: session.startTime,
					endTime: session.endTime,
					workoutId: session.workoutId,
					exerciseName: exercise.exerciseName,
					liftId: exercise.liftId,
					...set,
				}))))
}

export function mergeWorkoutSessionRows(
	existing: ParsedLogRow[],
	incoming: ParsedLogRow[],
): ParsedLogRow[] {
	const incomingKeys = new Set(incoming.map(workoutSessionKey))
	return flattenWorkoutSessions(groupWorkoutSessionRows([
		...existing.filter((row) => !incomingKeys.has(workoutSessionKey(row))),
		...incoming,
	]))
}

export async function appendLogRows(
	uid: string,
	rows: (string | number | boolean)[][],
): Promise<ParsedLogRow[]> {
	const parsed = rows.flatMap((row) => {
		const value = rowToParsedLogRow(row)
		return value ? [value] : []
	})
	const sessions = groupWorkoutSessionRows(parsed)
	for (const incoming of groupYearBuckets(sessions)) {
		const ref = doc(userCollection(uid, 'workoutSessions'), incoming.period)
		await runTransaction(firestore, async (transaction) => {
			const snapshot = await transaction.get(ref)
			const current = snapshot.exists()
				? (snapshot.data() as StoredYearBucket<StoredWorkoutSession>).entries
				: []
			const incomingKeys = new Set(incoming.entries.map(workoutSessionKey))
			const entries = sortDatedEntries([
				...current.filter((session) => !incomingKeys.has(workoutSessionKey(session))),
				...incoming.entries,
			])
			transaction.set(ref, {
				period: incoming.period,
				count: entries.length,
				entries,
				updatedAt: new Date().toISOString(),
			})
		})
	}
	return parsed
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

export function readLogZone(
	uid: string,
	scope: YearBucketReadScope = 'all',
): Promise<ParsedLogRow[]> {
	return readYearBucketCollection<StoredWorkoutSession>(uid, 'workoutSessions', scope)
		.then(flattenWorkoutSessions)
}

export async function updateLogRows(
	uid: string,
	sessionDate: string,
	sessionWorkoutId: string,
	sessionStartTime: string,
	updatedRows: ParsedLogRow[],
): Promise<void> {
	const sessions = groupWorkoutSessionRows(updatedRows)
	if (sessions.length !== 1) throw new Error('Updated rows must describe exactly one workout session.')

	const session = sessions[0]
	const originalKey = workoutSessionKey({
		date: sessionDate,
		workoutId: sessionWorkoutId,
		startTime: sessionStartTime,
	})
	const originalYear = yearForDate(sessionDate)
	const updatedYear = yearForDate(session.date)
	const years = [...new Set([originalYear, updatedYear])]
	await runTransaction(firestore, async (transaction) => {
		const refs = years.map((year) => doc(userCollection(uid, 'workoutSessions'), year))
		const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)))
		const entriesByYear = new Map(years.map((year, index) => [
			year,
			snapshots[index].exists()
				? (snapshots[index].data() as StoredYearBucket<StoredWorkoutSession>).entries
				: [],
		]))
		entriesByYear.set(
			originalYear,
			entriesByYear.get(originalYear)!.filter((item) => workoutSessionKey(item) !== originalKey),
		)
		entriesByYear.set(updatedYear, [
			...entriesByYear.get(updatedYear)!.filter((item) => workoutSessionKey(item) !== workoutSessionKey(session)),
			session,
		])
		for (let index = 0; index < years.length; index += 1) {
			const year = years[index]
			const entries = sortDatedEntries(entriesByYear.get(year)!)
			if (entries.length === 0) {
				transaction.delete(refs[index])
			} else {
				transaction.set(refs[index], {
					period: year,
					count: entries.length,
					entries,
					updatedAt: new Date().toISOString(),
				})
			}
		}
	})
}

export async function deleteLogSession(
	uid: string,
	sessionDate: string,
	sessionWorkoutId: string,
	sessionStartTime: string,
): Promise<void> {
	const period = yearForDate(sessionDate)
	const targetKey = workoutSessionKey({
		date: sessionDate,
		workoutId: sessionWorkoutId,
		startTime: sessionStartTime,
	})
	const ref = doc(userCollection(uid, 'workoutSessions'), period)
	await runTransaction(firestore, async (transaction) => {
		const snapshot = await transaction.get(ref)
		if (!snapshot.exists()) return
		const current = (snapshot.data() as StoredYearBucket<StoredWorkoutSession>).entries
		const entries = current.filter((session) => workoutSessionKey(session) !== targetKey)
		if (entries.length === current.length) return
		if (entries.length === 0) {
			transaction.delete(ref)
		} else {
			transaction.set(ref, {
				period,
				count: entries.length,
				entries,
				updatedAt: new Date().toISOString(),
			})
		}
	})
}

export function readFlags(uid: string, window?: DateWindow): Promise<DayFlagEntry[]> {
	return window
		? readDateWindowCollection<DayFlagEntry>(uid, 'dayFlags', window)
		: readCollection<DayFlagEntry>(uid, 'dayFlags')
}

export function writeFlags(uid: string, flags: DayFlagEntry[]): Promise<void> {
	return replaceCollection(uid, 'dayFlags', flags, (entry) => entry.date)
}

export function writeFlagDates(
	uid: string,
	flags: DayFlagEntry[],
	dates: Iterable<string>,
): Promise<void> {
	return writeDateScopedCollection(uid, 'dayFlags', flags, dates, (entry) => entry.date)
}

export function scheduleDayDocumentId(day: Pick<WorkoutScheduleEntry, 'date'>): string {
	return day.date
}

export function groupScheduleEntries(entries: WorkoutScheduleEntry[]): StoredScheduleDay[] {
	const days = new Map<string, StoredScheduleDay>()
	for (const { date, ...event } of entries) {
		if (!days.has(date)) days.set(date, { date, events: [] })
		days.get(date)!.events.push(event)
	}
	return [...days.values()]
}

export function flattenScheduleDays(days: StoredScheduleDay[]): WorkoutScheduleEntry[] {
	return [...days]
		.sort((left, right) => left.date.localeCompare(right.date))
		.flatMap((day) => day.events.map((event) => ({ date: day.date, ...event })))
}

export function readWorkoutSchedule(uid: string, window?: DateWindow): Promise<WorkoutScheduleEntry[]> {
	const pending = window
		? readDateWindowCollection<StoredScheduleDay>(uid, 'schedule', window)
		: readCollection<StoredScheduleDay>(uid, 'schedule')
	return pending.then(flattenScheduleDays)
}

export function writeWorkoutSchedule(uid: string, entries: WorkoutScheduleEntry[]): Promise<void> {
	return replaceCollection(
		uid,
		'schedule',
		groupScheduleEntries(entries),
		scheduleDayDocumentId,
	)
}

export function writeWorkoutScheduleDates(
	uid: string,
	entries: WorkoutScheduleEntry[],
	dates: Iterable<string>,
): Promise<void> {
	return writeDateScopedCollection(
		uid,
		'schedule',
		groupScheduleEntries(entries),
		dates,
		scheduleDayDocumentId,
	)
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

export function readGarminActivities(
	uid: string,
	scope: YearBucketReadScope = 'all',
): Promise<StravaActivity[]> {
	return readYearBucketCollection<StravaActivity>(uid, 'garminActivities', scope)
}

export function writeGarminActivities(uid: string, items: StravaActivity[]): Promise<void> {
	return replaceYearBucketCollection(uid, 'garminActivities', items)
}

export function readGarminWellnessEntries(
	uid: string,
	scope: YearBucketReadScope = 'all',
): Promise<GarminWellnessEntry[]> {
	return readYearBucketCollection<GarminWellnessEntry>(uid, 'garminWellness', scope)
}

export function writeGarminWellnessEntries(uid: string, items: GarminWellnessEntry[]): Promise<void> {
	return replaceYearBucketCollection(uid, 'garminWellness', items)
}

export function readWithingsMeasurements(
	uid: string,
	scope: YearBucketReadScope = 'all',
): Promise<WithingsMeasurement[]> {
	return readYearBucketCollection<WithingsMeasurement>(uid, 'withingsMeasurements', scope)
}

export function writeWithingsMeasurements(uid: string, items: WithingsMeasurement[]): Promise<void> {
	return replaceYearBucketCollection(uid, 'withingsMeasurements', items)
}

export const verifyScheduleTab = async (_uid?: string) => true
export const verifyWorkoutScheduleTab = async (_uid?: string) => true
export const verifyGarminTab = async (_uid?: string) => true
export const verifyGarminWellnessTab = async (_uid?: string) => true
export const verifyWithingsTab = async (_uid?: string) => true
export const verifySettingsTab = async (_uid?: string) => true
export const createScheduleTab = async (_uid?: string) => undefined
export const createWorkoutScheduleTab = async (_uid?: string) => undefined
export const createWithingsTab = async (_uid?: string) => undefined
export const createSettingsTab = async (_uid?: string) => undefined

export async function withDataRetry<T>(fn: () => Promise<T>): Promise<T> {
	return fn()
}

export const withAuthRetry = withDataRetry
