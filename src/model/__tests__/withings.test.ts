import { describe, it, expect } from 'vitest';
import {
  filterMeasurements,
  buildMetricTrendData,
  filterTrendDips,
  formatMetricValue,
  toDisplayUnit,
  fromDisplayUnit,
  METRIC_UNITS,
  METRIC_LABELS,
  METRIC_LOWER_IS_BETTER,
  METRIC_AXIS_RANGES,
  WITHINGS_METRICS,
} from '../withings.js';
import type { WithingsMeasurement } from '../types.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeMeasurement(overrides: Partial<WithingsMeasurement> = {}): WithingsMeasurement {
  return {
    date: '2026-06-15',
    grpId: '1000',
    weight: 80,
    fatMass: 16,
    fatRatio: 20,
    muscleMass: 60,
    boneMass: 3,
    hydration: 45,
    fatFreeMass: 64,
    heartRate: 58,
    visceralFat: 8,
    ...overrides,
  };
}

const TODAY = new Date('2026-06-20T12:00:00');
const KG_TO_LB = 2.2046226218;

/* ------------------------------------------------------------------ */
/*  Metadata                                                           */
/* ------------------------------------------------------------------ */

describe('metric metadata', () => {
  it('has units, labels, and direction for every metric', () => {
    for (const metric of WITHINGS_METRICS) {
      expect(METRIC_UNITS[metric]).toBeTruthy();
      expect(METRIC_LABELS[metric]).toBeTruthy();
      expect(typeof METRIC_LOWER_IS_BETTER[metric]).toBe('boolean');
    }
  });

  it('displays weight in pounds', () => {
    expect(METRIC_UNITS.weight).toBe('lb');
  });

  it('body fat is a percentage', () => {
    expect(METRIC_UNITS.fatRatio).toBe('%');
  });

  it('resting heart rate is in bpm', () => {
    expect(METRIC_UNITS.heartRate).toBe('bpm');
  });

  it('includes fat-free (lean) mass, resting heart rate, and visceral fat', () => {
    expect(WITHINGS_METRICS).toContain('fatFreeMass');
    expect(WITHINGS_METRICS).toContain('heartRate');
    expect(WITHINGS_METRICS).toContain('visceralFat');
  });

  it('uses a fixed 1–6 axis for visceral fat', () => {
    expect(METRIC_AXIS_RANGES.visceralFat).toEqual({ min: 1, max: 6 });
  });
});

/* ------------------------------------------------------------------ */
/*  Unit conversion                                                    */
/* ------------------------------------------------------------------ */

describe('toDisplayUnit / fromDisplayUnit', () => {
  it('converts mass metrics from kg to lb for display', () => {
    expect(toDisplayUnit('weight', 80)).toBeCloseTo(176.37, 2);
    expect(toDisplayUnit('fatMass', 16)).toBeCloseTo(35.27, 2);
    expect(toDisplayUnit('fatFreeMass', 64)).toBeCloseTo(141.10, 2);
  });

  it('leaves non-mass metrics unchanged', () => {
    expect(toDisplayUnit('fatRatio', 20)).toBe(20);
    expect(toDisplayUnit('heartRate', 58)).toBe(58);
    expect(toDisplayUnit('visceralFat', 8)).toBe(8);
  });

  it('round-trips through fromDisplayUnit', () => {
    expect(fromDisplayUnit('weight', toDisplayUnit('weight', 80))).toBeCloseTo(80, 6);
    expect(fromDisplayUnit('heartRate', 58)).toBe(58);
    expect(fromDisplayUnit('visceralFat', 8)).toBe(8);
  });
});

/* ------------------------------------------------------------------ */
/*  filterMeasurements                                                 */
/* ------------------------------------------------------------------ */

