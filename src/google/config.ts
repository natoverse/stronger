/**
 * Google API configuration.
 *
 * Replace the client ID with your own from the Google Cloud Console.
 * The project must have the Google Sheets API enabled and an OAuth 2.0
 * client ID configured for a web application with the correct origins.
 */

/** OAuth 2.0 client ID from Google Cloud Console. */
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

/** OAuth scope – read/write access to Google Sheets. */
export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

/** OAuth scope – full access to Google Calendar (list calendars + manage events). */
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar'

/** Combined OAuth scopes requested during sign-in. */
export const OAUTH_SCOPES = `${SHEETS_SCOPE} ${CALENDAR_SCOPE}`

/** Sheets API discovery document URL for gapi client initialization. */
export const SHEETS_DISCOVERY_DOC =
	'https://sheets.googleapis.com/$discovery/rest?version=v4'

/** Calendar API discovery document URL for gapi client initialization. */
export const CALENDAR_DISCOVERY_DOC =
	'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'

/** Name of the tab the app targets for lift configurations. */
export const TARGET_TAB_NAME = 'Stronger - Exercises'

/** Name of the tab that holds workout definitions (exercise structure). */
export const WORKOUT_DEFS_TAB_NAME = 'Stronger - Workouts'

/** Name of the tab that holds the workout log (completed set data). */
export const LOG_TAB_NAME = 'Stronger - Log'

/** Name of the tab that holds the workout schedule (date→workoutId mapping). */
export const SCHEDULE_TAB_NAME = 'Stronger - Schedule'

/** Name of the tab that holds the workout schedule (date→workoutId + calendar sync fields). */
export const WORKOUT_SCHEDULE_TAB_NAME = 'Stronger - Workout Schedule'

/** Name of the tab that holds cardio activity definitions (id + name). */
export const CARDIO_TAB_NAME = 'Stronger - Cardio'

/** Name of the tab that holds saved food and drink items. Deprecated: no longer read or written by the app (superseded by favorites/recents). */
export const MEAL_ITEMS_TAB_NAME = 'Stronger - Meal Items'

/** Name of the tab that holds daily food and drink entries. */
export const MEAL_LOG_TAB_NAME = 'Stronger - Meal Log'

/** Name of the tab that holds starred (favorite) foods from Open Food Facts. */
export const MEAL_FAVORITES_TAB_NAME = 'Stronger - Meal Favorites'

/** Name of the tab that holds the most recently logged foods from Open Food Facts. */
export const MEAL_RECENTS_TAB_NAME = 'Stronger - Meal Recents'

/** Name of the tab that holds Strava synced activity data. */
export const STRAVA_TAB_NAME = 'Stronger - Strava'

/** Name of the tab that holds Garmin synced activity data. */
export const GARMIN_TAB_NAME = 'Stronger - Garmin'

/** Name of the tab that holds Withings synced body-composition data. */
export const WITHINGS_TAB_NAME = 'Stronger - Withings'

/** Name of the tab that holds app settings as key/value pairs. */
export const SETTINGS_TAB_NAME = 'Stronger - Settings'

/** Name of the tab that holds daily Garmin wellness metrics (HRV, sleep, training, etc.). */
export const GARMIN_WELLNESS_TAB_NAME = 'Stronger - Garmin Wellness'
