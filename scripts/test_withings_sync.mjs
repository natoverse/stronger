import assert from 'node:assert/strict'
import test from 'node:test'
import {
	requestWithingsToken,
	signWithingsRequest,
} from './withings-oauth.mjs'
import { groupToMeasurement } from './withings-sync.mjs'

test('signs nonce and token requests with sorted Withings parameters', () => {
	assert.equal(signWithingsRequest({
		action: 'getnonce',
		client_id: 'test-client',
		timestamp: '1700000000',
	}, 'test-secret'), 'ee278c4f7a9f5a5a8101e1a45c51fefcd85d5c72c4c236fa5752cc2b95a1e07e')

	assert.equal(signWithingsRequest({
		action: 'requesttoken',
		client_id: 'test-client',
		nonce: 'nonce-123',
	}, 'test-secret'), '9ec2f89bd8fbd0933af00ba81624fff236f9b599282c53c3eea49e47fa7769a3')
})

test('requests a nonce before exchanging a signed refresh token', async () => {
	const requests = []
	const fetchImpl = async (url, options) => {
		const body = Object.fromEntries(options.body)
		requests.push({ url, body })
		return {
			ok: true,
			json: async () => requests.length === 1
				? { status: 0, body: { nonce: 'nonce-123' } }
				: {
					status: 0,
					body: {
						access_token: 'access-token',
						refresh_token: 'rotated-token',
					},
				},
		}
	}

	const result = await requestWithingsToken(
		'test-client',
		'test-secret',
		{
			grant_type: 'refresh_token',
			refresh_token: 'seed-token',
		},
		{ fetchImpl, timestamp: 1700000000 },
	)

	assert.deepEqual(result, {
		access_token: 'access-token',
		refresh_token: 'rotated-token',
	})
	assert.deepEqual(requests, [
		{
			url: 'https://wbsapi.withings.net/v2/signature',
			body: {
				action: 'getnonce',
				client_id: 'test-client',
				timestamp: '1700000000',
				signature: 'ee278c4f7a9f5a5a8101e1a45c51fefcd85d5c72c4c236fa5752cc2b95a1e07e',
			},
		},
		{
			url: 'https://wbsapi.withings.net/v2/oauth2',
			body: {
				action: 'requesttoken',
				client_id: 'test-client',
				nonce: 'nonce-123',
				grant_type: 'refresh_token',
				refresh_token: 'seed-token',
				signature: '9ec2f89bd8fbd0933af00ba81624fff236f9b599282c53c3eea49e47fa7769a3',
			},
		},
	])
	assert.equal('client_secret' in requests[1].body, false)
})

test('maps a Withings group to the Firestore model', () => {
	const measurement = groupToMeasurement({
		grpid: 123,
		date: Date.UTC(2026, 7, 15) / 1000,
		measures: [
			{ type: 1, value: 802, unit: -1 },
			{ type: 6, value: 205, unit: -1 },
			{ type: 11, value: 58, unit: 0 },
		],
	})
	assert.deepEqual(measurement, {
		date: '2026-08-15',
		grpId: '123',
		weight: 80.2,
		fatMass: null,
		fatRatio: 20.5,
		muscleMass: null,
		boneMass: null,
		hydration: null,
		fatFreeMass: null,
		heartRate: 58,
		visceralFat: null,
	})
})

test('requires a positive weight like the migration parser', () => {
	assert.equal(groupToMeasurement({
		grpid: 123,
		date: Date.UTC(2026, 7, 15) / 1000,
		measures: [{ type: 6, value: 205, unit: -1 }],
	}), null)
})
