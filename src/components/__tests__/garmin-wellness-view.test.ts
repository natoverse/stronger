import { describe, expect, it } from 'vitest';
import {
  TRAINING_STATUS_LEGEND_ITEMS,
  enduranceScoreLegendLabel,
  enduranceScoreColor,
  formatTrainingStatusLabel,
  hillScoreLegendLabel,
  hillScoreColor,
  hrvStatusLegendLabel,
  hrvStatusColor,
  readinessLegendLabel,
  trainingLoadRatioLegendLabel,
  trainingStatusColor,
  vo2MaxLegendLabel,
  vo2MaxColor,
} from '../GarminWellnessView.js';

describe('hrvStatusColor', () => {
  it('maps balanced, low, and unbalanced HRV statuses to the requested colors', () => {
    expect(hrvStatusColor('BALANCED')).toBe('#00e676');
    expect(hrvStatusColor('LOW')).toBe('#ff1744');
    expect(hrvStatusColor('UNBALANCED')).toBe('#ffea00');
  });
});

describe('vo2MaxColor', () => {
  it('maps VO2 max thresholds to the expected palette', () => {
    expect(vo2MaxColor(38.4)).toBe('#ff1744');
    expect(vo2MaxColor(38.5)).toBe('#ffab40');
    expect(vo2MaxColor(42.4)).toBe('#ffab40');
    expect(vo2MaxColor(42.5)).toBe('#00e676');
    expect(vo2MaxColor(46.4)).toBe('#2196f3');
    expect(vo2MaxColor(52.5)).toBe('#d500f9');
  });
});

describe('hillScoreColor', () => {
  it('maps hill score thresholds to the expected palette', () => {
    expect(hillScoreColor(24.9)).toBe('#ff1744');
    expect(hillScoreColor(25)).toBe('#ffab40');
    expect(hillScoreColor(50)).toBe('#00e676');
    expect(hillScoreColor(69)).toBe('#2196f3');
    expect(hillScoreColor(85)).toBe('#d500f9');
    expect(hillScoreColor(95)).toBe('#ff2d7b');
  });
});

describe('enduranceScoreColor', () => {
  it('maps endurance score thresholds to the expected palette', () => {
    expect(enduranceScoreColor(4999)).toBe('#ff1744');
    expect(enduranceScoreColor(5000)).toBe('#ffab40');
    expect(enduranceScoreColor(5700)).toBe('#ffea00');
    expect(enduranceScoreColor(6400)).toBe('#00e676');
    expect(enduranceScoreColor(7000)).toBe('#2196f3');
    expect(enduranceScoreColor(7700)).toBe('#d500f9');
    expect(enduranceScoreColor(8400)).toBe('#ff2d7b');
  });
});

describe('training status legend', () => {
  it('keeps legend swatch colors aligned with training status bars', () => {
    for (const item of TRAINING_STATUS_LEGEND_ITEMS) {
      expect(item.color).toBe(trainingStatusColor(item.status));
    }
  });

  it('formats underscored training statuses for display', () => {
    expect(formatTrainingStatusLabel('RECOVERY_ACTIVE')).toBe('Recovery active');
    expect(formatTrainingStatusLabel('')).toBe('—');
  });
});

describe('wellness legend labels', () => {
  it('derives readiness and load ratio labels from numeric values', () => {
    expect(readinessLegendLabel(20)).toBe('Poor');
    expect(readinessLegendLabel(95)).toBe('Prime');
    expect(trainingLoadRatioLegendLabel(0.7)).toBe('Low');
    expect(trainingLoadRatioLegendLabel(1.1)).toBe('Optimal');
    expect(trainingLoadRatioLegendLabel(1.5)).toBe('High');
  });

  it('derives VO2, hill, and endurance labels from numeric values', () => {
    expect(vo2MaxLegendLabel(52.5)).toBe('Superior');
    expect(hillScoreLegendLabel(68.9)).toBe('Trained');
    expect(hillScoreLegendLabel(95)).toBe('Elite');
    expect(enduranceScoreLegendLabel(8399)).toBe('Superior');
    expect(enduranceScoreLegendLabel(8400)).toBe('Elite');
  });

  it('formats HRV status labels from sheet status text', () => {
    expect(hrvStatusLegendLabel('UNBALANCED')).toBe('Unbalanced');
    expect(hrvStatusLegendLabel('')).toBe('Unknown');
  });
});
