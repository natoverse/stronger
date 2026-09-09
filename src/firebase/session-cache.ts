export const LAST_USER_KEY = 'stronger:lastUserId'

type SessionStorage = Pick<Storage, 'getItem' | 'setItem'>

export function readCachedUserId(
	storage: SessionStorage | null = typeof localStorage === 'undefined' ? null : localStorage,
): string | null {
	try {
		return storage?.getItem(LAST_USER_KEY) ?? null
	} catch {
		return null
	}
}

export function writeCachedUserId(
	uid: string,
	storage: SessionStorage | null = typeof localStorage === 'undefined' ? null : localStorage,
): void {
	try {
		storage?.setItem(LAST_USER_KEY, uid)
	} catch {
		// Firebase Auth persistence still provides its own storage fallbacks.
	}
}
