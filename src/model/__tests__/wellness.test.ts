import { describe, expect, it } from 'vitest';
import type { GarminWellnessEntry } from '../types.js';
import {
  buildTrainingLoadRatioChartData,
  formatWellnessRatio,
} from '../wellness.js';

function makeEntry(overrides: Partial<GarminWellnessEntry> = {}): GarminWellnessEntry {
  return {
    date: '2025-06-01',
    hrvLastNight: null,
    hrvWeeklyAvg: null,
    hrvStatus: '',
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
    ...overrides,
  };
}

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
  });
});

describe('formatWellnessRatio', () => {
  it('formats ratios with up to two decimals and trims trailing zeros', () => {
    expect(formatWellnessRatio(0.8)).toBe('0.8');
    expect(formatWellnessRatio(1.25)).toBe('1.25');
    expect(formatWellnessRatio(1)).toBe('1');
  });
});
