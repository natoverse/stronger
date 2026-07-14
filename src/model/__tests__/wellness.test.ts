import { describe, expect, it } from 'vitest';
import { buildWellnessChartData } from '../wellness.js';
import type { GarminWellnessEntry } from '../types.js';

function makeEntry(overrides: Partial<GarminWellnessEntry> = {}): GarminWellnessEntry {
  return {
    date: '2025-06-15',
    hrvLastNight: 45,
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
    ...overrides,
  };
}

describe('buildWellnessChartData', () => {
  it('uses weekly HRV values and same-row HRV status for day buckets', () => {
    const data = buildWellnessChartData(
      [
        makeEntry({ date: '2025-06-15', hrvLastNight: 44, hrvWeeklyAvg: 51, hrvStatus: 'BALANCED' }),
        makeEntry({ date: '2025-06-16', hrvLastNight: 41, hrvWeeklyAvg: 47, hrvStatus: 'LOW' }),
        makeEntry({ date: '2025-06-17', hrvLastNight: 48, hrvWeeklyAvg: 49, hrvStatus: 'UNBALANCED' }),
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
  });
});
