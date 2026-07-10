import { describe, it, expect } from 'vitest'
import { parseWithingsRow, withingsMeasurementToRow, bodyGoalsFromSettings, bodyGoalsToSettings } from '../sheets.ts'
import type { WithingsMeasurement } from '../../model/types.ts'
import type { WithingsGoal } from '../../model/withings.ts'

/* ------------------------------------------------------------------ */
/*  parseWithingsRow                                                   */
/* ------------------------------------------------------------------ */

describe('parseWithingsRow', () => {
	it('parses a full row', () => {
		expect(
			parseWithingsRow(['2026-06-15', '1000', '80.2', '16', '20', '60', '3', '45']),
		).toEqual({
			date: '2026-06-15',
			grpId: '1000',
			weight: 80.2,
			fatMass: 16,
			fatRatio: 20,
			muscleMass: 60,
			boneMass: 3,
			hydration: 45,
		})
	})

	it('trims whitespace', () => {
		const result = parseWithingsRow([' 2026-06-15 ', ' 1000 ', ' 80.2 ', '', '', '', '', ''])
		expect(result).not.toBeNull()
		expect(result!.date).toBe('2026-06-15')
		expect(result!.grpId).toBe('1000')
		expect(result!.weight).toBe(80.2)
	})

	it('treats blank body-composition cells as null', () => {
		const result = parseWithingsRow(['2026-06-15', '1000', '80', '', '', '', '', ''])
		expect(result).not.toBeNull()
		expect(result!.fatMass).toBeNull()
		expect(result!.fatRatio).toBeNull()
		expect(result!.muscleMass).toBeNull()
		expect(result!.boneMass).toBeNull()
		expect(result!.hydration).toBeNull()
	})

	it('parses a weight-only row (short array)', () => {
		const result = parseWithingsRow(['2026-06-15', '1000', '80'])
		expect(result).not.toBeNull()
		expect(result!.weight).toBe(80)
		expect(result!.fatMass).toBeNull()
	})

	it('rejects a row with no weight', () => {
		expect(parseWithingsRow(['2026-06-15', '1000', ''])).toBeNull()
		expect(parseWithingsRow(['2026-06-15', '1000', '0'])).toBeNull()
	})

	it('rejects a row missing date or grpId', () => {
		expect(parseWithingsRow(['', '1000', '80', '', '', '', '', ''])).toBeNull()
		expect(parseWithingsRow(['2026-06-15', '', '80', '', '', '', '', ''])).toBeNull()
	})

	it('rejects a malformed date', () => {
		expect(parseWithingsRow(['06/15/2026', '1000', '80', '', '', '', '', ''])).toBeNull()
	})

	it('treats a negative body-composition value as absent', () => {
		const result = parseWithingsRow(['2026-06-15', '1000', '80', '-5', '20', '', '', ''])
		expect(result).not.toBeNull()
		expect(result!.fatMass).toBeNull()
		expect(result!.fatRatio).toBe(20)
	})
})

/* ------------------------------------------------------------------ */
/*  withingsMeasurementToRow                                           */
/* ------------------------------------------------------------------ */

describe('withingsMeasurementToRow', () => {
	it('serializes a full measurement', () => {
		const m: WithingsMeasurement = {
			date: '2026-06-15',
			grpId: '1000',
			weight: 80.2,
			fatMass: 16,
			fatRatio: 20,
			muscleMass: 60,
			boneMass: 3,
			hydration: 45,
		}
		expect(withingsMeasurementToRow(m)).toEqual([
			'2026-06-15', '1000', '80.2', '16', '20', '60', '3', '45',
		])
	})

	it('serializes null fields as empty cells', () => {
		const m: WithingsMeasurement = {
			date: '2026-06-15',
			grpId: '1000',
			weight: 80,
			fatMass: null,
			fatRatio: null,
			muscleMass: null,
			boneMass: null,
			hydration: null,
		}
		expect(withingsMeasurementToRow(m)).toEqual([
			'2026-06-15', '1000', '80', '', '', '', '', '',
		])
	})

	it('round-trips through parse', () => {
		const m: WithingsMeasurement = {
			date: '2026-06-15',
			grpId: '1000',
			weight: 80,
			fatMass: null,
			fatRatio: 18.5,
			muscleMass: 61,
			boneMass: null,
			hydration: 44,
		}
		expect(parseWithingsRow(withingsMeasurementToRow(m))).toEqual(m)
	})
})

/* ------------------------------------------------------------------ */
/*  body goal settings helpers                                         */
/* ------------------------------------------------------------------ */

describe('bodyGoalsFromSettings / bodyGoalsToSettings', () => {
	it('extracts body goals with the bodyGoal. prefix', () => {
		const settings = new Map<string, string>([
			['bodyGoal.weight', '75'],
			['bodyGoal.fatRatio', '15'],
			['goal.distance', '1500'], // Strava goal — must be ignored
			['unrelated', 'x'],
		])
		const goals = bodyGoalsFromSettings(settings)
		expect(goals).toEqual([
			{ metric: 'weight', value: 75 },
			{ metric: 'fatRatio', value: 15 },
		])
	})

	it('ignores invalid metrics and non-positive values', () => {
		const settings = new Map<string, string>([
			['bodyGoal.bogus', '10'],
			['bodyGoal.weight', '0'],
			['bodyGoal.muscleMass', '-5'],
		])
		expect(bodyGoalsFromSettings(settings)).toEqual([])
	})

	it('does not collide with Strava goal keys', () => {
		const goals: WithingsGoal[] = [{ metric: 'weight', value: 75 }]
		const settings = new Map<string, string>([['goal.distance', '1500']])
		bodyGoalsToSettings(goals, settings)
		expect(settings.get('goal.distance')).toBe('1500')
		expect(settings.get('bodyGoal.weight')).toBe('75')
	})

	it('replaces existing body goals', () => {
		const settings = new Map<string, string>([['bodyGoal.weight', '80']])
		bodyGoalsToSettings([{ metric: 'fatRatio', value: 15 }], settings)
		expect(settings.has('bodyGoal.weight')).toBe(false)
		expect(settings.get('bodyGoal.fatRatio')).toBe('15')
	})
})
