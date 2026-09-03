/**
 * Google OAuth authentication via Google Identity Services (GIS).
 *
 * Access tokens for the Calendar API are obtained from the GIS OAuth2 token
 * client after an explicit user click. Valid tokens are reused until Google
 * expires them; Firebase Authentication remains independent.
 *
 * The signed-in account email is persisted in a cookie and used as a
 * `login_hint` so Google can select the previous account.
 *
 * gapi is still loaded for the Sheets and Calendar REST APIs.
 */

import { GOOGLE_CLIENT_ID, CALENDAR_DISCOVERY_DOC, CALENDAR_SCOPE } from './config.ts'
import {
	saveAccessToken,
	loadAccessToken,
	clearAccessToken,
	saveAccessTokenExpiry,
	loadAccessTokenExpiry,
	clearAccessTokenExpiry,
	saveUserEmail,
	loadUserEmail,
	clearUserEmail,
	clearCalendarId,
} from './storage.ts'
import type { TokenClient, TokenResponse, TokenRequestOverrides } from './types.ts'

/** OAuth scopes required for identifying the signed-in account. */
const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email'

/**
 * Maximum time to wait for an interactive token request to resolve.
 */
const SIGN_IN_TIMEOUT_MS = 60_000

/**
 * Refresh the token this many milliseconds before its real expiry so a
 * stored token is never used right at the edge of expiring.
 */
const TOKEN_EXPIRY_SKEW_MS = 60_000

/* ------------------------------------------------------------------ */
/*  Script-loading helper (for gapi + GIS)                             */
/* ------------------------------------------------------------------ */

/** Cache of in-flight or completed script-loading promises. */
const scriptPromises = new Map<string, Promise<void>>()

