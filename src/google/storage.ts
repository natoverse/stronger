const SHEET_ID_COOKIE = 'stronger_sheet_id'

/** Cookie lifetime for the sheet ID: 1 year in seconds. */
const SHEET_ID_MAX_AGE = 365 * 24 * 60 * 60

/** Persist the spreadsheet ID in a long-lived cookie. */
export function saveSheetId(id: string): void {
	setCookie(SHEET_ID_COOKIE, id, SHEET_ID_MAX_AGE)
}

/** Read the stored spreadsheet ID, or `null` if not set. */
export function loadSheetId(): string | null {
	return getCookie(SHEET_ID_COOKIE)
}

/** Remove the stored spreadsheet ID. */
export function clearSheetId(): void {
	deleteCookie(SHEET_ID_COOKIE)
}

/* ------------------------------------------------------------------ */
/*  Calendar ID persistence (cookie-based)                             */
/* ------------------------------------------------------------------ */

const CALENDAR_ID_COOKIE = 'stronger_calendar_id'

/** Cookie lifetime for the calendar ID: 1 year in seconds. */
const CALENDAR_ID_MAX_AGE = 365 * 24 * 60 * 60

/** Persist the selected Google Calendar ID in a long-lived cookie. */
export function saveCalendarId(id: string): void {
	setCookie(CALENDAR_ID_COOKIE, id, CALENDAR_ID_MAX_AGE)
}

/** Read the stored calendar ID, or `null` if not set. */
export function loadCalendarId(): string | null {
	return getCookie(CALENDAR_ID_COOKIE)
}

/** Remove the stored calendar ID. */
export function clearCalendarId(): void {
	deleteCookie(CALENDAR_ID_COOKIE)
}

/* ------------------------------------------------------------------ */
/*  Access token persistence (cookie-based)                            */
/* ------------------------------------------------------------------ */

const ACCESS_TOKEN_COOKIE = 'stronger_google_access_token'

/**
 * Cookie lifetime for OAuth access token reuse: 7 days in seconds.
 * The token itself may expire sooner; 401 handling triggers re-auth.
 */
const ACCESS_TOKEN_MAX_AGE = 7 * 24 * 60 * 60

/** Persist the current Google API access token for reload reuse. */
export function saveAccessToken(token: string): void {
	setCookie(ACCESS_TOKEN_COOKIE, token, ACCESS_TOKEN_MAX_AGE)
}

/** Read the stored Google API access token, or `null` if not set. */
export function loadAccessToken(): string | null {
	return getCookie(ACCESS_TOKEN_COOKIE)
}

/** Remove the stored Google API access token. */
export function clearAccessToken(): void {
	deleteCookie(ACCESS_TOKEN_COOKIE)
}

/* ------------------------------------------------------------------ */
/*  Access token expiry persistence (cookie-based)                     */
/* ------------------------------------------------------------------ */

const ACCESS_TOKEN_EXPIRY_COOKIE = 'stronger_google_access_token_expiry'

/** Persist the access token's absolute expiry time (epoch milliseconds). */
export function saveAccessTokenExpiry(expiryMs: number): void {
	setCookie(ACCESS_TOKEN_EXPIRY_COOKIE, String(expiryMs), ACCESS_TOKEN_MAX_AGE)
}

/**
 * Read the stored access token expiry (epoch milliseconds), or `null`
 * if not set or unparseable.
 */
export function loadAccessTokenExpiry(): number | null {
	const raw = getCookie(ACCESS_TOKEN_EXPIRY_COOKIE)
	if (raw === null) return null
	const parsed = Number(raw)
	return Number.isFinite(parsed) ? parsed : null
}

/** Remove the stored access token expiry. */
export function clearAccessTokenExpiry(): void {
	deleteCookie(ACCESS_TOKEN_EXPIRY_COOKIE)
}

/* ------------------------------------------------------------------ */
/*  Signed-in user email persistence (cookie-based)                    */
/* ------------------------------------------------------------------ */

const USER_EMAIL_COOKIE = 'stronger_google_user_email'

/** Cookie lifetime for the signed-in email: 1 year in seconds. */
const USER_EMAIL_MAX_AGE = 365 * 24 * 60 * 60

/**
 * Persist the signed-in Google account email. Used as a `login_hint`
 * so silent token refreshes can pick the account without a picker, and
 * to show which account lacks access in permission-error messages.
 */
export function saveUserEmail(email: string): void {
	setCookie(USER_EMAIL_COOKIE, email, USER_EMAIL_MAX_AGE)
}

/** Read the stored signed-in email, or `null` if not set. */
export function loadUserEmail(): string | null {
	return getCookie(USER_EMAIL_COOKIE)
}

/** Remove the stored signed-in email. */
export function clearUserEmail(): void {
	deleteCookie(USER_EMAIL_COOKIE)
}

/* ------------------------------------------------------------------ */
/*  Cookie helpers                                                     */
/* ------------------------------------------------------------------ */

function setCookie(name: string, value: string, maxAgeSecs: number): void {
	if (!hasDocument()) return
	document.cookie = `${name}=${encodeURIComponent(value)};max-age=${maxAgeSecs};path=/;SameSite=Strict;Secure`
}

function getCookie(name: string): string | null {
	if (!hasDocument()) return null
	const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
	return match ? decodeURIComponent(match[1]) : null
}

function deleteCookie(name: string): void {
	if (!hasDocument()) return
	document.cookie = `${name}=;max-age=0;path=/;SameSite=Strict;Secure`
}

function hasDocument(): boolean {
	return typeof document !== 'undefined'
}
