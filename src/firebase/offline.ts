import { doc, getDocFromServer, waitForPendingWrites } from 'firebase/firestore'
import { firestore } from './client.ts'
import { withTimeout } from './timeout.ts'

const DATABASE_NAME = 'stronger-offline'
const STORE_NAME = 'pendingMutations'
const SYNC_TIMEOUT_MS = 8_000

export type SyncSnapshot = {
	online: boolean
	syncing: boolean
	pendingCount: number
	lastSyncedAt: string | null
	error?: string
}

type MutationReceipt = { path: string[]; field: string; value: string | number }

export type MutationOptions = {
	receipt?: MutationReceipt
	recovery?: object
	supersedes?: string[]
	onRejected?: () => void
}

export type PendingMutation = {
	id: string
	uid: string
	key: string
	createdAt: string
	status?: 'pending' | 'failed'
	error?: string
	receipt?: MutationReceipt
	recovery?: object
	supersedes?: string[]
}

export function coalescePendingMutations(items: PendingMutation[]): PendingMutation[] {
	const latest = new Map<string, PendingMutation>()
	for (const item of [...items].sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
		latest.set(item.status === 'failed' ? item.id : `${item.uid}:${item.key}`, item)
	}
	return [...latest.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

const listeners = new Set<(snapshot: SyncSnapshot) => void>()
const fallbackMutations = new Map<string, PendingMutation>()
const activeWrites = new Set<string>()
let activeUid: string | null = null
let syncPromise: Promise<void> | null = null
let retryAttempt = 0
let retryTimer: number | null = null
let snapshot: SyncSnapshot = {
	online: typeof navigator === 'undefined' ? true : navigator.onLine,
	syncing: false,
	pendingCount: 0,
	lastSyncedAt: null,
}

function emit(update: Partial<SyncSnapshot> = {}) {
	snapshot = { ...snapshot, ...update }
	for (const listener of listeners) listener(snapshot)
}

function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DATABASE_NAME, 1)
		request.onupgradeneeded = () => {
			const database = request.result
			if (!database.objectStoreNames.contains(STORE_NAME)) {
				const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' })
				store.createIndex('uid', 'uid')
				store.createIndex('uidKey', ['uid', 'key'])
			}
		}
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error)
	})
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error)
	})
}

async function mutationsForUser(uid: string): Promise<PendingMutation[]> {
	try {
		const database = await openDatabase()
		try {
			const transaction = database.transaction(STORE_NAME, 'readonly')
			const request = transaction.objectStore(STORE_NAME).index('uid').getAll(uid)
			return await requestResult(request) as PendingMutation[]
		} finally {
			database.close()
		}
	} catch {
		try {
			const saved = JSON.parse(localStorage.getItem(`${DATABASE_NAME}:${uid}`) ?? '[]') as PendingMutation[]
			for (const item of saved) fallbackMutations.set(item.id, item)
		} catch {
			// IndexedDB and localStorage can both be unavailable in private mode.
		}
		return [...fallbackMutations.values()].filter((item) => item.uid === uid)
	}
}

function persistFallback(uid: string): void {
	try {
		localStorage.setItem(`${DATABASE_NAME}:${uid}`, JSON.stringify(
			[...fallbackMutations.values()].filter((item) => item.uid === uid),
		))
	} catch {
		// Retain the in-memory marker when browser storage is unavailable.
	}
}

async function putMutation(item: PendingMutation): Promise<void> {
	try {
		const database = await openDatabase()
		try {
			await new Promise<void>((resolve, reject) => {
				const transaction = database.transaction(STORE_NAME, 'readwrite')
				const store = transaction.objectStore(STORE_NAME)
				store.put(item)
				transaction.oncomplete = () => resolve()
				transaction.onerror = () => reject(transaction.error)
				transaction.onabort = () => reject(transaction.error)
			})
		} finally {
			database.close()
		}
	} catch {
		fallbackMutations.set(item.id, item)
		persistFallback(item.uid)
	}
}

