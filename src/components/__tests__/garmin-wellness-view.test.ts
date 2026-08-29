import { describe, expect, it } from 'vitest';
import {
  TRAINING_STATUS_LEGEND_ITEMS,
  baselineDomain,
  centeredDomain,
  goalBarCap,
  goalSummaryLabel,
  enduranceScoreLegendLabel,
  enduranceScoreColor,
  formatAltitudeFeet,
  intensityGoalSummaryLabel,
  formatTrainingStatusLabel,
  hillScoreLegendLabel,
  hillScoreColor,
  hrvStatusLegendLabel,
  hrvStatusColor,
  overflowPatternColors,
  readinessLegendLabel,
  sleepGoalColor,
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
    expect(TRAINING_STATUS_LEGEND_ITEMS[TRAINING_STATUS_LEGEND_ITEMS.length - 1].label).toBe('No status');
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

  describe('sleep goal colors', () => {
    it('compares chart values in hours against the configured daily hours goal', () => {
      expect(sleepGoalColor(6, 7)).toBe('#ffea00');
      expect(sleepGoalColor(8, 7)).toBe('#00e676');
      expect(sleepGoalColor(9, 7)).toBe('#2196f3');
    });

    it('uses the daily goal for an averaged weekly bucket', () => {
      expect(sleepGoalColor((7 + 9) / 2, 7)).toBe('#00e676');
    });
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

describe('chart y-domains', () => {
  it('centers the domain on the current value and never dips below zero', () => {
    expect(centeredDomain(45, 10)).toEqual({ min: 35, max: 55 });
    expect(centeredDomain(52, 15)).toEqual({ min: 37, max: 67 });
    expect(centeredDomain(600, 1000)).toEqual({ min: 0, max: 1600 });
    expect(centeredDomain(null, 10)).toBeNull();
  });

  describe('overflow patterns', () => {
    it('uses the computed bar color for both hatch layers', () => {
      expect(overflowPatternColors('#ff1744')).toEqual({
        background: '#ff1744',
        line: '#ff1744',
      });
    });
  });

  it('pads the HRV baseline band by five on each side', () => {
    expect(
      baselineDomain(
        [
          { min: 40, max: 60 },
          { min: 38, max: 64 },
          { min: null, max: null },
        ],
        5,
      ),
    ).toEqual({ min: 33, max: 69 });
    expect(baselineDomain([{ min: null, max: null }], 5)).toBeNull();
  });

  it('scales goal caps by aggregation and disables them without a goal', () => {
    expect(goalBarCap(10000, 1.5, 'day')).toBe(15000);
    expect(goalBarCap(10000, 1.5, 'week')).toBe(105000);
    expect(goalBarCap(10, 3, 'day')).toBe(30);
    expect(goalBarCap(150 / 7, 2, 'day')).toBeCloseTo(42.857, 3);
    expect(goalBarCap(0, 1.5, 'day')).toBeNull();
  });

  it('formats activity goal chart summaries as current over goal', () => {
    expect(goalSummaryLabel(12345, 10000, 'day', 'steps', '')).toBe('12,345 / 10,000');
    expect(goalSummaryLabel(8, 10, 'week', 'floors', '')).toBe('8 / 70');
    expect(goalSummaryLabel(8, 0, 'day', 'floors', '')).toBe('8');
  });

  it('formats intensity summaries as current with week total over weekly goal', () => {
    expect(intensityGoalSummaryLabel(25, 125, 150)).toBe('25 - 125 / 150 min');
    expect(intensityGoalSummaryLabel(25, null, 150)).toBe('25 min');
    expect(intensityGoalSummaryLabel(25, 125, 0)).toBe('25 min');
  });
});