function loadScript(src: string): Promise<void> {
	const cached = scriptPromises.get(src)
	if (cached) return cached

	const promise = new Promise<void>((resolve, reject) => {
		const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`)
		if (existing) {
			if (existing.dataset.loaded === 'true') {
				resolve()
				return
			}
			existing.addEventListener('load', () => resolve(), { once: true })
			existing.addEventListener('error', () => reject(new Error(`Failed to load script: ${src}`)), { once: true })
			return
		}
		const el = document.createElement('script')
		el.src = src
		el.async = true
		el.defer = true
		el.onload = () => {
			el.dataset.loaded = 'true'
			resolve()
		}
		el.onerror = () => {
			scriptPromises.delete(src)
			reject(new Error(`Failed to load script: ${src}`))
		}
		document.head.appendChild(el)
	})

	scriptPromises.set(src, promise)
	return promise
}

/** Load gapi client library. */
export function loadGapi(): Promise<void> {
	return loadScript('https://apis.google.com/js/api.js')
}

/** Load the Google Identity Services client library. */
export function loadGis(): Promise<void> {
	return loadScript('https://accounts.google.com/gsi/client')
}

/* ------------------------------------------------------------------ */
/*  gapi client initialisation                                        */
/* ------------------------------------------------------------------ */

let gapiInited = false

/** Initialise the gapi client and load Sheets + Calendar discovery docs. */
export async function initGapiClient(): Promise<void> {
	if (gapiInited) return
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	await new Promise<void>((resolve) => gapi.load('client', resolve))
	await gapi.client.init({ discoveryDocs: [CALENDAR_DISCOVERY_DOC] })
	gapiInited = true
}

let calendarApiReady = false
let calendarApiPreparation: Promise<void> | null = null

/** Load Calendar SDK dependencies before an interactive authorization click. */
export function prepareCalendarAuthorization(): Promise<void> {
	if (calendarApiReady) return Promise.resolve()
	if (calendarApiPreparation) return calendarApiPreparation

	calendarApiPreparation = Promise.all([loadGapi(), loadGis()])
		.then(() => initGapiClient())
		.then(() => {
			calendarApiReady = true
		})
		.catch((error) => {
			calendarApiPreparation = null
			throw error
		})
	return calendarApiPreparation
}

/* ------------------------------------------------------------------ */
/*  GIS token client                                                   */
/* ------------------------------------------------------------------ */

class SignInCanceledError extends Error {
	constructor() {
		super('Google sign-in was canceled.')
		this.name = 'SignInCanceledError'
	}
}

export function isSignInCanceledError(err: unknown): boolean {
	return err instanceof SignInCanceledError
}

function createTokenClient(
	callback: (resp: TokenResponse) => void,
	errorCallback: (message: string, canceled: boolean) => void,
	scope: string,
): TokenClient {
	const google = window.google
	if (!google) throw new Error('Google Identity Services not loaded. Call loadGis() first.')
	if (!GOOGLE_CLIENT_ID) throw new Error('Google OAuth client ID is not configured. Set VITE_GOOGLE_CLIENT_ID.')
	return google.accounts.oauth2.initTokenClient({
		client_id: GOOGLE_CLIENT_ID,
		scope,
		callback,
		error_callback: (err) => {
			if (err?.type === 'popup_failed_to_open') {
				errorCallback('Google sign-in could not open. Allow popups for this site, then try again.', false)
				return
			}
			errorCallback(err?.message || err?.type || 'Google sign-in failed.', err?.type === 'popup_closed')
		},
	})
}

/**
 * Request an access token from a user gesture. A fresh client keeps each
 * click's callbacks self-contained.
 */
function requestToken(scope: string, loginHint?: string): Promise<TokenResponse> {
	return new Promise((resolve, reject) => {
		let settled = false
		const timer = setTimeout(() => {
			if (settled) return
			settled = true
			reject(new Error('Google sign-in timed out. Please try again.'))
		}, SIGN_IN_TIMEOUT_MS)

		const client = createTokenClient(
			(resp) => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				if (resp.error || !resp.access_token) {
					reject(new Error(resp.error_description || resp.error || 'No access token returned from Google.'))
					return
				}
				resolve(resp)
			},
			(message, canceled) => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				reject(canceled ? new SignInCanceledError() : new Error(message))
			},
			scope,
		)

		const overrides: TokenRequestOverrides = { prompt: '' }
		if (loginHint) overrides.login_hint = loginHint
		client.requestAccessToken(overrides)
	})
}

/** Apply a freshly obtained token to gapi and persist it for reuse. */
function applyTokenResponse(resp: TokenResponse): string {
	const accessToken = resp.access_token as string
	window.gapi?.client.setToken({ access_token: accessToken })
	saveAccessToken(accessToken)
	const expiresInSec = Number(resp.expires_in) || 3600
	saveAccessTokenExpiry(Date.now() + expiresInSec * 1000)
	return accessToken
}

/**
 * Look up the signed-in account's email via the userinfo endpoint and
 * persist it for use as a login_hint. Best-effort — failures are
 * ignored so they never block sign-in.
 */
async function fetchAndStoreEmail(accessToken: string): Promise<void> {
	try {
		const authHeader = 'Bearer ' + accessToken
		const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
			headers: { Authorization: authHeader },
		})
		if (!res.ok) return
		const data = (await res.json()) as { email?: string }
		if (data.email) saveUserEmail(data.email)
	} catch {
		/* ignore — email is a convenience, not required */
	}
}

let pendingCalendarAuthorization: Promise<string> | null = null

/**
 * Ensure Google Calendar access independently from Stronger login.
 * SDK preparation must finish before this user-driven call so GIS can open
 * its dialog without a popup-blocking retry.
 */
export function authorizeCalendar(): Promise<string> {
	if (!calendarApiReady) {
		return Promise.reject(new Error('Google Calendar is still preparing. Please try again.'))
	}

	if (hydrateStoredAccessToken()) {
		return Promise.resolve(loadAccessToken() as string)
	}
	if (pendingCalendarAuthorization) return pendingCalendarAuthorization

	pendingCalendarAuthorization = requestToken(
		`${CALENDAR_SCOPE} ${EMAIL_SCOPE}`,
		loadUserEmail() ?? undefined,
	)
		.then(async (response) => {
			const accessToken = applyTokenResponse(response)
			await fetchAndStoreEmail(accessToken)
			return accessToken
		})
		.finally(() => {
			pendingCalendarAuthorization = null
		})
	return pendingCalendarAuthorization
}

/**
 * Sign out: revoke the access token, clear it from gapi, and drop the
 * persisted account email.
 */
export async function signOut(): Promise<void> {
	const token = loadAccessToken()
	clearAuth()
	clearUserEmail()
	if (token && window.google?.accounts?.oauth2?.revoke) {
		window.google.accounts.oauth2.revoke(token)
	}
}

/** Clear browser-local Calendar identity when the Stronger user signs out. */
export function disconnectCalendar(): void {
	clearAuth()
	clearUserEmail()
	clearCalendarId()
}

/** Check whether gapi currently holds an access token. */
export function hasToken(): boolean {
	return window.gapi?.client.getToken() != null
}

/**
 * Clear the gapi token. Use when a stored token turns out to be
 * expired / revoked so the next call will re-authenticate.
 */
export function clearAuth(): void {
	window.gapi?.client.setToken(null)
	clearAccessToken()
	clearAccessTokenExpiry()
}

/**
 * Restore a previously persisted Google API access token into gapi.
 * Returns true when a valid (non-expired) stored token was applied.
 * An expired token is cleared and `false` is returned.
 */
export function hydrateStoredAccessToken(): boolean {
	const accessToken = loadAccessToken()
	if (!accessToken) return false
	const expiry = loadAccessTokenExpiry()
	if (expiry === null || Date.now() >= expiry - TOKEN_EXPIRY_SKEW_MS) {
		clearAuth()
		return false
	}
	window.gapi?.client.setToken({ access_token: accessToken })
	return true
}

/**
 * Extract the HTTP status code from a gapi error object.
 * Returns `undefined` if the status cannot be determined.
 */
export function getGapiErrorStatus(err: unknown): number | undefined {
	if (err && typeof err === 'object') {
		const e = err as Record<string, unknown>
		if (typeof e.status === 'number') return e.status
		const result = e.result as Record<string, unknown> | undefined
		if (result?.error) {
			const apiError = result.error as Record<string, unknown>
			if (typeof apiError.code === 'number') return apiError.code
		}
	}
	return undefined
}

/**
 * Check whether an error thrown by gapi.client is a 401 auth error,
 * indicating the access token has expired or been revoked.
 */
export function isAuthError(err: unknown): boolean {
	return getGapiErrorStatus(err) === 401
}

/**
 * Return a user-friendly error message for a sheet connection failure.
 * Uses the HTTP status code to give actionable guidance.
 */
export function describeSheetError(err: unknown): string {
	const status = getGapiErrorStatus(err)
	switch (status) {
		case 404:
			return 'This spreadsheet was not found — it may have been deleted or moved to Trash.'
		case 403: {
			const guidance = 'Share the sheet with this account, or sign out and use a different Google account.'
			const email = loadUserEmail()
			const accountMessage = email
				? `The signed-in account (${email}) doesn’t have access to this spreadsheet.`
				: 'You don\'t have permission to access this spreadsheet.'
			return `${accountMessage} ${guidance}`
		}
		default:
			return err instanceof Error
				? err.message
				: 'Unable to access the sheet.'
	}
}

/* ------------------------------------------------------------------ */
/*  Auth-retry wrapper                                                 */
/* ------------------------------------------------------------------ */

/**
 * Execute an async operation and clear an expired token after a 401.
 * Re-authentication always requires the user to click the sign-in button.
 */
export async function withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn()
	} catch (err) {
		if (!isAuthError(err)) throw err
		clearAuth()
		throw err
	}
}
