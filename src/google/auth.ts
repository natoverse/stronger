/**
 * Google OAuth authentication via Google Identity Services (GIS).
 *
 * Access tokens for the Sheets and Calendar APIs are obtained from the
 * GIS OAuth2 token client. Unlike a popup-based flow, the token client
 * can refresh tokens **silently** (no popup, no user gesture) whenever
 * the browser still has an active Google session for a previously
 * consented account. This keeps returning users signed in across
 * reloads without repeatedly clicking a sign-in button.
 *
 * The signed-in account email is persisted in a cookie and used as a
 * `login_hint` so silent refreshes resolve without an account picker.
 *
 * gapi is still loaded for the Sheets and Calendar REST APIs.
 */

import { GOOGLE_CLIENT_ID, SHEETS_DISCOVERY_DOC, CALENDAR_DISCOVERY_DOC, SHEETS_SCOPE, CALENDAR_SCOPE } from './config.ts'
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
} from './storage.ts'
import type { TokenClient, TokenResponse, TokenRequestOverrides } from './types.ts'

/** OAuth scopes required for identifying the signed-in account. */
const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email'

/**
 * Maximum time to wait for a token request to resolve before treating
 * it as failed. Prevents the UI from hanging indefinitely when GIS
 * neither invokes the success nor the error callback.
 */
const TOKEN_REQUEST_TIMEOUT_MS = 20_000

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
	await gapi.client.init({ discoveryDocs: [SHEETS_DISCOVERY_DOC, CALENDAR_DISCOVERY_DOC] })
	gapiInited = true
}

/* ------------------------------------------------------------------ */
/*  GIS token client                                                   */
/* ------------------------------------------------------------------ */

let tokenClient: TokenClient | null = null

/**
 * Initialise the GIS OAuth2 token client. Idempotent — safe to call
 * multiple times. A timed-out client is discarded before the next
 * request so its delayed callback cannot settle a newer attempt.
 */
export function initTokenClient(): void {
	if (tokenClient) return
	const google = window.google
	if (!google) throw new Error('Google Identity Services not loaded. Call loadGis() first.')
	if (!GOOGLE_CLIENT_ID) throw new Error('Google OAuth client ID is not configured. Set VITE_GOOGLE_CLIENT_ID.')
	tokenClient = google.accounts.oauth2.initTokenClient({
		client_id: GOOGLE_CLIENT_ID,
		scope: `${SHEETS_SCOPE} ${CALENDAR_SCOPE} ${EMAIL_SCOPE}`,
		callback: () => {},
	})
}

/**
 * Request an access token from the GIS token client, wrapped in a
 * promise. A `none` prompt performs a silent refresh (no UI); an empty
 * prompt allows GIS to show consent / account selection only when
 * required. Rejects on error or after a timeout.
 */
function requestToken(opts: { interactive: boolean; loginHint?: string }): Promise<TokenResponse> {
	return new Promise((resolve, reject) => {
		if (!tokenClient) {
			reject(new Error('Token client is not initialised. Call initTokenClient() first.'))
			return
		}

		let settled = false
		const client = tokenClient
		const timer = opts.interactive
			? null
			: setTimeout(() => {
				if (settled) return
				settled = true
				client.callback = () => {}
				client.error_callback = undefined
				if (tokenClient === client) tokenClient = null
				reject(new Error('Google sign-in timed out.'))
			}, TOKEN_REQUEST_TIMEOUT_MS)

		client.callback = (resp: TokenResponse) => {
			if (settled) return
			settled = true
			if (timer !== null) clearTimeout(timer)
			if (resp.error || !resp.access_token) {
				reject(new Error(resp.error_description || resp.error || 'No access token returned from Google.'))
				return
			}
			resolve(resp)
		}
		client.error_callback = (err) => {
			if (settled) return
			settled = true
			if (timer !== null) clearTimeout(timer)
			if (err?.type === 'popup_failed_to_open') {
				reject(new Error('Google sign-in could not open. Allow popups for this site, then try again.'))
				return
			}
			if (err?.type === 'popup_closed') {
				reject(new Error('Google sign-in was canceled. Try again when you are ready.'))
				return
			}
			reject(new Error(err?.message || err?.type || 'Google sign-in failed.'))
		}

		const overrides: TokenRequestOverrides = { prompt: opts.interactive ? '' : 'none' }
		if (opts.loginHint) overrides.login_hint = opts.loginHint
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

/* ------------------------------------------------------------------ */
/*  Sign-in / sign-out                                                 */
/* ------------------------------------------------------------------ */

/**
 * In-flight sign-in promise. Used to deduplicate concurrent attempts
 * so only one token request is issued at a time.
 */
let pendingSignIn: Promise<string> | null = null
let pendingSilentSignIn: Promise<string> | null = null

/**
 * Interactive sign-in. Requests an access token, allowing GIS to show
 * consent or account selection when necessary. Must be called from a
 * user gesture so any popup GIS opens is not blocked.
 *
 * Concurrent callers share a single in-flight request.
 */
export function signIn(): Promise<string> {
	if (pendingSignIn) return pendingSignIn

	pendingSignIn = (async () => {
		if (!window.gapi?.client) {
			throw new Error('gapi client is not loaded. Call loadGapi() and initGapiClient() before signing in.')
		}
		initTokenClient()
		const loginHint = loadUserEmail() ?? undefined
		const resp = await requestToken({ interactive: true, loginHint })
		const accessToken = applyTokenResponse(resp)
		await fetchAndStoreEmail(accessToken)
		return accessToken
	})().finally(() => {
		pendingSignIn = null
	})

	return pendingSignIn
}

/**
 * Silent sign-in. Attempts to obtain an access token without any UI,
 * using the persisted account email as a login_hint. Resolves for
 * returning users whose Google session is still active and who have
 * already consented; rejects otherwise (caller should then show the
 * interactive sign-in button).
 */
export function silentSignIn(): Promise<string> {
	if (pendingSilentSignIn) return pendingSilentSignIn

	pendingSilentSignIn = (async () => {
		if (!window.gapi?.client) {
			throw new Error('gapi client is not loaded. Call loadGapi() and initGapiClient() before signing in.')
		}
		initTokenClient()
		const loginHint = loadUserEmail() ?? undefined
		const resp = await requestToken({ interactive: false, loginHint })
		const accessToken = applyTokenResponse(resp)
		if (!loadUserEmail()) await fetchAndStoreEmail(accessToken)
		return accessToken
	})().finally(() => {
		pendingSilentSignIn = null
	})

	return pendingSilentSignIn
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
	if (expiry !== null && Date.now() >= expiry - TOKEN_EXPIRY_SKEW_MS) {
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
 * In-flight re-authentication promise. Used to deduplicate concurrent
 * retry attempts so only one token request is issued at a time.
 */
let reauthPromise: Promise<string> | null = null

/**
 * Execute an async operation, and if it fails with a 401 auth error,
 * silently refresh the access token via `silentSignIn()` and retry once.
 *
 * Concurrent callers share a single re-auth attempt. If the silent
 * refresh fails (session expired), the error propagates so the caller
 * can surface the interactive sign-in screen.
 */
export async function withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn()
	} catch (err) {
		if (!isAuthError(err)) throw err
		if (!reauthPromise) {
			reauthPromise = silentSignIn().finally(() => { reauthPromise = null })
		}
		await reauthPromise
		return await fn()
	}
}
