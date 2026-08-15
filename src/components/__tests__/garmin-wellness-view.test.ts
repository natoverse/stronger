import { describe, expect, it } from 'vitest';
import {
  TRAINING_STATUS_LEGEND_ITEMS,
  enduranceScoreLegendLabel,
  enduranceScoreColor,
  formatAltitudeFeet,
  formatTrainingStatusLabel,
  hillScoreLegendLabel,
  hillScoreColor,
  hrvStatusLegendLabel,
  hrvStatusColor,
  readinessLegendLabel,
  metersToFeet,
  trainingLoadRatioLegendLabel,
  trainingStatusColor,
  trainingStatusScore,
  vo2MaxLegendLabel,
  vo2MaxColor,
} from '../GarminWellnessView.js';

describe('altitude formatting', () => {
  it('converts Garmin altitude meters to rounded display feet', () => {
    expect(metersToFeet(1625)).toBeCloseTo(5331.365);
    expect(formatAltitudeFeet(1625)).toBe('5,331');
    expect(formatAltitudeFeet(null)).toBe('—');
  });
});

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
  it('orders the categorical scale from Peaking at 9 to No status at 1', () => {
    expect(TRAINING_STATUS_LEGEND_ITEMS).toHaveLength(9);
    expect(TRAINING_STATUS_LEGEND_ITEMS[0].label).toBe('Peaking');
    expect(TRAINING_STATUS_LEGEND_ITEMS.at(-1)?.label).toBe('No status');
    expect(trainingStatusScore('PEAKING')).toBe(9);
    expect(trainingStatusScore('NO_STATUS')).toBe(1);
    expect(trainingStatusScore('RECOVERY_ACTIVE')).toBe(trainingStatusScore('RECOVERY'));
    expect(trainingStatusScore('UNKNOWN')).toBeNull();
  });

  it('keeps legend swatch colors aligned with training status dots', () => {
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
