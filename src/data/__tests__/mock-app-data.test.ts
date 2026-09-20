import { describe, expect, it } from 'vitest'
import { createMockAppData } from '../mock-app-data.ts'
import { isMockMode } from '../mock-mode.ts'
import { buildSleepScheduleChartData } from '../../model/wellness.ts'

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

	it('populates sleep screenshots with midnight-crossing and overflowing windows', () => {
		const anchor = new Date(2026, 0, 3)
		const { garminWellness } = createMockAppData(anchor)
		const data = buildSleepScheduleChartData(garminWellness, 'month', 'day', anchor)
		const nights = data.buckets.filter((bucket) => bucket.min !== null)
		expect(nights).toHaveLength(7)
		expect(nights.some((bucket) => bucket.min! < 21 * 60)).toBe(true)
		expect(nights.some((bucket) => bucket.min! > 24 * 60)).toBe(true)
		expect(nights.some((bucket) => bucket.max! > 34 * 60)).toBe(true)
		expect(data.average?.min).toBeGreaterThan(21 * 60)
		expect(data.average?.max).toBeLessThan(34 * 60)
		for (const entry of garminWellness) {
			expect(new Date(entry.sleepEndTimestampLocal!).toISOString().slice(0, 10)).toBe(entry.date)
		}
	})
})
