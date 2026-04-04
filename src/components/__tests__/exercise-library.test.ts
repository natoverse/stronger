import { describe, it, expect } from 'vitest';
import { nameToId, isCardioExercise, DEFAULT_STRENGTH_CONFIG } from '../ExerciseLibrary.js';
import type { LiftConfig } from '../../model/index.js';

/* ------------------------------------------------------------------ */
/*  nameToId – kebab-case slug generation                              */
/* ------------------------------------------------------------------ */

describe('nameToId', () => {
	it('converts a simple name to kebab-case', () => {
		expect(nameToId('Bench Press')).toBe('bench-press');
	});

	it('trims whitespace before converting', () => {
		expect(nameToId('  Bench Press  ')).toBe('bench-press');
	});

	it('strips non-alphanumeric characters', () => {
		expect(nameToId('Bicep Curl (EZ Bar)')).toBe('bicep-curl-ez-bar');
	});

	it('returns empty string for empty input', () => {
		expect(nameToId('')).toBe('');
	});
});

/* ------------------------------------------------------------------ */
/*  isCardioExercise – always returns false (no exercise-level cardio) */
/* ------------------------------------------------------------------ */

describe('isCardioExercise', () => {
	it('returns false for a typical strength exercise', () => {
		const strengthExercise: LiftConfig = {
			id: 'bench',
			name: 'Bench Press',
			topSetWeight: 200,
			backoffWeight: 170,
			increment: 2.5,
			minimumWeight: 95,
			roundingFactor: 5,
			barWeight: 45,
			gear: 'barbell',
		};
		expect(isCardioExercise(strengthExercise)).toBe(false);
	});

	it('returns false for a bodyweight exercise with all-zero weights', () => {
		const bodyweightExercise: LiftConfig = {
			id: 'chin-up',
			name: 'Chin-up',
			topSetWeight: 0,
			backoffWeight: 0,
			increment: 0,
			minimumWeight: 0,
			roundingFactor: 0,
			barWeight: 0,
			gear: 'bodyweight',
		};
		expect(isCardioExercise(bodyweightExercise)).toBe(false);
	});
});

/* ------------------------------------------------------------------ */
/*  DEFAULT_STRENGTH_CONFIG                                            */
/* ------------------------------------------------------------------ */

describe('DEFAULT_STRENGTH_CONFIG', () => {
	it('has sensible default values', () => {
		expect(DEFAULT_STRENGTH_CONFIG.topSetWeight).toBeGreaterThan(0);
		expect(DEFAULT_STRENGTH_CONFIG.increment).toBeGreaterThan(0);
		expect(DEFAULT_STRENGTH_CONFIG.gear).toBe('barbell');
	});
});