async function clearMutations(uid: string, ids: string[]): Promise<void> {
	if (ids.length === 0) return
	try {
		const database = await openDatabase()
		try {
			const transaction = database.transaction(STORE_NAME, 'readwrite')
			const store = transaction.objectStore(STORE_NAME)
			for (const id of ids) store.delete(id)
			await new Promise<void>((resolve, reject) => {
				transaction.oncomplete = () => resolve()
				transaction.onerror = () => reject(transaction.error)
			})
		} finally {
			database.close()
		}
	} catch {
		for (const id of ids) fallbackMutations.delete(id)
		persistFallback(uid)
	}
	await refreshStatus(uid)
}

async function refreshStatus(uid: string): Promise<void> {
	const remaining = await mutationsForUser(uid)
	if (activeUid === uid) emit({
		pendingCount: remaining.filter((item) => item.status !== 'failed').length,
		error: remaining.find((item) => item.status === 'failed')?.error,
	})
}

async function failMutation(item: PendingMutation, reason: unknown): Promise<void> {
	const cause = reason instanceof Error ? reason.message : String(reason)
	const recovery = item.recovery ? ' Your saved workout is retained for recovery;' : ''
	const message = `A saved change was rejected: ${cause}.${recovery} Reload and review before retrying.`
	await putMutation({ ...item, status: 'failed', error: message })
	await refreshStatus(item.uid)
	if (typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent('stronger:mutation-error', {
			detail: { uid: item.uid, message },
		}))
	}
}

export async function readFailedMutationRecoveries<T>(uid: string): Promise<T[]> {
	return (await mutationsForUser(uid))
		.filter((item) => item.status === 'failed' && item.recovery)
		.sort((left, right) => left.createdAt.localeCompare(right.createdAt)
			|| (left.supersedes?.length ?? 0) - (right.supersedes?.length ?? 0))
		.map((item) => item.recovery as T)
}

async function acknowledgeMutation(item: PendingMutation): Promise<void> {
	const superseded = item.supersedes?.length
		? (await mutationsForUser(item.uid)).filter((prior) => item.supersedes!.includes(prior.key))
		: []
	await clearMutations(item.uid, [item.id, ...superseded.map((prior) => prior.id)])
}

export async function setActiveSyncUser(uid: string | null): Promise<void> {
	activeUid = uid
	const pending = uid ? await mutationsForUser(uid) : []
	if (activeUid !== uid) return
	let lastSyncedAt: string | null = null
	try {
		lastSyncedAt = uid ? localStorage.getItem(`stronger:lastSynced:${uid}`) : null
	} catch {
		// Keep the in-memory value when localStorage is unavailable.
	}
	emit({
		pendingCount: pending.filter((item) => item.status !== 'failed').length,
		error: pending.find((item) => item.status === 'failed')?.error,
		syncing: false,
		lastSyncedAt,
	})
	if (uid && snapshot.online) void retryPendingWrites()
}

export function subscribeToSyncStatus(listener: (value: SyncSnapshot) => void): () => void {
	listeners.add(listener)
	listener(snapshot)
	return () => listeners.delete(listener)
}

export async function trackMutation(
	uid: string,
	key: string,
	write: () => Promise<void>,
	options: MutationOptions = {},
): Promise<void> {
	const item: PendingMutation = {
		id: crypto.randomUUID(), uid, key, createdAt: new Date().toISOString(),
		status: 'pending',
		...(options.receipt ? { receipt: options.receipt } : {}),
		...(options.recovery ? { recovery: JSON.parse(JSON.stringify(options.recovery)) as object } : {}),
		...(options.supersedes ? { supersedes: options.supersedes } : {}),
	}
	activeWrites.add(item.id)
	await putMutation(item)
	await refreshStatus(uid)
	// Completion belongs to this exact write, never to waitForPendingWrites:
	// that promise also resolves when the server has rejected queued writes.
	void Promise.resolve().then(write).then(
		() => acknowledgeMutation(item),
		async (reason: unknown) => {
			await failMutation(item, reason)
			options.onRejected?.()
		},
	).finally(() => activeWrites.delete(item.id))
	if (snapshot.online) void retryPendingWrites()
}

