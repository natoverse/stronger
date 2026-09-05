/**
 * One-time Withings authorization-code exchange.
 *
 * Required environment variables:
 *   WITHINGS_CLIENT_ID
 *   WITHINGS_CLIENT_SECRET
 *   WITHINGS_AUTHORIZATION_CODE
 *
 * Optional:
 *   WITHINGS_REDIRECT_URI (defaults to http://localhost)
 */

import { requestWithingsToken } from './withings-oauth.mjs'

const {
	WITHINGS_CLIENT_ID,
	WITHINGS_CLIENT_SECRET,
	WITHINGS_AUTHORIZATION_CODE,
	WITHINGS_REDIRECT_URI = 'http://localhost',
} = process.env

if (!WITHINGS_CLIENT_ID || !WITHINGS_CLIENT_SECRET || !WITHINGS_AUTHORIZATION_CODE) {
	console.error(
		'Missing WITHINGS_CLIENT_ID, WITHINGS_CLIENT_SECRET, or WITHINGS_AUTHORIZATION_CODE.',
	)
	process.exit(1)
}

try {
	const tokens = await requestWithingsToken(
		WITHINGS_CLIENT_ID,
		WITHINGS_CLIENT_SECRET,
		{
			grant_type: 'authorization_code',
			code: WITHINGS_AUTHORIZATION_CODE,
			redirect_uri: WITHINGS_REDIRECT_URI,
		},
	)
	console.log(JSON.stringify(tokens))
} catch (err) {
	console.error('Withings authorization failed:', err.message)
	process.exit(1)
}
