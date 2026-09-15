/**
 * Google API configuration.
 *
 * Replace the OAuth client ID with the value from the Google Cloud
 * Console. Set the VITE_GOOGLE_CLIENT_ID variable in your .env file.
 */

/** OAuth 2.0 client ID from Google Cloud Console (still required by gapi). */
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

/** OAuth scopes required to list calendars and manage their events. */
export const CALENDAR_SCOPE = [
	'https://www.googleapis.com/auth/calendar.events',
	'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
].join(' ')

/** Calendar API discovery document URL for gapi client initialization. */
export const CALENDAR_DISCOVERY_DOC =
	'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'