describe('filterMeasurements', () => {
  it('keeps measurements within the last 30 days for month range', () => {
    // TODAY = June 20 2026; last 30 days = May 22 – June 20
    const measurements = [
      makeMeasurement({ date: '2026-06-01', grpId: 'a' }),
      makeMeasurement({ date: '2026-06-19', grpId: 'b' }),
      makeMeasurement({ date: '2026-04-30', grpId: 'c' }), // well outside 30 days
    ];
    const result = filterMeasurements(measurements, 'month', TODAY);
    expect(result.map((m) => m.grpId)).toEqual(['a', 'b']);
  });

  it('keeps measurements within a specific year', () => {
    const measurements = [
      makeMeasurement({ date: '2026-01-01', grpId: 'a' }),
      makeMeasurement({ date: '2025-12-31', grpId: 'b' }), // previous year
      makeMeasurement({ date: '2026-12-31', grpId: 'c' }),
    ];
    const result = filterMeasurements(measurements, '2026', TODAY);
    expect(result.map((m) => m.grpId)).toEqual(['a', 'c']);
  });
});

/* ------------------------------------------------------------------ */
/*  buildMetricTrendData                                               */
/* ------------------------------------------------------------------ */

describe('buildMetricTrendData', () => {
  it('reports the latest value by date', () => {
    const measurements = [
      makeMeasurement({ date: '2026-06-01', grpId: 'a', fatRatio: 22 }),
      makeMeasurement({ date: '2026-06-15', grpId: 'b', fatRatio: 20 }),
      makeMeasurement({ date: '2026-06-10', grpId: 'c', fatRatio: 21 }),
    ];
    const data = buildMetricTrendData(measurements, 'fatRatio', '2026', null, TODAY, 'month');
    expect(data.latest).toBe(20);
  });

  it('computes delta as latest minus earliest', () => {
    const measurements = [
      makeMeasurement({ date: '2026-06-01', grpId: 'a', fatRatio: 22 }),
      makeMeasurement({ date: '2026-06-15', grpId: 'b', fatRatio: 19 }),
    ];
    const data = buildMetricTrendData(measurements, 'fatRatio', '2026', null, TODAY, 'month');
    expect(data.delta).toBe(-3);
  });

  it('returns null delta when only one measurement exists', () => {
    const measurements = [makeMeasurement({ date: '2026-06-01', fatRatio: 22 })];
    const data = buildMetricTrendData(measurements, 'fatRatio', '2026', null, TODAY, 'month');
    expect(data.delta).toBeNull();
  });

  it('averages multiple measurements in the same bucket', () => {
    const measurements = [
      makeMeasurement({ date: '2026-03-01', grpId: 'a', fatRatio: 20 }),
      makeMeasurement({ date: '2026-03-20', grpId: 'b', fatRatio: 24 }),
    ];
    const data = buildMetricTrendData(measurements, 'fatRatio', '2026', null, TODAY, 'month');
    // March is bucket index 2
    expect(data.points[2].value).toBe(22);
  });

  it('converts weight buckets to pounds', () => {
    const measurements = [makeMeasurement({ date: '2026-03-01', weight: 80 })];
    const data = buildMetricTrendData(measurements, 'weight', '2026', null, TODAY, 'month');
    expect(data.points[2].value).toBeCloseTo(176.37, 2); // 80 kg → lb
    expect(data.latest).toBeCloseTo(176.37, 2);
  });

  it('leaves buckets with no measurement as null (line gap)', () => {
    const measurements = [makeMeasurement({ date: '2026-03-01', fatRatio: 20 })];
    const data = buildMetricTrendData(measurements, 'fatRatio', '2026', null, TODAY, 'month');
    expect(data.points[0].value).toBeNull(); // January
    expect(data.points[2].value).toBe(20); // March
  });

  it('ignores null metric fields when building a trend', () => {
    const measurements = [
      makeMeasurement({ date: '2026-03-01', grpId: 'a', heartRate: null }),
      makeMeasurement({ date: '2026-04-01', grpId: 'b', heartRate: 61 }),
    ];
    const data = buildMetricTrendData(measurements, 'heartRate', '2026', null, TODAY, 'month');
    expect(data.points[2].value).toBeNull(); // March had no HR reading
    expect(data.points[3].value).toBe(61); // April (bpm, unconverted)
    expect(data.latest).toBe(61);
  });

  it('displays lean mass in pounds and derives daily optimal bounds from weight', () => {
    const measurements = [
      makeMeasurement({ date: '2026-03-01', grpId: 'a', weight: 80, fatFreeMass: 52 }),
      makeMeasurement({ date: '2026-04-01', grpId: 'b', weight: 75, fatFreeMass: 50 }),
    ];
    const data = buildMetricTrendData(measurements, 'fatFreeMass', '2026', null, TODAY, 'month');
    expect(data.points[2].value).toBeCloseTo(114.64, 2);
    expect(data.points[2].optimalMin).toBeCloseTo(114.64, 2);
    expect(data.points[2].optimalMax).toBeCloseTo(116.40, 2);
    expect(data.points[3].value).toBeCloseTo(110.23, 2);
    expect(data.points[3].optimalMin).toBeCloseTo(107.48, 2);
    expect(data.points[3].optimalMax).toBeCloseTo(109.13, 2);
    expect(data.latest).toBeCloseTo(110.23, 2);
  });

  it('displays bone mass in pounds and derives daily optimal bounds from weight', () => {
    const measurements = [
      makeMeasurement({ date: '2026-03-01', grpId: 'a', weight: 80, boneMass: 3.2 }),
      makeMeasurement({ date: '2026-04-01', grpId: 'b', weight: 75, boneMass: 3 }),
    ];
    const data = buildMetricTrendData(measurements, 'boneMass', '2026', null, TODAY, 'month');
    expect(data.points[2].value).toBeCloseTo(7.05, 2);
    expect(data.points[2].optimalMin).toBeCloseTo(7.05, 2);
    expect(data.points[2].optimalMax).toBeCloseTo(8.82, 2);
    expect(data.points[3].value).toBeCloseTo(6.61, 2);
    expect(data.points[3].optimalMin).toBeCloseTo(6.61, 2);
    expect(data.points[3].optimalMax).toBeCloseTo(8.27, 2);
    expect(data.latest).toBeCloseTo(6.61, 2);
  });

  it('displays hydration in pounds and derives daily optimal bounds from weight', () => {
    const measurements = [
      makeMeasurement({ date: '2026-03-01', grpId: 'a', weight: 80, hydration: 48 }),
      makeMeasurement({ date: '2026-04-01', grpId: 'b', weight: 75, hydration: 45 }),
    ];
    const data = buildMetricTrendData(measurements, 'hydration', '2026', null, TODAY, 'month');
    expect(data.points[2].value).toBeCloseTo(105.82, 2);
    expect(data.points[2].optimalMin).toBeCloseTo(88.18, 2);
    expect(data.points[2].optimalMax).toBeCloseTo(114.64, 2);
    expect(data.points[3].value).toBeCloseTo(99.21, 2);
    expect(data.points[3].optimalMin).toBeCloseTo(82.67, 2);
    expect(data.points[3].optimalMax).toBeCloseTo(107.48, 2);
    expect(data.latest).toBeCloseTo(99.21, 2);
  });

  it('keeps visceral fat in score units with a 1–5 optimal range', () => {
    const measurements = [
      makeMeasurement({ date: '2026-03-01', grpId: 'a', visceralFat: 9 }),
      makeMeasurement({ date: '2026-04-01', grpId: 'b', visceralFat: 8 }),
    ];
    const data = buildMetricTrendData(measurements, 'visceralFat', '2026', null, TODAY, 'month');
    expect(data.points[2].value).toBe(9);
    expect(data.points[2].optimalMin).toBe(1);
    expect(data.points[2].optimalMax).toBe(5);
    expect(data.points[3].value).toBe(8);
    expect(data.points[3].optimalMin).toBe(1);
    expect(data.points[3].optimalMax).toBe(5);
    expect(data.latest).toBe(8);
    expect(data.delta).toBe(-1);
  });

  it('tracks min and max across the range', () => {
    const measurements = [
      makeMeasurement({ date: '2026-02-01', fatRatio: 18 }),
      makeMeasurement({ date: '2026-05-01', fatRatio: 25 }),
      makeMeasurement({ date: '2026-06-01', fatRatio: 20 }),
    ];
    const data = buildMetricTrendData(measurements, 'fatRatio', '2026', null, TODAY, 'month');
    expect(data.min).toBe(18);
    expect(data.max).toBe(25);
  });

  it('carries the goal through (already in display units)', () => {
    const data = buildMetricTrendData([makeMeasurement()], 'weight', '2026', 165, TODAY, 'month');
    expect(data.goal).toBe(165);
  });

  it('orders rolling-year month buckets chronologically across the year boundary', () => {
    // TODAY = June 20 2026; rolling 'year' spans ~June 2025 → June 2026.
    // Buckets must run in chronological order (…2025 months then 2026 months),
    // not snap to a fixed Jan→Dec layout.
    const data = buildMetricTrendData([], 'weight', 'year', null, TODAY, 'month');
    const labels = data.points.map((p) => p.label);
    expect(labels[0]).toBe('Jun'); // June 2025
    expect(labels[labels.length - 1]).toBe('Jun'); // June 2026
    // The first and last buckets share a label but are distinct chronological slots.
    expect(labels.length).toBeGreaterThan(12);
  });

  it('does not merge same-month measurements from different years (rolling year)', () => {
    // Two June measurements a year apart must land in separate buckets rather
    // than averaging together into one.
    const measurements = [
      makeMeasurement({ date: '2025-06-25', grpId: 'a', fatRatio: 30 }),
      makeMeasurement({ date: '2026-06-01', grpId: 'b', fatRatio: 20 }),
    ];
    const data = buildMetricTrendData(measurements, 'fatRatio', 'year', null, TODAY, 'month');
    const nonNull = data.points.filter((p) => p.value !== null).map((p) => p.value);
    expect(nonNull).toEqual([30, 20]); // two separate buckets, not one 25 average
  });

  it('does not merge same week-number measurements from different years (rolling year)', () => {
    const measurements = [
      makeMeasurement({ date: '2025-06-21', grpId: 'a', fatRatio: 30 }),
      makeMeasurement({ date: '2026-06-19', grpId: 'b', fatRatio: 20 }),
    ];
    const data = buildMetricTrendData(measurements, 'fatRatio', 'year', null, TODAY, 'week');
    const nonNull = data.points.filter((p) => p.value !== null).map((p) => p.value);
    expect(nonNull).toEqual([30, 20]);
  });

  it('aggregates independent of measurement input order', () => {
    const inOrder = [
      makeMeasurement({ date: '2026-02-01', grpId: 'a', fatRatio: 18 }),
      makeMeasurement({ date: '2026-05-01', grpId: 'b', fatRatio: 24 }),
    ];
    const shuffled = [inOrder[1], inOrder[0]];
    const a = buildMetricTrendData(inOrder, 'fatRatio', '2026', null, TODAY, 'month');
    const b = buildMetricTrendData(shuffled, 'fatRatio', '2026', null, TODAY, 'month');
    expect(b.points.map((p) => p.value)).toEqual(a.points.map((p) => p.value));
    expect(b.latest).toBe(a.latest);
    expect(b.delta).toBe(a.delta);
  });
});

