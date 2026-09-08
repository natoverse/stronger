import { waitForPendingWrites } from 'firebase/firestore'
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
}

type PendingMutation = {
	id: string
	uid: string
	key: string
	createdAt: string
}

const listeners = new Set<(snapshot: SyncSnapshot) => void>()
let activeUid: string | null = null
let syncPromise: Promise<void> | null = null
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
	const database = await openDatabase()
	try {
		const transaction = database.transaction(STORE_NAME, 'readonly')
		const request = transaction.objectStore(STORE_NAME).index('uid').getAll(uid)
		return await requestResult(request) as PendingMutation[]
	} finally {
		database.close()
	}
}

async function enqueueMutation(uid: string, key: string): Promise<void> {
	const database = await openDatabase()
	try {
		const transaction = database.transaction(STORE_NAME, 'readwrite')
		const store = transaction.objectStore(STORE_NAME)
		const index = store.index('uidKey')
		const existing = await requestResult(index.getAllKeys([uid, key]))
		for (const id of existing) store.delete(id)
		store.put({
			id: crypto.randomUUID(),
			uid,
			key,
			createdAt: new Date().toISOString(),
		} satisfies PendingMutation)
		await new Promise<void>((resolve, reject) => {
			transaction.oncomplete = () => resolve()
			transaction.onerror = () => reject(transaction.error)
			transaction.onabort = () => reject(transaction.error)
		})
	} finally {
		database.close()
	}
}

async function clearMutations(uid: string, ids: string[]): Promise<void> {
	if (ids.length === 0) return
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
	const remaining = await mutationsForUser(uid)
	if (activeUid === uid) emit({ pendingCount: remaining.length })
}

export async function setActiveSyncUser(uid: string | null): Promise<void> {
	activeUid = uid
	const pendingCount = uid ? (await mutationsForUser(uid)).length : 0
	emit({ pendingCount, syncing: false })
	if (uid && snapshot.online) void retryPendingWrites()
}

export function subscribeToSyncStatus(listener: (value: SyncSnapshot) => void): () => void {
	listeners.add(listener)
	listener(snapshot)
	return () => listeners.delete(listener)
}

export async function trackMutation<T>(
	uid: string,
	key: string,
	write: () => Promise<T>,
): Promise<T> {
	await enqueueMutation(uid, key)
	if (activeUid === uid) {
		const pending = await mutationsForUser(uid)
		emit({ pendingCount: pending.length })
	}
	const result = await write()
	if (snapshot.online) void retryPendingWrites()
	return result
}

export function retryPendingWrites(): Promise<void> {
	if (syncPromise) return syncPromise
	const uid = activeUid
	if (!uid || !snapshot.online) return Promise.resolve()
	syncPromise = (async () => {
		const pending = await mutationsForUser(uid)
		if (pending.length === 0) return
		emit({ syncing: true, pendingCount: pending.length })
		await withTimeout(
			waitForPendingWrites(firestore),
			SYNC_TIMEOUT_MS,
			'Sync timed out.',
		)
		await clearMutations(uid, pending.map((item) => item.id))
		emit({ lastSyncedAt: new Date().toISOString() })
	})().catch(() => {
		// A bounded failure leaves the durable Firestore queue and status records
		// intact for the next online event or manual retry.
	}).finally(() => {
		emit({ syncing: false })
		syncPromise = null
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

if (typeof window !== 'undefined') {
	window.addEventListener('online', () => {
		emit({ online: true })
		void retryPendingWrites()
	})
	window.addEventListener('offline', () => emit({ online: false, syncing: false }))
}
