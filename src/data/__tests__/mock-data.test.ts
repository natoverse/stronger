import { describe, expect, it } from 'vitest'
import { createMockData, isMockMode } from '../mock-data.ts'

describe('mock data', () => {
	it('recognizes only explicit mock query values', () => {
		expect(isMockMode('?mock=true')).toBe(true)
		expect(isMockMode('?mock=1')).toBe(true)
		expect(isMockMode('?mock=false')).toBe(false)
		expect(isMockMode('')).toBe(false)
	})

	it('covers every application data source with date-relative fixtures', () => {
		const data = createMockData(new Date(2026, 8, 5))

		expect(data.configs.length).toBeGreaterThan(0)
		expect(data.definitions.length).toBeGreaterThan(0)
		expect(data.cardioActivities.length).toBeGreaterThan(0)
		expect(data.workoutSchedule[0].date).toBe('2026-09-05')
		expect(data.dayFlags.length).toBeGreaterThan(0)
		expect(data.logRows.length).toBeGreaterThan(0)
		expect(data.settings.size).toBeGreaterThan(0)
		expect(data.garminActivities.length).toBeGreaterThan(0)
		expect(data.wellnessEntries.length).toBeGreaterThan(0)
		expect(data.withingsMeasurements.length).toBeGreaterThan(0)
	})
})
