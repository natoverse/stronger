import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../model/settings.js';
import type { Workout } from '../../model/types.js';
import { WorkoutView } from '../WorkoutView.js';

describe('workout set comments', () => {
	it('shows only notes and planned AMRAP tags, not generated prescription details', () => {
		const workout: Workout = {
			id: 'a',
			name: 'Workout A',
			favorite: false,
			exercises: [{
				liftId: 'squat',
				name: 'Squat',
				role: 'primary',
				sets: [
					{
						setType: 'work',
						weight: 150,
						minReps: 3,
						maxReps: 5,
						amrap: false,
						prescription: {
							setType: 'work',
							percentage: 0.75,
							weightBasis: { kind: 'topSet' },
							minReps: 3,
							maxReps: 5,
							amrap: false,
						},
					},
					{
						setType: 'work',
						weight: 170,
						minReps: 3,
						maxReps: 5,
						amrap: true,
						comment: 'Pause each rep',
						prescription: {
							setType: 'work',
							percentage: 0.85,
							weightBasis: { kind: 'trainingMax' },
							minReps: 3,
							maxReps: 5,
							amrap: true,
						},
					},
				],
			}],
		};

		const markup = renderToStaticMarkup(createElement(WorkoutView, {
			workout,
			startTime: '2026-10-13T22:00:00.000Z',
			appSettings: { ...DEFAULT_APP_SETTINGS, showRestTimer: false, keepScreenOn: false },
			configs: [],
			onBack: () => {},
			onFinish: () => {},
		}));

		expect(markup).not.toContain('75% topSet');
		expect(markup).not.toContain('85% Training max (TM)');
		expect(markup).not.toContain('3–5 reps');
		expect(markup).toContain('AMRAP · Pause each rep');
		expect(markup).not.toContain('class="set-comment">75%');
	});
});
