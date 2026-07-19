/**
 * Google OAuth authentication via Firebase Auth.
 *
 * Firebase Auth persists the user session in IndexedDB so the app
 * loads without requiring a sign-in click on every page reload.
 * Google API access tokens (for Sheets and Calendar) are obtained by
 * calling signInWithPopup, which completes silently when the user
 * already has an active Google session.
 *
 * gapi is still loaded for the Sheets and Calendar REST APIs.
 */

import { GoogleAuthProvider, signInWithPopup, signOut as fbSignOut, onAuthStateChanged } from 'firebase/auth'
import { firebaseAuth } from '../firebase/config.ts'
import { SHEETS_DISCOVERY_DOC, CALENDAR_DISCOVERY_DOC, SHEETS_SCOPE, CALENDAR_SCOPE } from './config.ts'
import { saveAccessToken, loadAccessToken, clearAccessToken } from './storage.ts'

export { onAuthStateChanged, firebaseAuth }

/* ------------------------------------------------------------------ */
/*  Script-loading helper (for gapi)                                   */
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
/*  Sign-in / sign-out                                                 */
/* ------------------------------------------------------------------ */

/** Reusable Google provider with Sheets + Calendar scopes. */
const googleProvider = new GoogleAuthProvider()
googleProvider.addScope(SHEETS_SCOPE)
googleProvider.addScope(CALENDAR_SCOPE)

/**
 * In-flight sign-in promise. Used to deduplicate concurrent attempts
 * so only one popup is opened at a time.
 */
let pendingSignIn: Promise<string> | null = null

/**
 * Sign in via Firebase + Google OAuth.
 * Opens a Google sign-in popup, resolves with the Google OAuth access
 * token, and sets it on gapi so Sheets/Calendar calls succeed.
 *
 * Concurrent callers share a single in-flight popup.
 */
export function signIn(): Promise<string> {
	if (pendingSignIn) return pendingSignIn

	pendingSignIn = (async () => {
		if (!firebaseAuth) {
			throw new Error('Firebase Auth is not configured. Set VITE_FIREBASE_* environment variables.')
		}
		if (!window.gapi?.client) {
			throw new Error('gapi client is not loaded. Call loadGapi() and initGapiClient() before signing in.')
		}
		const result = await signInWithPopup(firebaseAuth, googleProvider)
		const credential = GoogleAuthProvider.credentialFromResult(result)
		if (!credential?.accessToken) {
			throw new Error('No access token returned from Google sign-in.')
		}
		const accessToken = credential.accessToken
		window.gapi.client.setToken({ access_token: accessToken })
		saveAccessToken(accessToken)
		return accessToken
	})().finally(() => {
		pendingSignIn = null
	})

	return pendingSignIn
}

/**
 * Sign out: revoke the Firebase session and clear the gapi token.
 */
export async function signOut(): Promise<void> {
	clearAuth()
	if (firebaseAuth) await fbSignOut(firebaseAuth)
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
}

/**
 * Restore a previously persisted Google API access token into gapi.
 * Returns true when a stored token was found and applied.
 */
export function hydrateStoredAccessToken(): boolean {
	const accessToken = loadAccessToken()
	if (!accessToken) return false
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
			const email = firebaseAuth?.currentUser?.email
			return email
				? `The signed-in account (${email}) doesn’t have access to this spreadsheet. ${guidance}`
				: `You don't have permission to access this spreadsheet. ${guidance}`
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
 * retry attempts so only one sign-in popup is opened at a time.
 */
let reauthPromise: Promise<string> | null = null

/**
 * Execute an async operation, and if it fails with a 401 auth error,
 * re-authenticate via `signIn()` and retry once.
 *
 * Concurrent callers share a single re-auth attempt to avoid opening
 * multiple sign-in popups.
 */
export async function withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn()
	} catch (err) {
		if (!isAuthError(err)) throw err
		if (!reauthPromise) {
			clearAuth()
			reauthPromise = signIn().finally(() => { reauthPromise = null })
		}
		await reauthPromise
		return await fn()
	}
}
