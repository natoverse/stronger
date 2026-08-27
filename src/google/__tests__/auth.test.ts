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

	it('deduplicates concurrent interactive sign-in requests', async () => {
		let config: TokenClientConfig | undefined
		let client: TokenClient | undefined
		window.google = mockGoogle((nextConfig) => {
			config = nextConfig
			client = mockTokenClient(nextConfig)
			return client
		})
		const auth = await loadAuth()

		const first = auth.signIn()
		const second = auth.signIn()

		expect(first).toBe(second)
		expect(window.google.accounts.oauth2.initTokenClient).toHaveBeenCalledTimes(1)
		expect(client?.requestAccessToken).toHaveBeenCalledWith({ prompt: '' })
		config?.callback({ access_token: 'token', expires_in: 3600 })
		await expect(first).resolves.toBe('token')
	})

	it('finishes immediately when the popup is closed', async () => {
		let config: TokenClientConfig | undefined
		window.google = mockGoogle((nextConfig) => {
			config = nextConfig
			return mockTokenClient(nextConfig)
		})
		const auth = await loadAuth()

		const attempt = auth.signIn()
		config?.error_callback?.({ type: 'popup_closed' })

		await expect(attempt).rejects.toSatisfy(auth.isSignInCanceledError)
		expect(window.google.accounts.oauth2.initTokenClient).toHaveBeenCalledTimes(1)
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

	it('releases an unresponsive sign-in after one minute', async () => {
		vi.useFakeTimers()
		window.google = mockGoogle(mockTokenClient)
		const auth = await loadAuth()

		const attempt = auth.signIn()
		const result = expect(attempt).rejects.toThrow('timed out')
		await vi.advanceTimersByTimeAsync(60_000)

		await result
		vi.useRealTimers()
	})

	it('clears an expired token without attempting a silent retry', async () => {
		const auth = await loadAuth()
		const operation = vi.fn().mockRejectedValue({ status: 401 })

		await expect(auth.withAuthRetry(operation)).rejects.toEqual({ status: 401 })
		expect(operation).toHaveBeenCalledTimes(1)
		expect(window.gapi?.client.setToken).toHaveBeenCalledWith(null)
	})
})
