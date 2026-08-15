import { describe, expect, it } from 'vitest';
import type { GarminWellnessEntry } from '../types.js';
import {
  buildWellnessChartData,
  buildTrainingLoadRatioChartData,
  buildLoadFocusChartData,
  buildHrvRangeChartData,
  formatWellnessRatio,
  formatWellnessValue,
} from '../wellness.js';

function makeEntry(overrides: Partial<GarminWellnessEntry> = {}): GarminWellnessEntry {
  return {
    date: '2025-06-15',
    hrvWeeklyAvg: 52,
    hrvStatus: 'BALANCED',
    sleepDurationSec: null,
    sleepDeepSec: null,
    sleepLightSec: null,
    sleepRemSec: null,
    sleepAwakeSec: null,
    sleepScore: null,
    bodyBatteryHigh: null,
    bodyBatteryLow: null,
    readinessScore: null,
    trainingStatus: '',
    trainingAcuteLoad: null,
    trainingChronicLoad: null,
    steps: null,
    floors: null,
    restingHR: null,
    vo2Max: null,
    intensityMinModerate: null,
    intensityMinVigorous: null,
    hillScore: null,
    enduranceScore: null,
    heatAcclimationPct: null,
    altitudeAcclimationPct: null,
    currentAltitude: null,
    activeCalories: null,
    bmrCalories: null,
    avgStress: null,
    loadFocusAerobicLow: null,
    loadFocusAerobicLowMin: null,
    loadFocusAerobicLowMax: null,
    loadFocusAerobicHigh: null,
    loadFocusAerobicHighMin: null,
    loadFocusAerobicHighMax: null,
    loadFocusAnaerobic: null,
    loadFocusAnaerobicMin: null,
    loadFocusAnaerobicMax: null,
    hrvBaselineMin: null,
    hrvBaselineMax: null,
    ...overrides,
  };
}

describe('buildWellnessChartData', () => {
  it('uses weekly HRV values and same-row HRV status for day buckets', () => {
    const data = buildWellnessChartData(
      [
        makeEntry({ date: '2025-06-15', hrvWeeklyAvg: 51, hrvStatus: 'BALANCED' }),
        makeEntry({ date: '2025-06-16', hrvWeeklyAvg: 47, hrvStatus: 'LOW' }),
        makeEntry({ date: '2025-06-17', hrvWeeklyAvg: 49, hrvStatus: 'UNBALANCED' }),
      ],
      'hrvWeeklyAvg',
      'month',
      'day',
      new Date('2025-06-20T00:00:00'),
      'hrvStatus',
    );

    const june15 = data.buckets.find((bucket) => bucket.label === '6/15');
    const june16 = data.buckets.find((bucket) => bucket.label === '6/16');
    const june17 = data.buckets.find((bucket) => bucket.label === '6/17');

    expect(june15).toMatchObject({ value: 51, colorKey: 'BALANCED' });
    expect(june16).toMatchObject({ value: 47, colorKey: 'LOW' });
    expect(june17).toMatchObject({ value: 49, colorKey: 'UNBALANCED' });
    expect(data.summary).toBe(49);
    expect(data.latestValue).toBe(49);
  });
});

describe('buildTrainingLoadRatioChartData', () => {
  it('builds per-bucket acute/chronic ratios for the selected range', () => {
    const today = new Date(2025, 5, 15);
    const entries = [
      makeEntry({ date: '2025-06-01', trainingAcuteLoad: 70, trainingChronicLoad: 100 }),
      makeEntry({ date: '2025-06-02', trainingAcuteLoad: 80, trainingChronicLoad: 100 }),
      makeEntry({ date: '2025-06-03', trainingAcuteLoad: 200, trainingChronicLoad: 100 }),
      makeEntry({ date: '2025-06-04', trainingAcuteLoad: 120, trainingChronicLoad: 0 }),
      makeEntry({ date: '2025-05-31', trainingAcuteLoad: 999, trainingChronicLoad: 1 }),
    ];

    const chart = buildTrainingLoadRatioChartData(entries, 'month', 'day', today);

    expect(chart.buckets.find((bucket) => bucket.label === '6/1')?.value).toBeCloseTo(0.7);
    expect(chart.buckets.find((bucket) => bucket.label === '6/2')?.value).toBeCloseTo(0.8);
    expect(chart.buckets.find((bucket) => bucket.label === '6/3')?.value).toBeCloseTo(2);
    expect(chart.buckets.find((bucket) => bucket.label === '6/4')?.value).toBeNull();
    expect(chart.buckets.find((bucket) => bucket.label === '5/31')?.value).toBeCloseTo(999);
    expect(chart.summary).toBeCloseTo((999 + 0.7 + 0.8 + 2) / 4);
    expect(chart.latestValue).toBeCloseTo(2);
  });

  it('uses aggregated acute and chronic values before taking the ratio', () => {
    const today = new Date(2025, 5, 15);
    const entries = [
      makeEntry({ date: '2025-06-02', trainingAcuteLoad: 100, trainingChronicLoad: 200 }),
      makeEntry({ date: '2025-06-03', trainingAcuteLoad: 200, trainingChronicLoad: 100 }),
    ];

    const chart = buildTrainingLoadRatioChartData(entries, 'month', 'week', today);
    const populatedBucket = chart.buckets.find((bucket) => bucket.value !== null);

    expect(populatedBucket?.value).toBeCloseTo(1);
    expect(chart.summary).toBeCloseTo(1);
    expect(chart.latestValue).toBeCloseTo(1);
  });
});

