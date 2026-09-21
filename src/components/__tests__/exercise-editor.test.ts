import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExerciseEditor, parseTrainingMaxFields } from '../ExerciseEditor.js';
import { DEFAULT_STRENGTH_CONFIG } from '../ExerciseLibrary.js';

describe('optional shared training max inputs', () => {
	it('leaves fields absent so their defaults resolve without rewriting shared settings', () => {
		expect(parseTrainingMaxFields('', ' ')).toEqual({ fields: {}, errors: [] });
		expect(DEFAULT_STRENGTH_CONFIG).not.toHaveProperty('trainingMax');
		expect(DEFAULT_STRENGTH_CONFIG).not.toHaveProperty('trainingMaxIncrement');
	});

	it('saves TM and its own increment independently, including explicit zero', () => {
		expect(parseTrainingMaxFields('200', '2.5')).toEqual({
			fields: { trainingMax: 200, trainingMaxIncrement: 2.5 }, errors: [],
		});
		expect(parseTrainingMaxFields('200', '0')).toEqual({
			fields: { trainingMax: 200, trainingMaxIncrement: 0 }, errors: [],
		});
		expect(parseTrainingMaxFields('200', '')).toEqual({ fields: { trainingMax: 200 }, errors: [] });
	});

	it.each(['0', '-1', 'Infinity', 'NaN', 'abc'])('rejects invalid TM %s', (value) => {
		const result = parseTrainingMaxFields(value, '');
		expect(result.errors[0]).toContain('greater than zero, or left blank');
		expect(result.fields).not.toHaveProperty('trainingMax');
	});

	it.each(['-1', 'Infinity', 'NaN', '-'])('rejects invalid TM increment %s', (value) => {
		const result = parseTrainingMaxFields('', value);
		expect(result.errors[0]).toContain('Enter 0 for no increase');
		expect(result.fields).not.toHaveProperty('trainingMaxIncrement');
	});

	it('renders existing optional values, separate labels, and frozen-iteration explanation', () => {
		const config = { ...DEFAULT_STRENGTH_CONFIG, id: 'bench', name: 'Bench', trainingMax: 200, trainingMaxIncrement: 10 };
		const markup = renderToStaticMarkup(createElement(ExerciseEditor, {
			existing: config, allConfigs: [config], onSave: () => {}, onCancel: () => {},
		}));
		expect(markup).toContain('Training Max (TM, lbs) — optional');
		expect(markup).toContain('TM Increment (lbs) — optional');
		expect(markup).toContain('value="200"');
		expect(markup).toContain('value="10"');
		expect(markup).toContain('Pending prescriptions and unfinished sessions stay frozen');
	});
	it.each([
		['squat', 'Squat', 10],
		['bench-press', 'Bench Press', 5],
		['row', 'Row', 1],
	] as const)('explains the effective defaults for %s without storing them', (id, name, increment) => {
		const config = { ...DEFAULT_STRENGTH_CONFIG, id, name, topSetWeight: 200 };
		const markup = renderToStaticMarkup(createElement(ExerciseEditor, {
			existing: config, allConfigs: [config], onSave: () => {}, onCancel: () => {},
		}));
		expect(markup).toContain('placeholder="Default: 200 lbs (top set)"');
		expect(markup).toContain(`placeholder="Default: ${increment} lbs"`);
		expect(markup).toContain('Leave TM blank to use top-set weight');
		expect(config).not.toHaveProperty('trainingMax');
	});

	it('disables saving invalid persisted TM values with an actionable error', () => {
		const config = { ...DEFAULT_STRENGTH_CONFIG, id: 'bench', name: 'Bench', trainingMax: -1 };
		const markup = renderToStaticMarkup(createElement(ExerciseEditor, {
			existing: config, allConfigs: [config], onSave: () => {}, onCancel: () => {},
		}));
		expect(markup).toContain('greater than zero, or left blank');
		expect(markup).toMatch(/class="btn-finish" disabled=""/);
	});
});
