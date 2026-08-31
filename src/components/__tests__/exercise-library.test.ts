import { describe, it, expect } from 'vitest';
import { nameToId, DEFAULT_STRENGTH_CONFIG } from '../ExerciseLibrary.js';
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
/*  DEFAULT_STRENGTH_CONFIG                                            */
/* ------------------------------------------------------------------ */

describe('DEFAULT_STRENGTH_CONFIG', () => {
	it('has sensible default values', () => {
		expect(DEFAULT_STRENGTH_CONFIG.topSetWeight).toBeGreaterThan(0);
		expect(DEFAULT_STRENGTH_CONFIG.increment).toBeGreaterThan(0);
		expect(DEFAULT_STRENGTH_CONFIG.warmupRoundingFactor).toBe(5);
		expect(DEFAULT_STRENGTH_CONFIG.gear).toBe('barbell');
	});
});
