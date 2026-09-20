import { describe, expect, it, vi } from 'vitest';
import type { GarminWellnessEntry } from '../types.js';
import {
  buildWellnessChartData,
  buildIntensityMinCombinedChartData,
  buildTrainingLoadRatioChartData,
  buildLoadFocusChartData,
  buildHrvRangeChartData,
  buildSleepScheduleChartData,
  formatSleepTime,
  formatSleepScheduleRange,
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
    lactateThresholdHr: null,
    lactateThresholdSpeed: null,
    lactateThresholdPower: null,
    fitnessAge: null,
    maxHrEstimate: null,
    ...overrides,
  };
}

describe('sleep schedule', () => {
  function night(start: string, end: string, overrides: Partial<GarminWellnessEntry> = {}) {
    return makeEntry({
      sleepStartTimestampLocal: Date.parse(`${start}Z`),
      sleepEndTimestampLocal: Date.parse(`${end}Z`),
      ...overrides,
    });
  }
  const today = new Date(2025, 5, 20);

  it('keeps overnight bars continuous and assigns them to the local wake date', () => {
    const data = buildSleepScheduleChartData([
      night('2025-06-14T23:15:00', '2025-06-15T07:05:00', { date: '2025-06-14' }),
    ], 'month', 'day', today);
    expect(data.buckets.find((b) => b.label === '6/14')?.min).toBeNull();
    expect(data.buckets.find((b) => b.label === '6/15')).toEqual({
      label: '6/15', min: 1395, max: 1865,
    });
    expect(formatSleepScheduleRange(data.latest)).toBe('11:15 PM–7:05 AM');
  });

  it.each(['week', 'month'] as const)('averages bedtimes across midnight for %s', (aggregation) => {
    const data = buildSleepScheduleChartData([
      night('2025-06-16T23:30:00', '2025-06-17T07:00:00'),
      night('2025-06-18T00:30:00', '2025-06-18T08:00:00'),
    ], 'month', aggregation, today);
    expect(data.buckets.filter((b) => b.min !== null)).toEqual([
      expect.objectContaining({ min: 1440, max: 1890 }),
    ]);
    expect(formatSleepScheduleRange(data.average)).toBe('12:00 AM–7:30 AM');
    expect(formatSleepScheduleRange(data.latest)).toBe('12:30 AM–8:00 AM');
  });

  it('unwraps wake times too, rather than averaging 11:30 PM and 12:30 AM to noon', () => {
    const data = buildSleepScheduleChartData([
      night('2025-06-16T18:00:00', '2025-06-16T23:30:00'),
      night('2025-06-17T18:00:00', '2025-06-18T00:30:00'),
    ], 'month', 'week', today);
    expect(formatSleepScheduleRange(data.average)).toBe('6:00 PM–12:00 AM');
  });

  it('weights the overall average by nights, not by nonempty buckets', () => {
    const data = buildSleepScheduleChartData([
      night('2025-06-01T22:00:00', '2025-06-02T06:00:00'),
      night('2025-06-02T22:00:00', '2025-06-03T06:00:00'),
      night('2025-06-16T01:00:00', '2025-06-16T09:00:00'),
    ], 'month', 'week', today);
    expect(formatSleepScheduleRange(data.average)).toBe('11:00 PM–7:00 AM');
  });

  it('skips legacy, partial, nonfinite, zero, reversed, and implausibly long windows', () => {
    const valid = night('2025-06-14T23:00:00', '2025-06-15T07:00:00');
    const data = buildSleepScheduleChartData([
      makeEntry(),
      { ...valid, sleepStartTimestampLocal: null },
      { ...valid, sleepEndTimestampLocal: undefined },
      { ...valid, sleepStartTimestampLocal: NaN },
      { ...valid, sleepEndTimestampLocal: Infinity },
      { ...valid, sleepStartTimestampLocal: 0 },
      { ...valid, sleepEndTimestampLocal: valid.sleepStartTimestampLocal },
      { ...valid, sleepEndTimestampLocal: Date.parse('2025-06-17T07:00:00Z') },
      makeEntry({ sleepStartTimestampGMT: 1749942000000, sleepEndTimestampGMT: 1749970800000 }),
    ], 'month', 'day', today);
    expect(data.buckets.every((b) => b.min === null && b.max === null)).toBe(true);
    expect(data.latest).toBeNull();
    expect(data.average).toBeNull();
    expect(formatSleepScheduleRange(data.latest)).toBe('—');
  });

  it.each([
    ['2025-03-08', '2025-03-09', '2025-03-09T07:00:00Z', '2025-03-09T14:00:00Z'],
    ['2025-11-01', '2025-11-02', '2025-11-02T06:00:00Z', '2025-11-02T15:00:00Z'],
  ])('preserves local clock endpoints across DST starting %s', (startDate, endDate, utcStart, utcEnd) => {
    const data = buildSleepScheduleChartData([
      night(`${startDate}T23:00:00`, `${endDate}T07:00:00`, {
        sleepStartTimestampGMT: Date.parse(utcStart),
        sleepEndTimestampGMT: Date.parse(utcEnd),
        sleepDurationSec: 6 * 3600,
      }),
    ], '2025', 'day', today);
    expect(data.latest).toMatchObject({ min: 1380, max: 1860 });
    expect(formatSleepScheduleRange(data.latest)).toBe('11:00 PM–7:00 AM');
  });

  it('uses the recorded local date even when the UTC instant is on another day', () => {
    const data = buildSleepScheduleChartData([
      night('2025-06-14T23:00:00', '2025-06-15T07:00:00', {
        date: '2025-06-14',
        sleepStartTimestampGMT: Date.parse('2025-06-14T14:00:00Z'),
        sleepEndTimestampGMT: Date.parse('2025-06-14T22:00:00Z'),
      }),
    ], 'month', 'day', today);
    expect(data.latest).toEqual({ label: '6/15', min: 1380, max: 1860 });
  });

  it.each(['UTC', 'America/Los_Angeles', 'Asia/Tokyo'])('does not shift recorded times in viewer timezone %s', (timezone) => {
    vi.stubEnv('TZ', timezone);
    try {
      const data = buildSleepScheduleChartData([
        night('2025-03-08T23:15:00', '2025-03-09T07:05:00'),
      ], 'month', 'day', new Date(2025, 2, 10));
      expect(data.latest).toEqual({ label: '3/9', min: 1395, max: 1865 });
      expect(formatSleepScheduleRange(data.latest)).toBe('11:15 PM–7:05 AM');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('filters by wake date at year boundaries and finds latest independent of input order', () => {
    const entries = [
      night('2025-01-01T23:00:00', '2025-01-02T07:00:00'),
      night('2024-12-31T23:00:00', '2025-01-01T07:00:00'),
      night('2024-12-30T23:00:00', '2024-12-31T07:00:00'),
    ];
    const data = buildSleepScheduleChartData(entries, '2025', 'day', today);
    expect(data.buckets.filter((b) => b.min !== null).map((b) => b.label)).toEqual(['1/1', '1/2']);
    expect(data.latest?.label).toBe('1/2');
  });

  it('does not merge similarly named weeks in different years', () => {
    const data = buildSleepScheduleChartData([
      night('2024-12-30T23:00:00', '2024-12-31T07:00:00'),
      night('2025-12-29T22:00:00', '2025-12-30T06:00:00'),
    ], 'year', 'week', new Date(2025, 11, 30));
    expect(data.buckets.filter((b) => b.min !== null)).toEqual([
      { label: 'W1', min: 1380, max: 1860 },
      { label: 'W1', min: 1320, max: 1800 },
    ]);
  });

  it('formats noon, midnight, minute rounding, and missing times', () => {
    expect(formatSleepTime(720)).toBe('12:00 PM');
    expect(formatSleepTime(1440)).toBe('12:00 AM');
    expect(formatSleepTime(1439.9)).toBe('12:00 AM');
    expect(formatSleepTime(null)).toBe('—');
    expect(formatSleepTime(NaN)).toBe('—');
  });
});

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

  describe('buildIntensityMinCombinedChartData', () => {
    it('colors every day in a Monday-start week by that week\'s cumulative total', () => {
      // Mon 6/16 + Tue 6/17 + Wed 6/18 = 180, which exceeds 140 * 1.25 = 175,
      // so all three days (the whole week) should read 'exceeded'. The
      // following Monday (6/23) starts a new, under-goal week on its own.
      const chart = buildIntensityMinCombinedChartData(
        [
          makeEntry({ date: '2025-06-16', intensityMinModerate: 60 }),
          makeEntry({ date: '2025-06-17', intensityMinModerate: 60 }),
          makeEntry({ date: '2025-06-18', intensityMinModerate: 60 }),
          makeEntry({ date: '2025-06-23', intensityMinModerate: 10 }),
        ],
        'month',
        'day',
        140,
        new Date(2025, 5, 25),
      );

      expect(chart.buckets.find((bucket) => bucket.label === '6/16')?.colorKey).toBe('exceeded');
      expect(chart.buckets.find((bucket) => bucket.label === '6/17')?.colorKey).toBe('exceeded');
      expect(chart.buckets.find((bucket) => bucket.label === '6/18')?.colorKey).toBe('exceeded');
      expect(chart.buckets.find((bucket) => bucket.label === '6/23')?.colorKey).toBe('below');
    });

    it('builds a Monday-start cumulative running total and week-start flag for the day view', () => {
      const chart = buildIntensityMinCombinedChartData(
        [
          makeEntry({ date: '2025-06-16', intensityMinModerate: 60 }),
          makeEntry({ date: '2025-06-17', intensityMinModerate: 60 }),
          makeEntry({ date: '2025-06-18', intensityMinModerate: 60 }),
        ],
        'month',
        'day',
        140,
        new Date(2025, 5, 20),
      );

      expect(chart.buckets.find((bucket) => bucket.label === '6/16')).toMatchObject({ cumulative: 60, isWeekStart: true });
      expect(chart.buckets.find((bucket) => bucket.label === '6/17')).toMatchObject({ cumulative: 120, isWeekStart: false });
      expect(chart.buckets.find((bucket) => bucket.label === '6/18')).toMatchObject({ cumulative: 180, isWeekStart: false });
    });

    it('uses the weekly goal directly for weekly colors', () => {
      const chart = buildIntensityMinCombinedChartData(
        [
          makeEntry({ date: '2025-06-02', intensityMinModerate: 139 }),
          makeEntry({ date: '2025-06-09', intensityMinModerate: 140 }),
          makeEntry({ date: '2025-06-16', intensityMinModerate: 175 }),
        ],
        'month',
        'week',
        140,
        new Date(2025, 5, 20),
      );

      const populated = chart.buckets.filter((bucket) => bucket.value !== null);
      expect(populated.map((bucket) => bucket.colorKey)).toEqual(['below', 'met', 'exceeded']);
    });

    it('scales monthly colors by the daily goal and represented calendar days', () => {
      const chart = buildIntensityMinCombinedChartData(
        [
          makeEntry({ date: '2025-01-15', intensityMinModerate: 620 }),
          makeEntry({ date: '2025-02-15', intensityMinModerate: 700 }),
          makeEntry({ date: '2025-03-15', intensityMinModerate: 619 }),
        ],
        '2025',
        'month',
        140,
        new Date(2025, 5, 20),
      );

      expect(chart.buckets.find((bucket) => bucket.label === 'Jan')?.colorKey).toBe('met');
      expect(chart.buckets.find((bucket) => bucket.label === 'Feb')?.colorKey).toBe('exceeded');
      expect(chart.buckets.find((bucket) => bucket.label === 'Mar')?.colorKey).toBe('below');
    });
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

  it('formats lactate threshold speed as an imperial pace', () => {
    expect(formatWellnessValue(3.4, 'lactateThresholdSpeed')).toBe('7:53 /mi');
    // The sync converts Garmin's raw range value 0.319 to 3.19 m/s.
    expect(formatWellnessValue(3.19, 'lactateThresholdSpeed')).toBe('8:24 /mi');
    expect(formatWellnessValue(3.472, 'lactateThresholdSpeed')).toBe('7:44 /mi');
  });

  it('does not hide positive speeds behind an arbitrary pace cutoff', () => {
    expect(formatWellnessValue(1, 'lactateThresholdSpeed')).toBe('26:49 /mi');
    expect(formatWellnessValue(1.5, 'lactateThresholdSpeed')).toBe('17:53 /mi');
  });

  it.each([null, 0, -1, NaN, Infinity, -Infinity])('treats invalid threshold speed %s as missing', (value) => {
    expect(formatWellnessValue(value, 'lactateThresholdSpeed')).toBe('—');
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
