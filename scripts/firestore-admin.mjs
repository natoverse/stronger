/** Service-account authentication and value encoding for Firestore REST jobs. */

export function required(value, name) {
	if (!value) throw new Error(`Missing ${name} environment variable`)
	return value
}

export function parseServiceAccount(raw, name) {
	try {
		const value = JSON.parse(raw)
		if (!value.client_email || !value.private_key || !value.project_id) {
			throw new Error('missing client_email, private_key, or project_id')
		}
		return value
	} catch (error) {
		throw new Error(`${name} is not valid service-account JSON: ${error.message}`)
	}
}

export async function getAccessToken(serviceAccount, scopes) {
	const now = Math.floor(Date.now() / 1000)
	const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
	const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
		iss: serviceAccount.client_email,
		scope: scopes.join(' '),
		aud: 'https://oauth2.googleapis.com/token',
		iat: now,
		exp: now + 3600,
	})}`
	const pem = serviceAccount.private_key
		.replace(/-----BEGIN PRIVATE KEY-----/, '')
		.replace(/-----END PRIVATE KEY-----/, '')
		.replace(/\s/g, '')
	const key = await crypto.subtle.importKey(
		'pkcs8',
		Buffer.from(pem, 'base64'),
		{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
		false,
		['sign'],
	)
	const signature = await crypto.subtle.sign(
		'RSASSA-PKCS1-v1_5',
		key,
		new TextEncoder().encode(unsigned),
	)
	const jwt = `${unsigned}.${Buffer.from(signature).toString('base64url')}`
	const response = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion: jwt,
		}),
	})
	if (!response.ok) throw new Error(`Google token exchange failed (${response.status}): ${await response.text()}`)
	return (await response.json()).access_token
}

export function firestoreValue(value) {
	if (value === null) return { nullValue: null }
	if (typeof value === 'boolean') return { booleanValue: value }
	if (typeof value === 'number') {
		return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
	}
	if (typeof value === 'string') return { stringValue: value }
	if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } }
	if (typeof value === 'object') return { mapValue: { fields: firestoreFields(value) } }
	throw new Error(`Unsupported Firestore value type: ${typeof value}`)
}

export function firestoreFields(value) {
	return Object.fromEntries(
		Object.entries(value)
			.filter(([, child]) => child !== undefined)
			.map(([key, child]) => [key, firestoreValue(child)]),
	)
}
