import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { GarminWellnessEntry } from '../../model/types.js';
import {
  GarminWellnessView,
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

vi.mock('../../hooks/useChartTooltip.js', () => ({
  useChartTooltip: () => ({ activeIndex: 0, svgRef: { current: null }, containerHandlers: {} }),
}));

describe('GarminWellnessView', () => {
  const entry: GarminWellnessEntry = {
    date: '2025-01-01',
    sleepStartTimestampLocal: Date.parse('2024-12-31T23:15:00Z'),
    sleepEndTimestampLocal: Date.parse('2025-01-01T07:05:00Z'),
    sleepDurationSec: 7 * 3600,
    sleepDeepSec: null, sleepLightSec: null, sleepRemSec: null, sleepAwakeSec: null,
    sleepScore: null,
    bodyBatteryHigh: 90, bodyBatteryLow: 20,
    hrvWeeklyAvg: null, hrvStatus: '',
    readinessScore: null, trainingStatus: '',
    trainingAcuteLoad: null, trainingChronicLoad: null,
    steps: null, floors: null, restingHR: null, vo2Max: null,
    intensityMinModerate: null, intensityMinVigorous: null,
    hillScore: null, enduranceScore: null,
    heatAcclimationPct: null, altitudeAcclimationPct: null, currentAltitude: null,
    activeCalories: null, bmrCalories: null, avgStress: null,
    lactateThresholdHr: null, lactateThresholdSpeed: null, lactateThresholdPower: null,
    fitnessAge: null, maxHrEstimate: null,
    loadFocusAerobicLow: null, loadFocusAerobicLowMin: null, loadFocusAerobicLowMax: null,
    loadFocusAerobicHigh: null, loadFocusAerobicHighMin: null, loadFocusAerobicHighMax: null,
    loadFocusAnaerobic: null, loadFocusAnaerobicMin: null, loadFocusAnaerobicMax: null,
    hrvBaselineMin: null, hrvBaselineMax: null,
  };

  function render(aggregation: 'day' | 'week' | 'month', entries = [entry], range = '2025') {
    return renderToStaticMarkup(createElement(GarminWellnessView, { entries, range, aggregation }));
  }

  const sparseHeaders = [
    ['VO₂ Max (Running)', '45.0 mL/kg/min'],
    ['Lactate Threshold HR', '165 bpm'],
    ['Lactate Threshold Pace', '8:24 /mi'],
    ['Lactate Threshold Power', '300 W'],
  ];
  const oldReading = {
    ...entry, date: '2024-12-31', vo2Max: 45,
    lactateThresholdHr: 165, lactateThresholdSpeed: 3.19, lactateThresholdPower: 300,
    restingHR: 60,
  };
  const chartCard = (markup: string, title: string) =>
    markup.split('class="strava-chart-card"').find((card) => card.includes(title))!;

  it.each(['day', 'week', 'month'] as const)(
    'shows prior sparse readings only in headers for %s aggregation',
    (aggregation) => {
      const markup = render(aggregation, [entry, oldReading, { ...oldReading, date: '2026-01-01', vo2Max: 60 }]);
      for (const [title, value] of sparseHeaders) {
        const card = chartCard(markup, title);
        expect(card).toContain(`class="strava-chart-total">${value}`);
        expect(card).not.toContain('<circle');
        expect(card).toContain('class="chart-tooltip-value">—');
      }
      if (aggregation === 'day') {
        expect(chartCard(markup, 'VO₂ Max (Running)')).toContain('45.0 mL/kg/min · Good');
      }
      expect(chartCard(markup, 'Resting Heart Rate')).not.toContain('class="strava-chart-total"');
    },
  );

  it.each(['day', 'week', 'month'] as const)(
    'preserves in-range latest values and averages for %s aggregation',
    (aggregation) => {
      const markup = render(aggregation, [
        oldReading,
        { ...oldReading, date: '2025-01-01', vo2Max: 50, lactateThresholdHr: 170 },
        { ...oldReading, date: '2025-01-02', vo2Max: 54, lactateThresholdHr: 174 },
      ]);
      expect(chartCard(markup, 'VO₂ Max (Running)')).toContain(
        `class="strava-chart-total">${aggregation === 'day' ? '54.0' : '52.0'} mL/kg/min`,
      );
      expect(chartCard(markup, 'Lactate Threshold HR')).toContain(
        `class="strava-chart-total">${aggregation === 'day' ? '174' : '172'} bpm`,
      );
    },
  );

  it('does not invent headers when no eligible historical readings exist', () => {
    const markup = render('day', [entry, { ...oldReading, date: '2026-01-01' }]);
    for (const [title] of sparseHeaders) {
      expect(chartCard(markup, title)).not.toContain('class="strava-chart-total"');
    }
  });

  it('renders local header/hover times and clock ticks without changing Body Battery or sleep duration', () => {
    const markup = render('day');
    const sleepCard = markup.split('class="strava-chart-card"').find((card) => card.includes('Sleep Schedule'))!;
    expect(sleepCard).toContain('11:15 PM–7:05 AM');
    expect(sleepCard).toContain('class="chart-tooltip-value">11:15 PM–7:05 AM');
    expect(sleepCard).toContain('class="chart-tooltip-date">1/1');
    expect(sleepCard).toContain('12:00 AM');
    expect(sleepCard).toContain('9:00 PM');
    expect(sleepCard).toContain('10:00 AM');
    expect(sleepCard).not.toContain('6:00 PM');
    expect(sleepCard).not.toContain('12:00 PM');
    expect(sleepCard).toContain('aria-label="Sleep Schedule"');
    expect(sleepCard).toContain('<rect');
    const batteryCard = markup.split('class="strava-chart-card"').find((card) => card.includes('Body Battery Range'))!;
    expect(batteryCard).toContain('20–90');
    const durationCard = markup.split('class="strava-chart-card"').find((card) => card.includes('Sleep Duration'))!;
    expect(durationCard).toContain('7h');
    expect(markup).not.toContain('NaN');
  });

  it.each(['week', 'month'] as const)('labels averaged %s headers', (aggregation) => {
    expect(render(aggregation)).toContain('Avg 11:15 PM–7:05 AM');
  });

  it('leaves legacy sleep windows empty rather than drawing zero-valued bars', () => {
    const markup = render('day', [{ ...entry, sleepStartTimestampLocal: null }]);
    const sleepCard = markup.split('class="strava-chart-card"').find((card) => card.includes('Sleep Schedule'))!;
    expect(sleepCard).not.toContain('<rect');
    expect(sleepCard).not.toContain('strava-goal-line');
    expect(sleepCard).toContain('class="chart-tooltip-value">—');
  });

  it.each([
    ['2024-12-31T20:30:00Z', '2025-01-01T07:00:00Z'],
    ['2024-12-31T23:00:00Z', '2025-01-01T10:30:00Z'],
    ['2024-12-31T20:30:00Z', '2025-01-01T10:30:00Z'],
    ['2025-01-01T12:30:00Z', '2025-01-01T20:00:00Z'],
    ['2025-01-01T10:30:00Z', '2025-01-01T11:30:00Z'],
  ])('hatches and bounds outlying bars from %s to %s', (start, end) => {
    const markup = render('day', [{
      ...entry, sleepStartTimestampLocal: Date.parse(start), sleepEndTimestampLocal: Date.parse(end),
    }]);
    const sleepCard = markup.split('class="strava-chart-card"').find((card) => card.includes('Sleep Schedule'))!;
    const bar = sleepCard.match(/<rect[^>]+fill="url\(#[^"]+\)"[^>]*>/)![0];
    const top = Number(bar.match(/ y="([^"]+)"/)![1]);
    const height = Number(bar.match(/ height="([^"]+)"/)![1]);
    expect(top).toBeGreaterThanOrEqual(16);
    expect(top + height).toBeLessThanOrEqual(100);
    expect(height).toBeGreaterThan(0);
    expect(sleepCard).toContain('9:00 PM');
    expect(sleepCard).toContain('10:00 AM');
  });

  it('does not hatch bars exactly on the axis bounds', () => {
    const markup = render('day', [{
      ...entry,
      sleepStartTimestampLocal: Date.parse('2024-12-31T21:00:00Z'),
      sleepEndTimestampLocal: Date.parse('2025-01-01T10:00:00Z'),
    }]);
    const sleepCard = markup.split('class="strava-chart-card"').find((card) => card.includes('Sleep Schedule'))!;
    expect(sleepCard).not.toContain('<pattern');
    expect(sleepCard.match(/class="strava-goal-line"/g)).toHaveLength(2);
  });

  it.each(['day', 'week', 'month'] as const)('uses range-filtered per-night averages for %s boundaries', (aggregation) => {
    const entries = [
      ['2024-12-31T22:00:00Z', '2025-01-01T06:00:00Z'],
      ['2025-01-01T22:00:00Z', '2025-01-02T06:00:00Z'],
      ['2025-02-01T01:00:00Z', '2025-02-01T09:00:00Z'],
      ['2023-12-31T21:00:00Z', '2024-01-01T10:00:00Z'],
    ].map(([start, end]) => ({
      ...entry, sleepStartTimestampLocal: Date.parse(start), sleepEndTimestampLocal: Date.parse(end),
    }));
    const sleepCard = render(aggregation, entries).split('class="strava-chart-card"').find((card) => card.includes('Sleep Schedule'))!;
    expect(sleepCard).toContain('class="strava-goal-line" aria-label="Average start: 11:00 PM"');
    expect(sleepCard).toContain('class="strava-goal-line" aria-label="Average end: 7:00 AM"');
    expect(sleepCard).toContain('fill="rgba(255,255,255,0.25)" opacity="0.3"');
    const otherRange = render(aggregation, entries, '2024').split('class="strava-chart-card"').find((card) => card.includes('Sleep Schedule'))!;
    expect(otherRange).toContain('aria-label="Average start: 9:00 PM"');
    expect(otherRange).toContain('aria-label="Average end: 10:00 AM"');
  });
});

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

  it('formats HRV status labels from stored status text', () => {
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
    expect(goalSummaryLabel(12345, 10000, 'day', 'steps', '')).toBe('12345 / 10000');
    // Weekly aggregation compares against seven daily floor goals.
    expect(goalSummaryLabel(8, 10, 'week', 'floors', '')).toBe('8 / 70');
    expect(goalSummaryLabel(8, 0, 'day', 'floors', '')).toBe('8');
  });

  it('formats intensity summaries as current with week total over weekly goal', () => {
    expect(intensityGoalSummaryLabel(25, 125, 150)).toBe('25 - 125 / 150 min');
    expect(intensityGoalSummaryLabel(25, null, 150)).toBe('25 min');
    expect(intensityGoalSummaryLabel(25, 125, 0)).toBe('25 min');
  });
});
