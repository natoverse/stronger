import { describe, it, expect } from 'vitest'
import { parseGarminRow, normalizeGarminActivityType } from '../sheets.ts'

/**
 * Full 19-column Garmin row (see scripts/garmin-sync.py HEADER):
 * date, activityId, activityType, name, duration, movingDuration, distance,
 * elevationGain, elevationLoss, activeCalories, totalCalories, avgHR, maxHR, avgSpeed, maxSpeed,
 * steps, aerobicTE, anaerobicTE, vo2Max
 */
function garminRow(overrides: Record<number, string> = {}): string[] {
	const row = [
		'2026-04-01', '123456789', 'running', 'Morning Run',
		'1800', '1790', '5000', '50', '45', '240', '300',
		'145', '170', '2.7', '3.5', '5100', '3.5', '0.5', '52',
	]
	for (const [idx, val] of Object.entries(overrides)) {
		row[Number(idx)] = val
	}
	return row
}

describe('normalizeGarminActivityType', () => {
	it('title-cases snake_case keys', () => {
		expect(normalizeGarminActivityType('lap_swimming')).toBe('Lap Swimming')
		expect(normalizeGarminActivityType('running')).toBe('Running')
	})

	it('maps strength_training onto Strava\'s label so views are comparable', () => {
		expect(normalizeGarminActivityType('strength_training')).toBe('Weight Training')
	})

	it('is case-insensitive and trims whitespace', () => {
		expect(normalizeGarminActivityType('  Cycling ')).toBe('Cycling')
	})

	it('returns empty string for empty input', () => {
		expect(normalizeGarminActivityType('')).toBe('')
	})
})

describe('parseGarminRow', () => {
	it('parses a valid Garmin row into the shared activity shape', () => {
		expect(parseGarminRow(garminRow())).toEqual({
			date: '2026-04-01',
			stravaId: '123456789',
			activityType: 'Running',
			name: 'Morning Run',
			duration: 1800,
			distance: 5000,
			elevationGain: 50,
			calories: 300,
			activeCalories: 240,
			totalCalories: 300,
			avgHR: 145,
			maxHR: 170,
		})
	})

	it('normalizes the activity type', () => {
		const result = parseGarminRow(garminRow({ 2: 'strength_training' }))
		expect(result!.activityType).toBe('Weight Training')
	})

	it('returns null when the row is too short', () => {
		expect(parseGarminRow(['2026-04-01', '123', 'running'])).toBeNull()
	})

	it('returns null for empty date, id, or type', () => {
		expect(parseGarminRow(garminRow({ 0: '' }))).toBeNull()
		expect(parseGarminRow(garminRow({ 1: '' }))).toBeNull()
		expect(parseGarminRow(garminRow({ 2: '' }))).toBeNull()
	})

	it('returns null for invalid date format', () => {
		expect(parseGarminRow(garminRow({ 0: '2026/04/01' }))).toBeNull()
	})

	it('returns null for negative or non-numeric metrics', () => {
		expect(parseGarminRow(garminRow({ 6: '-1' }))).toBeNull()
		expect(parseGarminRow(garminRow({ 4: 'abc' }))).toBeNull()
	})

	it('accepts zero values', () => {
		const result = parseGarminRow(garminRow({ 6: '0', 7: '0', 9: '0', 10: '0', 11: '0', 12: '0' }))
		expect(result).not.toBeNull()
		expect(result!.distance).toBe(0)
		expect(result!.avgHR).toBe(0)
	})

	it('returns null for null input', () => {
		expect(parseGarminRow(null as unknown as string[])).toBeNull()
	})
})
