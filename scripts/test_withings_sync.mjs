import assert from 'node:assert/strict'
import test from 'node:test'
import { groupToMeasurement } from './withings-sync.mjs'

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