/* ------------------------------------------------------------------ */
/*  filterTrendDips                                                    */
/* ------------------------------------------------------------------ */

describe('filterTrendDips', () => {
  const pts = (vals: (number | null)[]) =>
    vals.map((v, i) => ({ label: String(i), value: v, optimalMin: null, optimalMax: null }));

  it('passes through a monotonically improving lower-is-better series unchanged', () => {
    const result = filterTrendDips(pts([180, 178, 175, 173]), true);
    expect(result.map((p) => p.value)).toEqual([180, 178, 175, 173]);
  });

  it('removes upward spikes for lower-is-better metrics', () => {
    // 190 is ~8.6% above the previous kept value (175)
    const result = filterTrendDips(pts([175, 190, 174]), true);
    expect(result.map((p) => p.value)).toEqual([175, null, 174]);
  });

  it('allows small upward moves within threshold for lower-is-better', () => {
    // 176 is ~0.6% above 175 — well within 5%
    const result = filterTrendDips(pts([175, 176, 174]), true);
    expect(result.map((p) => p.value)).toEqual([175, 176, 174]);
  });

  it('passes through a monotonically improving higher-is-better series unchanged', () => {
    const result = filterTrendDips(pts([60, 61, 62, 63]), false);
    expect(result.map((p) => p.value)).toEqual([60, 61, 62, 63]);
  });

  it('removes downward dips for higher-is-better metrics', () => {
    // 55 is ~11.3% below the previous kept value (62)
    const result = filterTrendDips(pts([62, 55, 63]), false);
    expect(result.map((p) => p.value)).toEqual([62, null, 63]);
  });

  it('allows small downward moves within threshold for higher-is-better', () => {
    // 61 is ~1.6% below 62 — within 5%
    const result = filterTrendDips(pts([62, 61, 63]), false);
    expect(result.map((p) => p.value)).toEqual([62, 61, 63]);
  });

  it('preserves null buckets (chart gaps) in the output', () => {
    const result = filterTrendDips(pts([175, null, 174, 200, 173]), true);
    expect(result.map((p) => p.value)).toEqual([175, null, 174, null, 173]);
  });

  it('uses a null bucket as a gap without advancing the anchor', () => {
    // After a null gap the next non-null point is compared to the last kept value
    const result = filterTrendDips(pts([175, null, 190]), true);
    // 190 is >5% above 175 so it becomes null
    expect(result.map((p) => p.value)).toEqual([175, null, null]);
  });

  it('returns an empty array unchanged', () => {
    expect(filterTrendDips([], true)).toEqual([]);
  });

  it('returns a single-point array unchanged', () => {
    const result = filterTrendDips(pts([180]), true);
    expect(result.map((p) => p.value)).toEqual([180]);
  });

  it('respects a custom threshold', () => {
    // 183 is ~1.7% above 180; passes at 5% but filtered at 1%
    const result = filterTrendDips(pts([180, 183]), true, 0.01);
    expect(result.map((p) => p.value)).toEqual([180, null]);
  });
});

/* ------------------------------------------------------------------ */
/*  formatMetricValue                                                  */
/* ------------------------------------------------------------------ */

describe('formatMetricValue', () => {
  it('formats body fat to one decimal', () => {
    expect(formatMetricValue(19.47, 'fatRatio')).toBe('19.5');
  });

  it('formats resting heart rate as a whole number', () => {
    expect(formatMetricValue(57.6, 'heartRate')).toBe('58');
  });

  it('formats visceral fat as a whole number', () => {
    expect(formatMetricValue(7.6, 'visceralFat')).toBe('8');
  });

  it('formats lean mass in pounds', () => {
    expect(formatMetricValue(141.42, 'fatFreeMass')).toBe('141');
  });

  it('formats bone mass in pounds', () => {
    expect(formatMetricValue(4.42, 'boneMass')).toBe('4.4');
  });

  it('formats hydration in pounds', () => {
    expect(formatMetricValue(105.42, 'hydration')).toBe('105');
  });

  it('formats mass under 100 with one decimal', () => {
    expect(formatMetricValue(80.25, 'weight')).toBe('80.3');
  });

  it('formats mass at or above 100 as a whole number', () => {
    expect(formatMetricValue(176.4, 'weight')).toBe('176');
  });
});