export function retryPendingWrites(): Promise<void> {
	if (syncPromise) return syncPromise
	const uid = activeUid
	if (!uid || !snapshot.online) return Promise.resolve()
	syncPromise = (async () => {
		const pending = (await mutationsForUser(uid))
			.filter((item) => item.status !== 'failed')
			.sort((left, right) => (right.supersedes?.length ?? 0) - (left.supersedes?.length ?? 0))
		if (pending.length === 0) return
		if (activeUid !== uid) return
		emit({ syncing: true, pendingCount: pending.length })
		await withTimeout(
			waitForPendingWrites(firestore),
			SYNC_TIMEOUT_MS,
			'Sync timed out.',
		)
		for (const item of pending) {
			if (activeWrites.has(item.id)) continue
			const current = (await mutationsForUser(uid)).find((value) => value.id === item.id)
			if (!current || current.status === 'failed') continue
			if (item.receipt) {
				const { path, field, value } = item.receipt
				const result = await withTimeout(
					getDocFromServer(doc(firestore, path[0], ...path.slice(1))),
					SYNC_TIMEOUT_MS,
					'Could not verify the queued change.',
				)
				const actual = field.split('.').reduce<unknown>((data, key) =>
					typeof data === 'object' && data !== null
						? (data as Record<string, unknown>)[key]
						: undefined, result.data())
				if (!result.exists() || actual !== value) {
					await failMutation(item, new Error('The saved change could not be verified after synchronization.'))
					continue
				}
			}
			await acknowledgeMutation(item)
		}
		retryAttempt = 0
		if (retryTimer !== null) {
			window.clearTimeout(retryTimer)
			retryTimer = null
		}
		if ((await mutationsForUser(uid)).length > 0) return
		const lastSyncedAt = new Date().toISOString()
		try {
			localStorage.setItem(`stronger:lastSynced:${uid}`, lastSyncedAt)
		} catch {
			// The in-memory timestamp still updates.
		}
		if (activeUid === uid) emit({ lastSyncedAt })
	})().catch(() => {
		// A bounded failure leaves the durable Firestore queue and status records
		// intact for the next online event or manual retry.
		if (snapshot.online && retryTimer === null) {
			const baseDelay = Math.min(60_000, 1_000 * (2 ** retryAttempt))
			const delay = Math.round(baseDelay * (0.75 + Math.random() * 0.5))
			retryAttempt += 1
			retryTimer = window.setTimeout(() => {
				retryTimer = null
				void retryPendingWrites()
			}, delay)
		}
	}).finally(() => {
		if (activeUid === uid) emit({ syncing: false })
		syncPromise = null
		if (activeUid && activeUid !== uid && snapshot.online) void retryPendingWrites()
	})
	return syncPromise
}

export async function hasPendingMutations(uid: string): Promise<boolean> {
	return (await mutationsForUser(uid)).length > 0
}

export async function clearPendingMutations(uid: string): Promise<void> {
	const pending = await mutationsForUser(uid)
	await clearMutations(uid, pending.map((item) => item.id))
}

export async function clearOfflineUserState(uid: string): Promise<void> {
	await clearPendingMutations(uid)
	if (typeof localStorage === 'undefined') return
	const prefix = `stronger:hydrated:${uid}:`
	try {
		const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
		for (const key of keys) {
			if (key?.startsWith(prefix)) localStorage.removeItem(key)
		}
		if (localStorage.getItem('stronger:lastUserId') === uid) {
			localStorage.removeItem('stronger:lastUserId')
		}
		localStorage.removeItem(`stronger:lastSynced:${uid}`)
	} catch {
		// Storage may be unavailable in private browsing modes.
	}
}

if (typeof window !== 'undefined') {
	window.addEventListener('online', () => {
		emit({ online: true })
		void retryPendingWrites()
	})
	window.addEventListener('offline', () => emit({ online: false, syncing: false }))
}
