import { describe, it, expect } from 'vitest';
import {
  filterMeasurements,
  buildMetricTrendData,
  formatMetricValue,
  METRIC_UNITS,
  METRIC_LABELS,
  METRIC_LOWER_IS_BETTER,
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
    ...overrides,
  };
}

const TODAY = new Date('2026-06-20T12:00:00');

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

  it('weight is measured in kg', () => {
    expect(METRIC_UNITS.weight).toBe('kg');
  });

  it('body fat is a percentage', () => {
    expect(METRIC_UNITS.fatRatio).toBe('%');
  });
});

/* ------------------------------------------------------------------ */
/*  filterMeasurements                                                 */
/* ------------------------------------------------------------------ */

describe('filterMeasurements', () => {
  it('keeps measurements within the current month', () => {
    const measurements = [
      makeMeasurement({ date: '2026-06-01', grpId: 'a' }),
      makeMeasurement({ date: '2026-06-19', grpId: 'b' }),
      makeMeasurement({ date: '2026-05-31', grpId: 'c' }), // previous month
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
      makeMeasurement({ date: '2026-06-01', grpId: 'a', weight: 82 }),
      makeMeasurement({ date: '2026-06-15', grpId: 'b', weight: 80 }),
      makeMeasurement({ date: '2026-06-10', grpId: 'c', weight: 81 }),
    ];
    const data = buildMetricTrendData(measurements, 'weight', '2026', null, TODAY, 'month');
    expect(data.latest).toBe(80);
  });

  it('computes delta as latest minus earliest', () => {
    const measurements = [
      makeMeasurement({ date: '2026-06-01', grpId: 'a', weight: 82 }),
      makeMeasurement({ date: '2026-06-15', grpId: 'b', weight: 79 }),
    ];
    const data = buildMetricTrendData(measurements, 'weight', '2026', null, TODAY, 'month');
    expect(data.delta).toBe(-3);
  });

  it('returns null delta when only one measurement exists', () => {
    const measurements = [makeMeasurement({ date: '2026-06-01', weight: 82 })];
    const data = buildMetricTrendData(measurements, 'weight', '2026', null, TODAY, 'month');
    expect(data.delta).toBeNull();
  });

  it('averages multiple measurements in the same bucket', () => {
    const measurements = [
      makeMeasurement({ date: '2026-03-01', grpId: 'a', weight: 80 }),
      makeMeasurement({ date: '2026-03-20', grpId: 'b', weight: 84 }),
    ];
    const data = buildMetricTrendData(measurements, 'weight', '2026', null, TODAY, 'month');
    // March is bucket index 2
    expect(data.points[2].value).toBe(82);
  });

  it('leaves buckets with no measurement as null (line gap)', () => {
    const measurements = [makeMeasurement({ date: '2026-03-01', weight: 80 })];
    const data = buildMetricTrendData(measurements, 'weight', '2026', null, TODAY, 'month');
    expect(data.points[0].value).toBeNull(); // January
    expect(data.points[2].value).toBe(80); // March
  });

  it('ignores null metric fields when building a trend', () => {
    const measurements = [
      makeMeasurement({ date: '2026-03-01', grpId: 'a', muscleMass: null }),
      makeMeasurement({ date: '2026-04-01', grpId: 'b', muscleMass: 61 }),
    ];
    const data = buildMetricTrendData(measurements, 'muscleMass', '2026', null, TODAY, 'month');
    expect(data.points[2].value).toBeNull(); // March had no muscle reading
    expect(data.points[3].value).toBe(61); // April
    expect(data.latest).toBe(61);
  });

  it('tracks min and max across the range', () => {
    const measurements = [
      makeMeasurement({ date: '2026-02-01', weight: 78 }),
      makeMeasurement({ date: '2026-05-01', weight: 85 }),
      makeMeasurement({ date: '2026-06-01', weight: 80 }),
    ];
    const data = buildMetricTrendData(measurements, 'weight', '2026', null, TODAY, 'month');
    expect(data.min).toBe(78);
    expect(data.max).toBe(85);
  });

  it('carries the goal through', () => {
    const data = buildMetricTrendData([makeMeasurement()], 'weight', '2026', 75, TODAY, 'month');
    expect(data.goal).toBe(75);
  });
});

/* ------------------------------------------------------------------ */
/*  formatMetricValue                                                  */
/* ------------------------------------------------------------------ */

describe('formatMetricValue', () => {
  it('formats body fat to one decimal', () => {
    expect(formatMetricValue(19.47, 'fatRatio')).toBe('19.5');
  });

  it('formats mass under 100 with one decimal', () => {
    expect(formatMetricValue(80.25, 'weight')).toBe('80.3');
  });

  it('formats mass at or above 100 as a whole number', () => {
    expect(formatMetricValue(101.6, 'weight')).toBe('102');
  });
});