describe('formatWellnessRatio', () => {
  it('formats ratios with up to two decimals and trims trailing zeros', () => {
    expect(formatWellnessRatio(0.8)).toBe('0.8');
    expect(formatWellnessRatio(1.25)).toBe('1.25');
    expect(formatWellnessRatio(1)).toBe('1');
  });
});

describe('formatWellnessValue', () => {
  it('formats hill and endurance scores as whole numbers', () => {
    expect(formatWellnessValue(68.9, 'hillScore')).toBe('69');
    expect(formatWellnessValue(8399.4, 'enduranceScore')).toBe('8399');
  });

  it('keeps VO2 max at one decimal place', () => {
    expect(formatWellnessValue(52, 'vo2Max')).toBe('52.0');
  });
});

describe('buildLoadFocusChartData', () => {
  it('zips per-day load value with its optimal min/max range', () => {
    const today = new Date('2025-06-20T00:00:00');
    const entries = [
      makeEntry({
        date: '2025-06-18',
        loadFocusAerobicLow: 320,
        loadFocusAerobicLowMin: 200,
        loadFocusAerobicLowMax: 400,
      }),
      makeEntry({
        date: '2025-06-19',
        loadFocusAerobicLow: 450,
        loadFocusAerobicLowMin: 210,
        loadFocusAerobicLowMax: 420,
      }),
    ];

    const chart = buildLoadFocusChartData(entries, 'aerobicLow', 'month', 'day', today);
    const jun18 = chart.buckets.find((b) => b.label === '6/18');
    const jun19 = chart.buckets.find((b) => b.label === '6/19');

    expect(jun18).toMatchObject({ value: 320, min: 200, max: 400 });
    expect(jun19).toMatchObject({ value: 450, min: 210, max: 420 });
    // Latest non-null day drives header value + range.
    expect(chart.latestValue).toBe(450);
    expect(chart.latestMin).toBe(210);
    expect(chart.latestMax).toBe(420);
  });

  describe('buildHrvRangeChartData', () => {
    it('zips HRV values and statuses with the personal baseline range', () => {
      const chart = buildHrvRangeChartData(
        [
          makeEntry({
            date: '2025-06-18',
            hrvWeeklyAvg: 46,
            hrvStatus: 'LOW',
            hrvBaselineMin: 48,
            hrvBaselineMax: 62,
          }),
          makeEntry({
            date: '2025-06-19',
            hrvWeeklyAvg: 53,
            hrvStatus: 'BALANCED',
            hrvBaselineMin: 49,
            hrvBaselineMax: 63,
          }),
        ],
        'month',
        'day',
        new Date('2025-06-20T00:00:00'),
      );

      expect(chart.buckets.find((bucket) => bucket.label === '6/18')).toMatchObject({
        value: 46,
        min: 48,
        max: 62,
        colorKey: 'LOW',
      });
      expect(chart.buckets.find((bucket) => bucket.label === '6/19')).toMatchObject({
        value: 53,
        min: 49,
        max: 63,
        colorKey: 'BALANCED',
      });
      expect(chart.latestMin).toBe(49);
      expect(chart.latestMax).toBe(63);
    });

    it('averages both baseline bounds within aggregate buckets', () => {
      const chart = buildHrvRangeChartData(
        [
          makeEntry({ date: '2025-06-16', hrvBaselineMin: 44, hrvBaselineMax: 58 }),
          makeEntry({ date: '2025-06-18', hrvBaselineMin: 46, hrvBaselineMax: 60 }),
        ],
        'month',
        'week',
        new Date('2025-06-20T00:00:00'),
      );
      const populated = chart.buckets.find((bucket) => bucket.min !== null);

      expect(populated?.min).toBe(45);
      expect(populated?.max).toBe(59);
    });
  });

  it('averages load values within a week/month bucket', () => {
    const today = new Date('2025-06-20T00:00:00');
    const entries = [
      makeEntry({ date: '2025-06-16', loadFocusAnaerobic: 100, loadFocusAnaerobicMin: 50, loadFocusAnaerobicMax: 150 }),
      makeEntry({ date: '2025-06-18', loadFocusAnaerobic: 200, loadFocusAnaerobicMin: 60, loadFocusAnaerobicMax: 160 }),
    ];

    const chart = buildLoadFocusChartData(entries, 'anaerobic', 'month', 'week', today);
    const populated = chart.buckets.find((b) => b.value !== null);
    expect(populated?.value).toBeCloseTo(150);
  });
});
