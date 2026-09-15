/**
 * Minimal type declarations for the gapi Calendar client used by this app.
 *
 * These cover only the surface area we actually use so we don't need the
 * full @types/gapi packages as dependencies.
 */

/* ------------------------------------------------------------------ */
/*  gapi client (loaded from apis.google.com/js/api.js)               */
/* ------------------------------------------------------------------ */

export interface GapiClient {
	init: (config: { discoveryDocs: string[] }) => Promise<void>
	getToken: () => { access_token: string } | null
	setToken: (token: { access_token: string } | null) => void
	calendar: {
		calendarList: {
			list: () => Promise<CalendarListResponse>
		}
		events: {
			insert: (params: {
				calendarId: string
				resource: CalendarEventResource
			}) => Promise<CalendarEventResponse>
			update: (params: {
				calendarId: string
				eventId: string
				resource: CalendarEventResource
			}) => Promise<CalendarEventResponse>
			get: (params: {
				calendarId: string
				eventId: string
			}) => Promise<{ result: CalendarEventItem }>
			delete: (params: {
				calendarId: string
				eventId: string
			}) => Promise<unknown>
			list: (params: {
				calendarId: string
				timeMin?: string
				timeMax?: string
				singleEvents?: boolean
				maxResults?: number
				q?: string
				pageToken?: string
			}) => Promise<CalendarEventsListResponse>
		}
	}
}

export interface Gapi {
	load: (lib: string, callback: () => void) => void
	client: GapiClient
}

/* ------------------------------------------------------------------ */
/*  Calendar API types                                                 */
/* ------------------------------------------------------------------ */

export interface CalendarListEntry {
	id: string
	summary: string
	primary?: boolean
	accessRole: 'freeBusyReader' | 'reader' | 'writer' | 'owner'
}

export interface CalendarListResponse {
	result: {
		items: CalendarListEntry[]
	}
}

export interface CalendarEventResource {
	summary: string
	description?: string
	start: { date: string }
	end: { date: string }
}

export interface CalendarEventResponse {
	result: {
		id: string
		htmlLink: string
	}
}

export interface CalendarEventsListResponse {
	result: {
		items?: CalendarEventItem[]
		nextPageToken?: string
	}
}

export interface CalendarEventItem {
	id?: string
	summary?: string
	description?: string
	start?: { date?: string; dateTime?: string }
	end?: { date?: string; dateTime?: string }
	status?: string
}

/* ------------------------------------------------------------------ */
/*  Google Identity Services (loaded from accounts.google.com/gsi)     */
/* ------------------------------------------------------------------ */

/** Response passed to a token client's success callback. */
export interface TokenResponse {
	access_token?: string
	expires_in?: number | string
	scope?: string
	token_type?: string
	error?: string
	error_description?: string
}

/** Error passed to a token client's error_callback. */
export interface TokenError {
	type?: string
	message?: string
}

/** Per-request overrides accepted by requestAccessToken. */
export interface TokenRequestOverrides {
	prompt?: string
	login_hint?: string
}

/** Token client returned by initTokenClient. */
export interface TokenClient {
	requestAccessToken: (overrides?: TokenRequestOverrides) => void
}

/** Configuration passed to initTokenClient. */
export interface TokenClientConfig {
	client_id: string
	scope: string
	callback: (resp: TokenResponse) => void
	error_callback?: (err: TokenError) => void
	prompt?: string
}

export interface GoogleIdentityServices {
	accounts: {
		oauth2: {
			initTokenClient: (config: TokenClientConfig) => TokenClient
			revoke: (token: string, done?: () => void) => void
		}
	}
}

/* ------------------------------------------------------------------ */
/*  Global augmentations                                               */
/* ------------------------------------------------------------------ */

declare global {
	interface Window {
		gapi?: Gapi
		google?: GoogleIdentityServices
	}
}
