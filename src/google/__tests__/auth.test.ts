import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Gapi, GoogleIdentityServices, TokenClient, TokenClientConfig } from '../types.ts'

const CLIENT_ID = 'test-client-id'

function mockGapi() {
	return {
		client: {
			setToken: vi.fn(),
			getToken: vi.fn(),
		},
	} as unknown as Gapi
}

function mockGoogle(
	initTokenClient: (config: TokenClientConfig) => TokenClient,
): GoogleIdentityServices {
	return {
		accounts: {
			oauth2: {
				initTokenClient: vi.fn(initTokenClient),
				revoke: vi.fn(),
			},
		},
	}
}

function mockTokenClient(_config: TokenClientConfig): TokenClient {
	return {
		requestAccessToken: vi.fn(),
	}
}

async function loadAuth() {
	vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID)
	vi.resetModules()
	return import('../auth.ts')
}

describe('Google authentication', () => {
	beforeEach(() => {
		vi.unstubAllGlobals()
		vi.unstubAllEnvs()
		vi.stubGlobal('document', { cookie: '' })
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
		vi.stubGlobal('window', { gapi: mockGapi() })
	})

	it('deduplicates concurrent silent token requests', async () => {
		let config: TokenClientConfig | undefined
		window.google = mockGoogle((nextConfig) => {
			config = nextConfig
			return mockTokenClient(nextConfig)
		})
		const auth = await loadAuth()

		const first = auth.silentSignIn()
		const second = auth.silentSignIn()

		expect(first).toBe(second)
		expect(window.google.accounts.oauth2.initTokenClient).toHaveBeenCalledTimes(1)
		config?.callback({ access_token: 'token', expires_in: 3600 })
		await expect(first).resolves.toBe('token')
	})

	it('isolates a new attempt from callbacks belonging to an older request', async () => {
		vi.useFakeTimers()
		const configs: TokenClientConfig[] = []
		window.google = mockGoogle((config) => {
			configs.push(config)
			return mockTokenClient(config)
		})
		const auth = await loadAuth()

		const first = auth.silentSignIn()
		const firstResult = expect(first).rejects.toThrow('timed out')
		await vi.advanceTimersByTimeAsync(20_000)
		await firstResult

		const second = auth.silentSignIn()
		configs[0].callback({ access_token: 'stale-token', expires_in: 3600 })
		configs[1].callback({ access_token: 'fresh-token', expires_in: 3600 })

		await expect(second).resolves.toBe('fresh-token')
		expect(window.gapi?.client.setToken).toHaveBeenCalledWith({ access_token: 'fresh-token' })
		vi.useRealTimers()
	})

	it('reuses the token client after a completed request', async () => {
		let config: TokenClientConfig | undefined
		window.google = mockGoogle((nextConfig) => {
			config = nextConfig
			return mockTokenClient(nextConfig)
		})
		const auth = await loadAuth()

		const first = auth.silentSignIn()
		config?.callback({ access_token: 'first-token', expires_in: 3600 })
		await expect(first).resolves.toBe('first-token')

		const second = auth.silentSignIn()
		expect(window.google.accounts.oauth2.initTokenClient).toHaveBeenCalledTimes(1)
		config?.callback({ access_token: 'second-token', expires_in: 3600 })
		await expect(second).resolves.toBe('second-token')
	})

	it('isolates concurrent silent and interactive requests', async () => {
		const configs: TokenClientConfig[] = []
		window.google = mockGoogle((config) => {
			configs.push(config)
			return mockTokenClient(config)
		})
		const auth = await loadAuth()

		const silentAttempt = auth.silentSignIn()
		const interactiveAttempt = auth.signIn()

		expect(window.google.accounts.oauth2.initTokenClient).toHaveBeenCalledTimes(2)
		configs[0].callback({ access_token: 'silent-token', expires_in: 3600 })
		configs[1].callback({ access_token: 'interactive-token', expires_in: 3600 })

		await expect(silentAttempt).resolves.toBe('silent-token')
		await expect(interactiveAttempt).resolves.toBe('interactive-token')
	})

	it('turns popup failures into actionable errors', async () => {
		let config: TokenClientConfig | undefined
		window.google = mockGoogle((nextConfig) => {
			config = nextConfig
			return mockTokenClient(nextConfig)
		})
		const auth = await loadAuth()

		const attempt = auth.signIn()
		config?.error_callback?.({ type: 'popup_failed_to_open' })

		await expect(attempt).rejects.toThrow('Allow popups for this site')
	})

	it('recovers silently when GIS reports that the popup closed', async () => {
		vi.useFakeTimers()
		const configs: TokenClientConfig[] = []
		const clients: TokenClient[] = []
		window.google = mockGoogle((config) => {
			configs.push(config)
			const client = mockTokenClient(config)
			clients.push(client)
			return client
		})
		const auth = await loadAuth()

		const attempt = auth.signIn()
		configs[0].error_callback?.({ type: 'popup_closed' })
		await vi.advanceTimersByTimeAsync(300)

		expect(window.google.accounts.oauth2.initTokenClient).toHaveBeenCalledTimes(1)
		expect(clients[0].requestAccessToken).toHaveBeenLastCalledWith({
			prompt: 'none',
		})
		configs[0].callback({ access_token: 'recovered-token', expires_in: 3600 })

		await expect(attempt).resolves.toBe('recovered-token')
		expect(window.gapi?.client.setToken).toHaveBeenCalledTimes(1)
		vi.useRealTimers()
	})

	it('preserves a suppressible cancellation error when silent recovery fails', async () => {
		vi.useFakeTimers()
		let config: TokenClientConfig | undefined
		window.google = mockGoogle((nextConfig) => {
			config = nextConfig
			return mockTokenClient(nextConfig)
		})
		const auth = await loadAuth()

		const attempt = auth.signIn()
		const result = expect(attempt).rejects.toSatisfy(auth.isSignInCanceledError)
		config?.error_callback?.({ type: 'popup_closed' })
		await vi.advanceTimersByTimeAsync(300)
		config?.error_callback?.({ type: 'interaction_required' })

		await result
		vi.useRealTimers()
	})

	it('bounds popup-close recovery when GIS does not respond', async () => {
		vi.useFakeTimers()
		let config: TokenClientConfig | undefined
		window.google = mockGoogle((nextConfig) => {
			config = nextConfig
			return mockTokenClient(nextConfig)
		})
		const auth = await loadAuth()

		const attempt = auth.signIn()
		const result = expect(attempt).rejects.toSatisfy(auth.isSignInCanceledError)
		config?.error_callback?.({ type: 'popup_closed' })
		await vi.advanceTimersByTimeAsync(3_300)

		await result
		vi.useRealTimers()
	})

	it('allows interactive sign-in to remain open while the user completes it', async () => {
		vi.useFakeTimers()
		let config: TokenClientConfig | undefined
		window.google = mockGoogle((nextConfig) => {
			config = nextConfig
			return mockTokenClient(nextConfig)
		})
		const auth = await loadAuth()

		const attempt = auth.signIn()
		await vi.advanceTimersByTimeAsync(20_000)
		config?.callback({ access_token: 'token', expires_in: 3600 })

		await expect(attempt).resolves.toBe('token')
		vi.useRealTimers()
	})

	it('eventually releases an unresponsive interactive sign-in', async () => {
		vi.useFakeTimers()
		window.google = mockGoogle(mockTokenClient)
		const auth = await loadAuth()

		const attempt = auth.signIn()
		const result = expect(attempt).rejects.toThrow('timed out')
		await vi.advanceTimersByTimeAsync(5 * 60_000)

		await result
		vi.useRealTimers()
	})
})
