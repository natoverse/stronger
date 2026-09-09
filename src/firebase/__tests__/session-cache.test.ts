import { describe, expect, it, vi } from 'vitest'
import { LAST_USER_KEY, readCachedUserId, writeCachedUserId } from '../session-cache.ts'

describe('cached authentication session', () => {
	it('reads the last user without waiting for Firebase restoration', () => {
		const getItem = vi.fn(() => 'user-123')

		expect(readCachedUserId({ getItem, setItem: vi.fn() })).toBe('user-123')
		expect(getItem).toHaveBeenCalledWith(LAST_USER_KEY)
	})

	it('does not block startup when browser storage is unavailable', () => {
		const getItem = vi.fn(() => {
			throw new Error('storage unavailable')
		})

		expect(readCachedUserId({ getItem, setItem: vi.fn() })).toBeNull()
	})

	it('stores the last authenticated user when storage is available', () => {
		const setItem = vi.fn()

		writeCachedUserId('user-123', { getItem: vi.fn(), setItem })

		expect(setItem).toHaveBeenCalledWith(LAST_USER_KEY, 'user-123')
	})
})
