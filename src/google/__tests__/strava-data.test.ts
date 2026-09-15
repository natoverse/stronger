import { describe, it, expect } from 'vitest'
import { parseStravaRow, stravaActivityToRow } from '../sheets.ts'

/* ------------------------------------------------------------------ */
/*  parseStravaRow                                                      */
/* ------------------------------------------------------------------ */

describe('parseStravaRow', () => {
	it('parses a valid Strava row', () => {
		expect(
			parseStravaRow([
				'2026-04-01', '12345678', 'Run', 'Morning Run',
				'1800', '5000', '50', '300', '145', '170',
			]),
		).toEqual({
			timestamp: '2026-04-01T00:00:00',
			stravaId: '12345678',
			activityType: 'Run',
			name: 'Morning Run',
			duration: 1800,
			distance: 5000,
			elevationGain: 50,
			calories: 300,
			avgHR: 145,
			maxHR: 170,
		})
	})

	it('trims whitespace', () => {
		expect(
			parseStravaRow([
				' 2026-04-01 ', ' 12345678 ', ' Run ', ' Morning Run ',
				' 1800 ', ' 5000 ', ' 50 ', ' 300 ', ' 145 ', ' 170 ',
			]),
		).toEqual({
			timestamp: '2026-04-01T00:00:00',
			stravaId: '12345678',
			activityType: 'Run',
			name: 'Morning Run',
			duration: 1800,
			distance: 5000,
			elevationGain: 50,
			calories: 300,
			avgHR: 145,
			maxHR: 170,
		})
	})

	it('accepts zero values for numeric fields', () => {
		const result = parseStravaRow([
			'2026-04-01', '12345678', 'WeightTraining', 'Gym Session',
			'3600', '0', '0', '0', '0', '0',
		])
		expect(result).not.toBeNull()
		expect(result!.distance).toBe(0)
		expect(result!.elevationGain).toBe(0)
		expect(result!.calories).toBe(0)
		expect(result!.avgHR).toBe(0)
		expect(result!.maxHR).toBe(0)
	})

	it('allows empty name', () => {
		const result = parseStravaRow([
			'2026-04-01', '12345678', 'Run', '',
			'1800', '5000', '50', '300', '145', '170',
		])
		expect(result).not.toBeNull()
		expect(result!.name).toBe('')
	})

	it('returns null for empty row', () => {
		expect(parseStravaRow([])).toBeNull()
	})

	it('returns null for row with fewer than 10 columns', () => {
		expect(parseStravaRow(['2026-04-01', '12345678', 'Run'])).toBeNull()
	})

	it('returns null for empty date', () => {
		expect(
			parseStravaRow(['', '12345678', 'Run', 'Run', '1800', '5000', '50', '300', '145', '170']),
		).toBeNull()
	})

	it('returns null for empty stravaId', () => {
		expect(
			parseStravaRow(['2026-04-01', '', 'Run', 'Run', '1800', '5000', '50', '300', '145', '170']),
		).toBeNull()
	})

	it('returns null for empty activityType', () => {
		expect(
			parseStravaRow(['2026-04-01', '12345678', '', 'Run', '1800', '5000', '50', '300', '145', '170']),
		).toBeNull()
	})

	it('returns null for invalid date format', () => {
		expect(
			parseStravaRow(['Apr 1 2026', '12345678', 'Run', 'Run', '1800', '5000', '50', '300', '145', '170']),
		).toBeNull()
		expect(
			parseStravaRow(['2026/04/01', '12345678', 'Run', 'Run', '1800', '5000', '50', '300', '145', '170']),
		).toBeNull()
	})

	it('returns null for negative numeric values', () => {
		expect(
			parseStravaRow(['2026-04-01', '12345678', 'Run', 'Run', '-1', '5000', '50', '300', '145', '170']),
		).toBeNull()
	})

	it('returns null for non-numeric values in numeric fields', () => {
		expect(
			parseStravaRow(['2026-04-01', '12345678', 'Run', 'Run', 'abc', '5000', '50', '300', '145', '170']),
		).toBeNull()
	})

	it('returns null for null input', () => {
		expect(parseStravaRow(null as unknown as string[])).toBeNull()
	})

	it('accepts decimal numeric values', () => {
		const result = parseStravaRow([
			'2026-04-01', '12345678', 'Ride', 'Bike Ride',
			'3600.5', '25000.75', '150.2', '500.5', '140.3', '175.8',
		])
		expect(result).not.toBeNull()
		expect(result!.duration).toBeCloseTo(3600.5)
		expect(result!.distance).toBeCloseTo(25000.75)
	})
})

/* ------------------------------------------------------------------ */
/*  stravaActivityToRow                                                 */
/* ------------------------------------------------------------------ */

describe('stravaActivityToRow', () => {
	it('converts a StravaActivity to a spreadsheet row', () => {
		expect(
			stravaActivityToRow({
				timestamp: '2026-04-01T00:00:00',
				stravaId: '12345678',
				activityType: 'Run',
				name: 'Morning Run',
				duration: 1800,
				distance: 5000,
				elevationGain: 50,
				calories: 300,
				avgHR: 145,
				maxHR: 170,
			}),
		).toEqual([
			'2026-04-01', '12345678', 'Run', 'Morning Run',
			'1800', '5000', '50', '300', '145', '170',
		])
	})

	it('converts zero numeric values', () => {
		expect(
			stravaActivityToRow({
				timestamp: '2026-04-01T06:30:00',
				stravaId: '12345678',
				activityType: 'WeightTraining',
				name: 'Gym',
				duration: 3600,
				distance: 0,
				elevationGain: 0,
				calories: 0,
				avgHR: 0,
				maxHR: 0,
			}),
		).toEqual([
			'2026-04-01', '12345678', 'WeightTraining', 'Gym',
			'3600', '0', '0', '0', '0', '0',
		])
	})

	it('round-trips through parseStravaRow', () => {
		const activities = [
			{
				timestamp: '2026-04-01T00:00:00',
				stravaId: '12345678',
				activityType: 'Run',
				name: 'Morning Run',
				duration: 1800,
				distance: 5000,
				elevationGain: 50,
				calories: 300,
				avgHR: 145,
				maxHR: 170,
			},
			{
				timestamp: '2026-03-15T00:00:00',
				stravaId: '87654321',
				activityType: 'Ride',
				name: 'Weekend Ride',
				duration: 7200,
				distance: 40000,
				elevationGain: 500,
				calories: 800,
				avgHR: 135,
				maxHR: 165,
			},
		]
		for (const activity of activities) {
			const row = stravaActivityToRow(activity)
			expect(parseStravaRow(row)).toEqual(activity)
		}
	})
})
