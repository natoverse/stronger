import { createHmac } from 'node:crypto'

const WITHINGS_API_BASE = 'https://wbsapi.withings.net'

export function signWithingsRequest(params, clientSecret) {
	const signedParams = {
		action: params.action,
		client_id: params.client_id,
		...(params.nonce ? { nonce: params.nonce } : {}),
		...(params.timestamp ? { timestamp: params.timestamp } : {}),
	}
	const values = Object.keys(signedParams)
		.sort()
		.map((key) => signedParams[key])
		.join(',')
	return createHmac('sha256', clientSecret).update(values).digest('hex')
}

async function postWithings(path, params, fetchImpl) {
	const res = await fetchImpl(`${WITHINGS_API_BASE}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(params),
	})
	if (!res.ok) {
		const text = await res.text()
		throw new Error(`Withings request failed (${res.status}): ${text}`)
	}
	const data = await res.json()
	if (data.status !== 0) {
		throw new Error(`Withings request returned status ${data.status}: ${JSON.stringify(data)}`)
	}
	return data.body
}

export async function getWithingsNonce(
	clientId,
	clientSecret,
	{ fetchImpl = fetch, timestamp = Math.round(Date.now() / 1000) } = {},
) {
	const params = {
		action: 'getnonce',
		client_id: clientId,
		timestamp: String(timestamp),
	}
	const nonce = (await postWithings('/v2/signature', {
		...params,
		signature: signWithingsRequest(params, clientSecret),
	}, fetchImpl)).nonce
	if (!nonce) {
		throw new Error('Withings nonce response did not include a nonce')
	}
	return nonce
}

export async function requestWithingsToken(
	clientId,
	clientSecret,
	grantParams,
	{ fetchImpl = fetch, timestamp } = {},
) {
	const nonce = await getWithingsNonce(clientId, clientSecret, { fetchImpl, timestamp })
	const signedParams = {
		action: 'requesttoken',
		client_id: clientId,
		nonce,
	}
	return postWithings('/v2/oauth2', {
		...signedParams,
		...grantParams,
		signature: signWithingsRequest(signedParams, clientSecret),
	}, fetchImpl)
}
