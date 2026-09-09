import { describe, expect, it } from 'vitest'
import { createMockAppData } from '../mock-app-data.ts'
import { isMockMode } from '../mock-mode.ts'

describe('mock review mode', () => {
	it('requires an explicit enabled query flag', () => {
		expect(isMockMode('?mock=1')).toBe(true)
		expect(isMockMode('?mock=true')).toBe(true)
		expect(isMockMode('?mock=0')).toBe(false)
		expect(isMockMode('')).toBe(false)
	})

	it('covers every application data source with dates relative to the anchor', () => {
		const data = createMockAppData(new Date(2026, 8, 5))

		expect(data.configs.length).toBeGreaterThan(0)
		expect(data.workoutDefinitions.length).toBeGreaterThan(0)
		expect(data.workouts.length).toBeGreaterThan(0)
		expect(data.workoutSchedule.some((entry) => entry.date === '2026-09-05')).toBe(true)
		expect(data.dayFlags.length).toBeGreaterThan(0)
		expect(data.logRows.length).toBeGreaterThan(0)
		expect(data.cardioActivities.length).toBeGreaterThan(0)
		expect(data.garminActivities.length).toBeGreaterThan(0)
		expect(data.garminWellness[data.garminWellness.length - 1]?.date).toBe('2026-09-05')
		expect(data.withingsMeasurements[data.withingsMeasurements.length - 1]?.date).toBe('2026-09-05')
		expect(data.stravaGoals.length).toBeGreaterThan(0)
		expect(data.withingsGoals.length).toBeGreaterThan(0)
		expect(data.liftGoals.length).toBeGreaterThan(0)
		expect(data.appSettings.showCalendarTab).toBe(true)
		expect(data.appSettings.showGarminTab).toBe(true)
	})
})
