import assert from 'node:assert/strict'
import { generateKeyPairSync, verify } from 'node:crypto'
import test from 'node:test'
import {
	firestoreFields,
	firestoreValue,
	getAccessToken,
	parseServiceAccount,
	required,
} from './firestore-admin.mjs'
import { createFirestoreClient, firestoreValueToJson } from './firestore-sync.mjs'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const serviceAccount = {
	project_id: 'test-project',
	client_email: 'sync@test-project.iam.gserviceaccount.com',
	private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
}

test('requires administrative configuration', () => {
	assert.equal(required('test-uid', 'FIREBASE_USER_ID'), 'test-uid')
	for (const value of [undefined, null, '']) {
		assert.throws(() => required(value, 'FIREBASE_USER_ID'), /Missing FIREBASE_USER_ID/)
	}
})

test('parses a complete service account and rejects invalid configuration', () => {
	assert.deepEqual(parseServiceAccount(JSON.stringify(serviceAccount), 'ACCOUNT'), serviceAccount)
	for (const raw of ['not-json', 'null', '{}', ...Object.keys(serviceAccount).map((missing) =>
		JSON.stringify({ ...serviceAccount, [missing]: undefined }))]) {
		assert.throws(() => parseServiceAccount(raw, 'ACCOUNT'), /ACCOUNT is not valid service-account JSON/)
	}
})

test('encodes Firestore scalars, collections, and optional fields', () => {
	const data = {
		period: '2026',
		count: 1,
		active: false,
		missing: null,
		omitted: undefined,
		entries: [{ weight: 80.2, optional: undefined, metrics: [0, true, null] }],
		empty: {},
	}
	const fields = firestoreFields(data)
	assert.deepEqual(fields, {
		period: { stringValue: '2026' },
		count: { integerValue: '1' },
		active: { booleanValue: false },
		missing: { nullValue: null },
		entries: { arrayValue: { values: [{ mapValue: { fields: {
			weight: { doubleValue: 80.2 },
			metrics: { arrayValue: { values: [
				{ integerValue: '0' }, { booleanValue: true }, { nullValue: null },
			] } },
		} } }] } },
		empty: { mapValue: { fields: {} } },
	})
	assert.deepEqual(firestoreValueToJson({ mapValue: { fields } }), JSON.parse(JSON.stringify(data)))
	assert.deepEqual(firestoreValue([]), { arrayValue: { values: [] } })
})

test('rejects unsupported Firestore values instead of silently corrupting data', () => {
	for (const value of [undefined, 1n, Symbol('unsupported'), () => {}]) {
		assert.throws(() => firestoreValue(value), /Unsupported Firestore value type/)
	}
	assert.throws(() => firestoreValue([undefined]), /Unsupported Firestore value type/)
})

test('creates a Firestore client through a signed service-account token exchange', async (t) => {
	let calls = 0
	t.mock.method(globalThis, 'fetch', async (url, options) => {
		calls += 1
		assert.equal(url, 'https://oauth2.googleapis.com/token')
		assert.equal(options.method, 'POST')
		assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded')
		assert.equal(options.body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer')
		const [header, payload, signature] = options.body.get('assertion').split('.')
		assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'RS256', typ: 'JWT' })
		const claims = JSON.parse(Buffer.from(payload, 'base64url'))
		assert.equal(claims.iss, serviceAccount.client_email)
		assert.equal(claims.scope, 'https://www.googleapis.com/auth/cloud-platform')
		assert.equal(claims.aud, url)
		assert.equal(claims.exp - claims.iat, 3600)
		assert.ok(Math.abs(claims.iat - Math.floor(Date.now() / 1000)) <= 1)
		assert.ok(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey,
			Buffer.from(signature, 'base64url')))
		return { ok: true, json: async () => ({ access_token: 'test-access-token' }) }
	})
	assert.deepEqual(await createFirestoreClient(JSON.stringify(serviceAccount), 'test-uid'), {
		projectId: 'test-project',
		token: 'test-access-token',
		uid: 'test-uid',
	})
	assert.equal(calls, 1)
})

test('surfaces rejected service-account token exchanges', async (t) => {
	t.mock.method(globalThis, 'fetch', async () => ({
		ok: false,
		status: 401,
		text: async () => 'invalid_grant',
	}))
	await assert.rejects(getAccessToken(serviceAccount, ['https://www.googleapis.com/auth/cloud-platform']),
		/Google token exchange failed \(401\): invalid_grant/)
})
