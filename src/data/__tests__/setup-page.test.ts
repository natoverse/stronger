import { describe, expect, it } from 'vitest';
import { roundToNearest } from '../../model/index.js';
import type { LiftConfig } from '../../model/index.js';
import exercisesJson from '../../../lib/exercises.json';

/** Lift configs sourced from the JSON library — same source as SetupPage. */
const libraryDefaults: LiftConfig[] = exercisesJson as LiftConfig[];

/** Backoff weight = 85% of top-set, rounded to the lift's rounding factor. */
function deriveBackoff(topSetWeight: number, roundingFactor: number): number {
	return roundToNearest(topSetWeight * 0.85, roundingFactor);
}

/** The four barbell lift IDs shown on the setup page. */
const BARBELL_LIFT_IDS = ['squat', 'bench-press', 'overhead-press', 'deadlift'];

describe('setup page logic', () => {
	describe('deriveBackoff', () => {
		it('derives bench backoff from top-set (200 → 170)', () => {
			expect(deriveBackoff(200, 5)).toBe(170);
		});

		it('derives squat backoff from top-set (300 → 255)', () => {
			expect(deriveBackoff(300, 5)).toBe(255);
		});

		it('derives press backoff from top-set (140 → 120)', () => {
			// 140 * 0.85 = 119, roundToNearest(119, 2.5) = 120
			expect(deriveBackoff(140, 2.5)).toBe(120);
		});

		it('derives deadlift backoff from top-set (350 → 300)', () => {
			// 350 * 0.85 = 297.5, roundToNearest(297.5, 5) = 300
			expect(deriveBackoff(350, 5)).toBe(300);
		});

		it('handles zero top-set weight', () => {
			expect(deriveBackoff(0, 5)).toBe(0);
		});

		it('rounds to 2.5 correctly', () => {
			// 100 * 0.85 = 85 → rounds to 85
			expect(deriveBackoff(100, 2.5)).toBe(85);
			// 115 * 0.85 = 97.75 → roundToNearest(97.75, 2.5) = 97.5
			expect(deriveBackoff(115, 2.5)).toBe(97.5);
		});
	});

	describe('barbell lift defaults', () => {
		it('JSON library includes all four barbell lifts', () => {
			for (const id of BARBELL_LIFT_IDS) {
				const found = libraryDefaults.find((c) => c.id === id);
				expect(found).toBeDefined();
			}
		});

		it('each barbell lift default backoff matches 85% derivation', () => {
			for (const id of BARBELL_LIFT_IDS) {
				const config = libraryDefaults.find((c) => c.id === id)!;
				expect(config.backoffWeight).toBe(
					deriveBackoff(config.topSetWeight, config.roundingFactor),
				);
			}
		});
	});

	describe('config building', () => {
		it('builds configs with user-edited barbell weights and default accessories', () => {
			const userWeights: Record<string, number> = {
				squat: 250,
				'bench-press': 185,
				'overhead-press': 120,
				deadlift: 315,
			};

			const configs = libraryDefaults.map((c) => {
				if (!BARBELL_LIFT_IDS.includes(c.id)) return c;
				const topSetWeight = userWeights[c.id] ?? c.topSetWeight;
				const backoffWeight = deriveBackoff(topSetWeight, c.roundingFactor);
				return { ...c, topSetWeight, backoffWeight };
			});

			// Barbell lifts should use user weights
			const squat = configs.find((c) => c.id === 'squat')!;
			expect(squat.topSetWeight).toBe(250);
			expect(squat.backoffWeight).toBe(deriveBackoff(250, 5)); // 212.5 → 215

			const bench = configs.find((c) => c.id === 'bench-press')!;
			expect(bench.topSetWeight).toBe(185);
			expect(bench.backoffWeight).toBe(deriveBackoff(185, 5)); // 157.25 → 155

			const press = configs.find((c) => c.id === 'overhead-press')!;
			expect(press.topSetWeight).toBe(120);
			expect(press.backoffWeight).toBe(deriveBackoff(120, 2.5)); // 102

			const deadlift = configs.find((c) => c.id === 'deadlift')!;
			expect(deadlift.topSetWeight).toBe(315);
			expect(deadlift.backoffWeight).toBe(deriveBackoff(315, 5)); // 267.75 → 270

			// Accessory lifts should keep defaults
			const skullCrusher = configs.find((c) => c.id === 'skull-crusher')!;
			expect(skullCrusher.topSetWeight).toBe(60);
			expect(skullCrusher.backoffWeight).toBe(50);
		});

		it('preserves all default lift configs in output', () => {
			const configs = libraryDefaults.map((c) => {
				if (!BARBELL_LIFT_IDS.includes(c.id)) return c;
				return { ...c, topSetWeight: c.topSetWeight, backoffWeight: deriveBackoff(c.topSetWeight, c.roundingFactor) };
			});
			expect(configs).toHaveLength(libraryDefaults.length);
		});
	});
});
