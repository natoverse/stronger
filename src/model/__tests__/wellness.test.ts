import { describe, expect, it } from 'vitest';
import type { GarminWellnessEntry } from '../types.js';
import {
  buildWellnessChartData,
  buildTrainingLoadRatioChartData,
  formatWellnessRatio,
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

    const june15 = data.buckets.find((bucket) => bucket.label === '15');
    const june16 = data.buckets.find((bucket) => bucket.label === '16');
    const june17 = data.buckets.find((bucket) => bucket.label === '17');

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

    expect(chart.buckets[0].value).toBeCloseTo(0.7);
    expect(chart.buckets[1].value).toBeCloseTo(0.8);
    expect(chart.buckets[2].value).toBeCloseTo(2);
    expect(chart.buckets[3].value).toBeNull();
    expect(chart.summary).toBeCloseTo((0.7 + 0.8 + 2) / 3);
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
