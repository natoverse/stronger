import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Gapi, GoogleIdentityServices, TokenClient, TokenClientConfig } from '../types.ts'

const CLIENT_ID = 'test-client-id'

function mockGapi() {
	let token: { access_token: string } | null = null
	return {
		load: vi.fn((_name: string, callback: () => void) => callback()),
		client: {
			init: vi.fn().mockResolvedValue(undefined),
			setToken: vi.fn((value: { access_token: string } | null) => {
				token = value
			}),
			getToken: vi.fn(() => token),
		},
	} as unknown as Gapi
}

function mockDocument() {
	const cookies = new Map<string, string>()
	return {
		get cookie() {
			return [...cookies].map(([key, value]) => `${key}=${value}`).join('; ')
		},
		set cookie(value: string) {
			const [pair, ...attributes] = value.split(';')
			const [rawName, rawValue = ''] = pair.split('=')
			const name = rawName.trim()
			const maxAge = attributes.find((attribute) => attribute.trim().toLowerCase().startsWith('max-age='))
			if (maxAge && Number(maxAge.split('=')[1]) === 0) {
				cookies.delete(name)
				return
			}
			cookies.set(name, rawValue.trim())
		},
		querySelector: vi.fn(() => ({ dataset: { loaded: 'true' } })),
	} as unknown as Document
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
		vi.stubGlobal('document', mockDocument())
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
		vi.stubGlobal('window', { gapi: mockGapi(), setTimeout, clearTimeout })
	})

	it('replaces failed Calendar scripts so preparation can retry', async () => {
		type ScriptStub = {
			src: string
			async: boolean
			defer: boolean
			dataset: Record<string, string>
			addEventListener: (type: string, listener: () => void) => void
			removeEventListener: (type: string, listener: () => void) => void
			remove: () => void
			dispatch: (type: string) => void
		}
		const scripts: ScriptStub[] = []
		const createScript = (): ScriptStub => {
			const listeners = new Map<string, Set<() => void>>()
			const script: ScriptStub = {
				src: '',
				async: false,
				defer: false,
				dataset: {},
				addEventListener: (type, listener) => {
					const registered = listeners.get(type) ?? new Set()
					registered.add(listener)
					listeners.set(type, registered)
				},
				removeEventListener: (type, listener) => listeners.get(type)?.delete(listener),
				remove: () => {
					const index = scripts.indexOf(script)
					if (index >= 0) scripts.splice(index, 1)
				},
				dispatch: (type) => {
					for (const listener of [...(listeners.get(type) ?? [])]) listener()
				},
			}
			return script
		}
		vi.stubGlobal('document', {
			cookie: '',
			querySelector: (selector: string) => {
				const src = selector.match(/src="([^"]+)"/)?.[1]
				return scripts.find((script) => script.src === src) ?? null
			},
			createElement: () => createScript(),
			head: {
				appendChild: (script: ScriptStub) => {
					scripts.push(script)
					return script
				},
			},
		})
		const auth = await loadAuth()

		const failedPreparation = auth.prepareCalendarAuthorization()
		expect(scripts).toHaveLength(2)
		for (const script of [...scripts]) script.dispatch('error')
		await expect(failedPreparation).rejects.toThrow('Failed to load script')
		expect(scripts).toHaveLength(0)

		const retry = auth.prepareCalendarAuthorization()
		expect(scripts).toHaveLength(2)
		for (const script of [...scripts]) script.dispatch('load')
		await expect(retry).resolves.toBeUndefined()
	})

	it('deduplicates concurrent Calendar authorization requests', async () => {
		let config: TokenClientConfig | undefined
		let client: TokenClient | undefined
		window.google = mockGoogle((nextConfig) => {
			config = nextConfig
			client = mockTokenClient(nextConfig)
			return client
		})
		const auth = await loadAuth()
		await auth.prepareCalendarAuthorization()

		const first = auth.authorizeCalendar()
		const second = auth.authorizeCalendar()

		expect(first).toBe(second)
		expect(window.google.accounts.oauth2.initTokenClient).toHaveBeenCalledTimes(1)
		expect(config?.scope?.split(' ')).toEqual([
			'https://www.googleapis.com/auth/calendar.events',
			'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
			'https://www.googleapis.com/auth/userinfo.email',
		])
		expect(client?.requestAccessToken).toHaveBeenCalledWith({ prompt: '' })
		config?.callback({ access_token: 'token', expires_in: 3600 })
		await expect(first).resolves.toBe('token')
		expect(document.cookie).toContain('stronger_google_access_token=token')
		expect(document.cookie).toContain('stronger_google_access_token_expiry=')
	})

	it('finishes immediately when the popup is closed', async () => {
		let config: TokenClientConfig | undefined
		window.google = mockGoogle((nextConfig) => {
			config = nextConfig
			return mockTokenClient(nextConfig)
		})
		const auth = await loadAuth()
		await auth.prepareCalendarAuthorization()

		const attempt = auth.authorizeCalendar()
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
		await auth.prepareCalendarAuthorization()

		const attempt = auth.authorizeCalendar()
		config?.error_callback?.({ type: 'popup_failed_to_open' })

		await expect(attempt).rejects.toThrow('Allow popups for this site')
	})

	it('releases an unresponsive sign-in after one minute', async () => {
		vi.useFakeTimers()
		window.google = mockGoogle(mockTokenClient)
		const auth = await loadAuth()
		await auth.prepareCalendarAuthorization()

		const attempt = auth.authorizeCalendar()
		const result = expect(attempt).rejects.toThrow('timed out')
		await vi.advanceTimersByTimeAsync(60_000)

		await result
		vi.useRealTimers()
	})

	it('reuses a persisted unexpired Calendar token without opening Google', async () => {
		window.google = mockGoogle(mockTokenClient)
		const auth = await loadAuth()
		const storage = await import('../storage.ts')
		storage.saveAccessToken('stored-token')
		storage.saveAccessTokenExpiry(Date.now() + 60 * 60 * 1000)
		await auth.prepareCalendarAuthorization()

		await expect(auth.authorizeCalendar()).resolves.toBe('stored-token')
		expect(window.google.accounts.oauth2.initTokenClient).not.toHaveBeenCalled()
		expect(window.gapi?.client.setToken).toHaveBeenCalledWith({ access_token: 'stored-token' })
	})

	it('clears Calendar authorization without revoking consent', async () => {
		window.google = mockGoogle(mockTokenClient)
		const auth = await loadAuth()
		const storage = await import('../storage.ts')
		storage.saveAccessToken('stored-token')
		storage.saveAccessTokenExpiry(Date.now() + 60 * 60 * 1000)
		storage.saveUserEmail('lifter@example.com')

		auth.disconnectCalendar()

		expect(storage.loadAccessToken()).toBeNull()
		expect(storage.loadAccessTokenExpiry()).toBeNull()
		expect(storage.loadUserEmail()).toBeNull()
		expect(window.google.accounts.oauth2.revoke).not.toHaveBeenCalled()
	})
})
