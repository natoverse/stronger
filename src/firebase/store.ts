import {
	collection,
	doc,
	documentId,
	getDocs,
	getDocsFromCache,
	getDocsFromServer,
	getDoc,
	getDocFromCache,
	getDocFromServer,
	query,
	setDoc,
	where,
	writeBatch,
	type DocumentData,
	type DocumentReference,
	type Query,
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
import { trackMutation } from './offline.ts'

export const SCHEMA_VERSION = 2
const BATCH_WRITE_LIMIT = 400
const TRANSACTIONAL_WRITE_LIMIT = 250
export type YearBucketReadScope = 'all' | 'currentYear' | 'otherYears'
export type FirestoreReadSource = 'cacheFirst' | 'server'
export type DateWindow = {
	startDate: string
	endDate: string
}

function hydrationKey(uid: string, dataset: string, scope = 'all'): string {
	return `stronger:hydrated:${uid}:${dataset}:${scope}`
}

function isHydrated(key?: string): boolean {
	if (!key || typeof localStorage === 'undefined') return false
	try {
		return localStorage.getItem(key) === '1'
	} catch {
		return false
	}
}

function markHydrated(key?: string): void {
	if (!key || typeof localStorage === 'undefined') return
	try {
		localStorage.setItem(key, '1')
	} catch {
		// Firestore's IndexedDB cache remains usable when localStorage is blocked.
	}
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
	year?: string
	deleted?: boolean
	replaces?: string
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
	source: FirestoreReadSource = 'cacheFirst',
): Promise<T[]> {
	const collectionRef = userCollection(uid, name)
	const currentYear = String(new Date().getFullYear())
	const cacheKey = hydrationKey(uid, name, scope)
	let buckets: StoredYearBucket<T>[]
	if (scope === 'currentYear') {
		const snapshot = await readDocument(doc(collectionRef, currentYear), source, cacheKey)
		buckets = snapshot.exists()
			? [cleanValue<StoredYearBucket<T>>(snapshot.data())]
			: []
	} else if (scope === 'otherYears') {
		const [past, future] = await Promise.all([
			readQuery(query(collectionRef, where(documentId(), '<', currentYear)), source, `${cacheKey}:past`),
			readQuery(query(collectionRef, where(documentId(), '>', currentYear)), source, `${cacheKey}:future`),
		])
		buckets = [...past.docs, ...future.docs].map((item) => clean<StoredYearBucket<T>>(item))
	} else {
		buckets = await readCollection<StoredYearBucket<T>>(uid, name, source, cacheKey)
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

async function readQuery(
	reference: Query<DocumentData>,
	source: FirestoreReadSource,
	cacheKey?: string,
) {
	if (source === 'server') {
		const server = await getDocsFromServer(reference)
		markHydrated(cacheKey)
		return server
	}
	const cached = await getDocsFromCache(reference)
	return cached.empty && !isHydrated(cacheKey)
		&& (typeof navigator === 'undefined' || navigator.onLine)
		? getDocs(reference).then((server) => {
				markHydrated(cacheKey)
				return server
			})
		: cached
}

async function readDocument(
	reference: DocumentReference<DocumentData>,
	source: FirestoreReadSource,
	cacheKey?: string,
) {
	if (source === 'server') {
		const server = await getDocFromServer(reference)
		markHydrated(cacheKey)
		return server
	}
	const cached = await getDocFromCache(reference)
	return !cached.exists() && !isHydrated(cacheKey)
		&& (typeof navigator === 'undefined' || navigator.onLine)
		? getDoc(reference).then((server) => {
				markHydrated(cacheKey)
				return server
			})
		: cached
}

async function readCollection<T>(
	uid: string,
	name: CollectionName,
	source: FirestoreReadSource = 'cacheFirst',
	cacheKey = hydrationKey(uid, name),
): Promise<T[]> {
	const snapshot = await readQuery(userCollection(uid, name), source, cacheKey)
	return snapshot.docs.map((item) => clean<T>(item))
}

async function readDateWindowCollection<T>(
	uid: string,
	name: CollectionName,
	window: DateWindow,
	source: FirestoreReadSource = 'cacheFirst',
): Promise<T[]> {
	const collectionRef = userCollection(uid, name)
	const snapshot = await readQuery(query(
		collectionRef,
		where(documentId(), '>=', window.startDate),
		where(documentId(), '<', window.endDate),
	), source, hydrationKey(uid, name, `${window.startDate}:${window.endDate}`))
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
	const existing = await getDocsFromCache(userCollection(uid, name))
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

async function addCollectionWithTargetIdGuard<T>(
	uid: string,
	name: CollectionName,
	values: T[],
	getId: (value: T, index: number) => string,
	existingDataDescription: string,
): Promise<void> {
	const collectionRef = userCollection(uid, name)
	const refs = values.map((value, index) => ({
		ref: doc(collectionRef, getId(value, index)),
		value,
	}))
	if (refs.length > TRANSACTIONAL_WRITE_LIMIT) {
		throw new Error(`Default ${existingDataDescription} import is too large to write safely; nothing was changed.`)
	}
	const snapshots = await Promise.all(refs.map(({ ref }) => getDocFromCache(ref)))
	if (snapshots.some((snapshot) => snapshot.exists())) {
		throw new Error(`Default ${existingDataDescription} import generated an existing document ID; nothing was changed.`)
	}
	const now = new Date().toISOString()
	await commitInBatches(refs.map(({ ref, value }) =>
		(batch) => batch.set(ref, { ...value as object, updatedAt: now })))
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

export function readConfigZone(
	uid: string,
	source: FirestoreReadSource = 'cacheFirst',
): Promise<LiftConfig[] | null> {
	return readCollection<LiftConfig>(uid, 'exercises', source).then((items) => items.length ? items : null)
}

export function writeDefaultConfig(uid: string, configs: LiftConfig[]): Promise<void> {
	return trackMutation(uid, 'exercises', () =>
		replaceCollection(uid, 'exercises', configs, (item) => idPart(item.id)))
}

export function writeConfigValues(uid: string, configs: LiftConfig[]): Promise<void> {
	return writeDefaultConfig(uid, configs)
}

export function readWorkoutDefs(
	uid: string,
	_liftNames?: Map<string, string>,
	source: FirestoreReadSource = 'cacheFirst',
): Promise<WorkoutDefinition[] | null> {
	return readCollection<WorkoutDefinition>(uid, 'workouts', source).then((items) => items.length ? items : null)
}

export function writeWorkoutDefs(uid: string, definitions: WorkoutDefinition[]): Promise<void> {
	return trackMutation(uid, 'workouts', () =>
		replaceCollection(uid, 'workouts', definitions, (item) => idPart(item.id)))
}

export function writeDefaultWorkoutDefs(uid: string, definitions: WorkoutDefinition[]): Promise<void> {
	return trackMutation(uid, 'workouts', () =>
		addCollectionWithTargetIdGuard(uid, 'workouts', definitions, (item) => idPart(item.id), 'workouts'))
}

export function readCardioActivities(
	uid: string,
	source: FirestoreReadSource = 'cacheFirst',
): Promise<CardioActivity[] | null> {
	return readCollection<CardioActivity>(uid, 'cardioActivities', source).then((items) => items.length ? items : null)
}

export function writeCardioActivities(uid: string, activities: CardioActivity[]): Promise<void> {
	return trackMutation(uid, 'cardioActivities', () =>
		replaceCollection(uid, 'cardioActivities', activities, (item) => idPart(item.id)))
}

export const writeDefaultCardioActivities = writeCardioActivities

function workoutSessionKey(
	session: Pick<ParsedLogRow, 'date' | 'startTime' | 'workoutId'>,
): string {
	return `${session.date}:${session.startTime}:${session.workoutId}`
}

function workoutSessionDocumentId(
	session: Pick<ParsedLogRow, 'date' | 'startTime' | 'workoutId'>,
): string {
	return idPart(workoutSessionKey(session))
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
	await trackMutation(
		uid,
		`workoutSessions:${sessions.map(workoutSessionDocumentId).join(',')}`,
		() => commitInBatches(sessions.map((session) => {
			const ref = doc(userCollection(uid, 'workoutSessions'), workoutSessionDocumentId(session))
			return (batch) => batch.set(ref, {
				...session,
				year: yearForDate(session.date),
				updatedAt: new Date().toISOString(),
			})
		})),
	)
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
	source: FirestoreReadSource = 'cacheFirst',
): Promise<ParsedLogRow[]> {
	const currentYear = String(new Date().getFullYear())
	return readQuery(
		userCollection(uid, 'workoutSessions'),
		source,
		hydrationKey(uid, 'workoutSessions', scope),
	).then((snapshot) => {
		const legacy: StoredWorkoutSession[] = []
		const stable: StoredWorkoutSession[] = []
		for (const item of snapshot.docs) {
			const data = clean<StoredWorkoutSession | StoredYearBucket<StoredWorkoutSession>>(item)
			if ('entries' in data) legacy.push(...data.entries)
			else stable.push(data)
		}
		const sessions = new Map(legacy.map((session) => [workoutSessionKey(session), session]))
		for (const session of stable) {
			if (session.replaces) sessions.delete(session.replaces)
			const key = workoutSessionKey(session)
			if (session.deleted) sessions.delete(key)
			else sessions.set(key, session)
		}
		const scoped = [...sessions.values()].filter((session) => {
			if (scope === 'all') return true
			const isCurrent = yearForDate(session.date) === currentYear
			return scope === 'currentYear' ? isCurrent : !isCurrent
		})
		return flattenWorkoutSessions(scoped)
	})
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
	const originalId = idPart(originalKey)
	const updatedId = workoutSessionDocumentId(session)
	await trackMutation(uid, `workoutSession:${originalId}`, async () => {
		const batch = writeBatch(firestore)
		if (originalId !== updatedId) {
			batch.delete(doc(userCollection(uid, 'workoutSessions'), originalId))
		}
		batch.set(doc(userCollection(uid, 'workoutSessions'), updatedId), {
			...session,
			year: yearForDate(session.date),
			...(originalKey === workoutSessionKey(session) ? {} : { replaces: originalKey }),
			updatedAt: new Date().toISOString(),
		})
		await batch.commit()
	})
}

export async function deleteLogSession(
	uid: string,
	sessionDate: string,
	sessionWorkoutId: string,
	sessionStartTime: string,
): Promise<void> {
	const targetKey = workoutSessionKey({
		date: sessionDate,
		workoutId: sessionWorkoutId,
		startTime: sessionStartTime,
	})
	const targetId = idPart(targetKey)
	await trackMutation(uid, `workoutSession:${targetId}`, () =>
		setDoc(doc(userCollection(uid, 'workoutSessions'), targetId), {
			date: sessionDate,
			year: yearForDate(sessionDate),
			startTime: sessionStartTime,
			endTime: '',
			workoutId: sessionWorkoutId,
			exercises: [],
			deleted: true,
			updatedAt: new Date().toISOString(),
		}))
}

export function readFlags(
	uid: string,
	window?: DateWindow,
	source: FirestoreReadSource = 'cacheFirst',
): Promise<DayFlagEntry[]> {
	return window
		? readDateWindowCollection<DayFlagEntry>(uid, 'dayFlags', window, source)
		: readCollection<DayFlagEntry>(uid, 'dayFlags', source)
}

export function writeFlags(uid: string, flags: DayFlagEntry[]): Promise<void> {
	return trackMutation(uid, 'dayFlags', () =>
		replaceCollection(uid, 'dayFlags', flags, (entry) => entry.date))
}

export function writeFlagDates(
	uid: string,
	flags: DayFlagEntry[],
	dates: Iterable<string>,
): Promise<void> {
	const dateList = [...dates]
	return trackMutation(uid, `dayFlags:${dateList.sort().join(',')}`, () =>
		writeDateScopedCollection(uid, 'dayFlags', flags, dateList, (entry) => entry.date))
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

export function readWorkoutSchedule(
	uid: string,
	window?: DateWindow,
	source: FirestoreReadSource = 'cacheFirst',
): Promise<WorkoutScheduleEntry[]> {
	const pending = window
		? readDateWindowCollection<StoredScheduleDay>(uid, 'schedule', window, source)
		: readCollection<StoredScheduleDay>(uid, 'schedule', source)
	return pending.then(flattenScheduleDays)
}

export function writeWorkoutSchedule(uid: string, entries: WorkoutScheduleEntry[]): Promise<void> {
	return trackMutation(uid, 'schedule', () => replaceCollection(
		uid,
		'schedule',
		groupScheduleEntries(entries),
		scheduleDayDocumentId,
	))
}

export function writeWorkoutScheduleDates(
	uid: string,
	entries: WorkoutScheduleEntry[],
	dates: Iterable<string>,
): Promise<void> {
	const dateList = [...dates]
	return trackMutation(uid, `schedule:${dateList.sort().join(',')}`, () => writeDateScopedCollection(
		uid,
		'schedule',
		groupScheduleEntries(entries),
		dateList,
		scheduleDayDocumentId,
	))
}

export const readSchedule = readWorkoutSchedule
export const writeSchedule = writeWorkoutSchedule

export async function readSettings(
	uid: string,
	source: FirestoreReadSource = 'cacheFirst',
): Promise<Map<string, string>> {
	const snapshot = await readDocument(
		doc(userDoc(uid), 'settings', 'app'),
		source,
		hydrationKey(uid, 'settings'),
	)
	if (!snapshot.exists()) return new Map()
	const values = snapshot.data().values as Record<string, string> | undefined
	return new Map(Object.entries(values ?? {}))
}

export async function writeSettings(uid: string, settings: Map<string, string>): Promise<void> {
	await trackMutation(uid, 'settings', () =>
		setDoc(doc(userDoc(uid), 'settings', 'app'), {
			values: Object.fromEntries(settings),
			updatedAt: new Date().toISOString(),
		}))
}

export function readGarminActivities(
	uid: string,
	scope: YearBucketReadScope = 'all',
	source: FirestoreReadSource = 'cacheFirst',
): Promise<StravaActivity[]> {
	return readYearBucketCollection<StravaActivity>(uid, 'garminActivities', scope, source)
}

export function writeGarminActivities(uid: string, items: StravaActivity[]): Promise<void> {
	return replaceYearBucketCollection(uid, 'garminActivities', items)
}

export function readGarminWellnessEntries(
	uid: string,
	scope: YearBucketReadScope = 'all',
	source: FirestoreReadSource = 'cacheFirst',
): Promise<GarminWellnessEntry[]> {
	return readYearBucketCollection<GarminWellnessEntry>(uid, 'garminWellness', scope, source)
}

export function writeGarminWellnessEntries(uid: string, items: GarminWellnessEntry[]): Promise<void> {
	return replaceYearBucketCollection(uid, 'garminWellness', items)
}

export function readWithingsMeasurements(
	uid: string,
	scope: YearBucketReadScope = 'all',
	source: FirestoreReadSource = 'cacheFirst',
): Promise<WithingsMeasurement[]> {
	return readYearBucketCollection<WithingsMeasurement>(uid, 'withingsMeasurements', scope, source)
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
