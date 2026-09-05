import { describe, expect, it, vi } from 'vitest'
import { OperationTimeoutError, withTimeout } from '../timeout.ts'

describe('Firebase operation timeout', () => {
	it('returns an operation result before the deadline', async () => {
		await expect(withTimeout(Promise.resolve('ready'), 100, 'timed out')).resolves.toBe('ready')
	})

	it('rejects an operation that does not settle before the deadline', async () => {
		vi.useFakeTimers()
		const pending = new Promise<void>(() => undefined)
		const result = expect(withTimeout(pending, 100, 'Loading workouts timed out.'))
			.rejects.toEqual(new OperationTimeoutError('Loading workouts timed out.'))

		await vi.advanceTimersByTimeAsync(100)
		await result
		vi.useRealTimers()
	})
})
