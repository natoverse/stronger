import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProgressionReview } from '../ProgressionReview.js';

describe('cycle finish confirmation', () => {
	it('explains independent next stages, repeated incomplete work, and explicit TM review', () => {
		const html = renderToStaticMarkup(createElement(ProgressionReview, {
			proposals: [], completedSets: 5, totalSets: 6, onConfirm: () => {}, onBack: () => {},
			trainingMaxProposals: [{ liftId: 'bench', liftName: 'Bench', current: 200, proposed: 205, increment: 5 }],
			transitions: [
				{ exerciseId: 'bench', name: 'Bench', current: 'Week 4/4', next: 'Iteration 2 · Week 1/4', completed: true, boundary: true },
				{ exerciseId: 'squat', name: 'Squat', current: 'Week 2/4', next: 'Week 2/4', completed: false, boundary: false },
			],
		}));
		expect(html).toContain('repeat this entire prescription');
		expect(html).toContain('Iteration complete');
		expect(html).toContain('Keep training max');
		expect(html).toContain('value="205"');
		expect(html).toContain('Confirm');
		expect(html).not.toContain('Finish cycle');
	});
	it('disables confirmation while saving and displays actionable errors', () => {
		const html = renderToStaticMarkup(createElement(ProgressionReview, {
			proposals: [], completedSets: 1, totalSets: 1, onConfirm: () => {}, onBack: () => {},
			saving: true, error: 'Cycle changed on another device.',
		}));
		expect(html).toContain('Saving…');
		expect(html).toContain('disabled');
		expect(html).toContain('role="alert"');
	});
});
