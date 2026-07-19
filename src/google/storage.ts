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

/** Cookie lifetime for OAuth access token reuse: 7 days in seconds. */
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
/*  Cookie helpers                                                     */
/* ------------------------------------------------------------------ */

function setCookie(name: string, value: string, maxAgeSecs: number): void {
	if (typeof document === 'undefined') return
	document.cookie = `${name}=${encodeURIComponent(value)};max-age=${maxAgeSecs};path=/;SameSite=Strict;Secure`
}

function getCookie(name: string): string | null {
	if (typeof document === 'undefined') return null
	const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
	return match ? decodeURIComponent(match[1]) : null
}

function deleteCookie(name: string): void {
	if (typeof document === 'undefined') return
	document.cookie = `${name}=;max-age=0;path=/;SameSite=Strict;Secure`
}
