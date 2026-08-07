/**
 * Withings body-composition chart data model and aggregation logic.
 *
 * Consumes measurement data from the "Stronger - Withings" sheet tab and
 * produces chart-ready data. Unlike Strava activities (which are summed into
 * totals per bucket), body-composition metrics are point-in-time samples: a
 * bucket's value is the average of the measurements that fall in it, and the
 * series is a trend line over time rather than a cumulative total.
 */

import type { WithingsMeasurement } from './types.js';
import {
  getRangeStart,
  getRangeEnd,
  getTimeRangeOptions,
} from './strava.js';
import type { StravaTimeRange, StravaAggregation } from './strava.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Body-composition metrics tracked from Withings. */
export type WithingsMetric =
  | 'weight'
  | 'fatMass'
  | 'fatRatio'
  | 'muscleMass'
  | 'boneMass'
  | 'hydration'
  | 'fatFreeMass'
  | 'heartRate'
  | 'visceralFat';

/** Reuse Strava's range and aggregation vocabulary for a consistent UI. */
export type WithingsTimeRange = StravaTimeRange;
export type WithingsAggregation = StravaAggregation;

/** A single point in a metric trend line (one time bucket). */
export interface TrendPoint {
  /** Human-readable label for the bucket (e.g. "Mon", "W3", "Jan"). */
  label: string;
  /**
   * Averaged metric value for the bucket in display units, or null if the
   * bucket had no measurement for this metric, or if filterTrendDips
   * excluded it as a dip/spike. Either way the chart connects straight
   * through to the next real point rather than showing a gap.
   */
  value: number | null;
}

/** A single metric's target (e.g. a goal weight). */
export interface WithingsGoal {
  metric: WithingsMetric;
  /** Target value in display units. */
  value: number;
}

/** Complete chart data for a single metric. */
export interface MetricTrendData {
  metric: WithingsMetric;
  points: TrendPoint[];
  /** Target value for this metric, or null if none set. */
  goal: number | null;
  /** Display unit label. */
  unit: string;
  /** Most recent (latest by date) value across the filtered range, or null. */
  latest: number | null;
  /**
   * Change from the first non-null point to the latest non-null point in the
   * range (latest − first), or null if fewer than two points have data.
   */
  delta: number | null;
  /** Minimum non-null value in the range (for axis scaling), or null. */
  min: number | null;
  /** Maximum non-null value in the range (for axis scaling), or null. */
  max: number | null;
}

/* ------------------------------------------------------------------ */
/*  Metric metadata                                                    */
/* ------------------------------------------------------------------ */

export const WITHINGS_METRICS: WithingsMetric[] = [
  'weight',
  'fatRatio',
  'fatMass',
  'fatFreeMass',
  'muscleMass',
  'boneMass',
  'hydration',
  'heartRate',
  'visceralFat',
];

/* ------------------------------------------------------------------ */
/*  Unit conversion (storage kg → display lb)                          */
/* ------------------------------------------------------------------ */

const KG_TO_LB = 2.2046226218;

/**
 * Metrics stored in kilograms. These are converted to pounds for display —
 * the sheet stays canonical (kg, matching the Withings API), and the UI only
 * ever shows imperial units. Body fat (%), lean and bone mass (% of total
 * weight), and heart rate (bpm) are not masses and pass through unchanged.
 */
const MASS_METRICS: ReadonlySet<WithingsMetric> = new Set([
  'weight',
  'fatMass',
  'muscleMass',
  'hydration',
]);

/** Convert a raw stored value (kg for masses) into its display value (lb). */
export function toDisplayUnit(metric: WithingsMetric, value: number): number {
  return MASS_METRICS.has(metric) ? value * KG_TO_LB : value;
}

/** Convert a display value (lb for masses) back into stored units (kg). */
export function fromDisplayUnit(metric: WithingsMetric, value: number): number {
  return MASS_METRICS.has(metric) ? value / KG_TO_LB : value;
}

export const METRIC_UNITS: Record<WithingsMetric, string> = {
  weight: 'lb',
  fatMass: 'lb',
  fatRatio: '%',
  muscleMass: 'lb',
  boneMass: '%',
  hydration: 'lb',
  fatFreeMass: '%',
  heartRate: 'bpm',
  visceralFat: 'score',
};

export const METRIC_LABELS: Record<WithingsMetric, string> = {
  weight: 'Weight',
  fatMass: 'Fat Mass',
  fatRatio: 'Body Fat',
  muscleMass: 'Muscle Mass',
  boneMass: 'Bone Mass',
  hydration: 'Hydration',
  fatFreeMass: 'Lean Mass',
  heartRate: 'Resting Heart Rate',
  visceralFat: 'Visceral Fat',
};

/** Whether lower values are "better" for this metric — used only for delta coloring. */
export const METRIC_LOWER_IS_BETTER: Record<WithingsMetric, boolean> = {
  weight: true,
  fatMass: true,
  fatRatio: true,
  muscleMass: false,
  boneMass: false,
  hydration: false,
  fatFreeMass: false,
  heartRate: true,
  visceralFat: true,
};

/* ------------------------------------------------------------------ */
/*  Time range options (re-exported for a self-contained view import)  */
/* ------------------------------------------------------------------ */

export { getTimeRangeOptions };

/* ------------------------------------------------------------------ */
/*  Filtering                                                          */
/* ------------------------------------------------------------------ */

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Filter measurements to those within the selected time range. */
export function filterMeasurements(
  measurements: WithingsMeasurement[],
  range: WithingsTimeRange,
  today: Date = new Date(),
): WithingsMeasurement[] {
  const startStr = toISODate(getRangeStart(range, today));
  const endStr = toISODate(getRangeEnd(range, today));
  return measurements.filter((m) => m.date >= startStr && m.date <= endStr);
}

/** Get the numeric value of a metric on a measurement, or null if absent. */
function metricValue(m: WithingsMeasurement, metric: WithingsMetric): number | null {
  if (metric === 'fatFreeMass' || metric === 'boneMass') {
    const mass = m[metric];
    return mass !== null && m.weight > 0 ? (mass / m.weight) * 100 : null;
  }
  const v = m[metric];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/* ------------------------------------------------------------------ */
/*  Bucketing                                                          */
/* ------------------------------------------------------------------ */

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * ISO week info for a date: the ISO week number and its week-numbering year.
 *
 * The week-numbering year is derived from the Thursday of the week, so weeks
 * that straddle a calendar boundary (e.g. late December belonging to week 1 of
 * the next year) are attributed correctly. Returning the year alongside the
 * week is what lets bucket keys stay unique across a rolling window that spans
 * two calendar years — otherwise "W1" in two different years would collide.
 */
function getISOWeekInfo(d: Date): { year: number; week: number } {
  const tmp = new Date(d.getTime());
  tmp.setHours(0, 0, 0, 0);
  // Shift to the Thursday of this ISO week.
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
  const year = tmp.getFullYear();
  const jan4 = new Date(year, 0, 4);
  const week =
    1 + Math.round(((tmp.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return { year, week };
}

/**
 * Assign a bucket key to a measurement based on the aggregation level.
 * Keys are year-qualified for week and month so buckets never collide across
 * calendar years within a rolling window:
 * - day:   ISO date "YYYY-MM-DD"
 * - week:  ISO week "YYYY-Www"
 * - month: "YYYY-MM"
 */
function getBucketKey(dateStr: string, aggregation: WithingsAggregation): string {
  if (aggregation === 'day') return dateStr;
  const d = new Date(dateStr + 'T00:00:00');
  if (aggregation === 'week') {
    const { year, week } = getISOWeekInfo(d);
    return `${year}-W${String(week).padStart(2, '0')}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Generate all expected bucket slots (key + label) for a range/aggregation,
 * in strict chronological order.
 *
 * This is a Withings-local replacement for the shared Strava bucketer. Unlike
 * that one, month/week slots are walked forward from the range start so a
 * rolling "year" window that begins mid-year is ordered chronologically
 * (e.g. Aug → … → Jul) rather than snapped to a fixed Jan→Dec layout, and
 * keys are year-qualified to avoid cross-year collisions.
 */
function buildBucketSlots(
  range: WithingsTimeRange,
  aggregation: WithingsAggregation,
  today: Date,
): { key: string; label: string }[] {
  const start = getRangeStart(range, today);
  const end = getRangeEnd(range, today);
  const slots: { key: string; label: string }[] = [];
  const seen = new Set<string>();

  const push = (key: string, label: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    slots.push({ key, label });
  };

  if (aggregation === 'day') {
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    while (cursor <= end) {
      push(toISODate(cursor), `${cursor.getMonth() + 1}/${cursor.getDate()}`);
      cursor.setDate(cursor.getDate() + 1);
    }
    return slots;
  }

  if (aggregation === 'week') {
    // Step a day at a time so every ISO week in the window is captured exactly
    // once, in order, regardless of where the window boundaries fall.
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    while (cursor <= end) {
      const { year, week } = getISOWeekInfo(cursor);
      push(`${year}-W${String(week).padStart(2, '0')}`, `W${week}`);
      cursor.setDate(cursor.getDate() + 1);
    }
    return slots;
  }

  // month
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    push(key, MONTH_LABELS[cursor.getMonth()]);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return slots;
}

/* ------------------------------------------------------------------ */
/*  Trend data builder                                                 */
/* ------------------------------------------------------------------ */

/**
 * Build trend data for a single metric from filtered measurements.
 *
 * @param measurements - Already filtered by date range
 * @param metric - Which metric to chart
 * @param range - Time range (determines bucket slots)
 * @param goal - Target value in display units, or null
 * @param today - Reference date for range calculations
 * @param aggregation - Bucket granularity (day/week/month)
 */
export function buildMetricTrendData(
  measurements: WithingsMeasurement[],
  metric: WithingsMetric,
  range: WithingsTimeRange,
  goal: number | null = null,
  today: Date = new Date(),
  aggregation: WithingsAggregation = 'week',
): MetricTrendData {
  const slots = buildBucketSlots(range, aggregation, today);

  // Sort a copy of the measurements chronologically so aggregation, latest /
  // earliest tracking, and any downstream rendering are deterministic
  // regardless of the order rows arrive from the sheet. Ties on date are
  // broken by grpId to keep the ordering stable.
  const ordered = [...measurements].sort((a, b) =>
    a.date === b.date ? a.grpId.localeCompare(b.grpId) : a.date < b.date ? -1 : 1,
  );

  // Accumulate sum + count per bucket so we can average.
  const sums = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const { key } of slots) {
    sums.set(key, 0);
    counts.set(key, 0);
  }

  // Track latest measurement (by date) with a value, for the headline figure.
  let latest: number | null = null;
  let latestDate = '';
  let earliest: number | null = null;
  let earliestDate = '';
  let min: number | null = null;
  let max: number | null = null;

  for (const m of ordered) {
    const raw = metricValue(m, metric);
    if (raw === null) continue;
    const v = toDisplayUnit(metric, raw);

    const key = getBucketKey(m.date, aggregation);
    if (sums.has(key)) {
      sums.set(key, (sums.get(key) ?? 0) + v);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    if (min === null || v < min) min = v;
    if (max === null || v > max) max = v;
    if (latest === null || m.date > latestDate) {
      latest = v;
      latestDate = m.date;
    }
    if (earliest === null || m.date < earliestDate) {
      earliest = v;
      earliestDate = m.date;
    }
  }

  const points: TrendPoint[] = slots.map(({ key, label }) => {
    const count = counts.get(key) ?? 0;
    return {
      label,
      value: count > 0 ? (sums.get(key) ?? 0) / count : null,
    };
  });

  const delta =
    latest !== null && earliest !== null && latestDate !== earliestDate
      ? latest - earliest
      : null;

  return {
    metric,
    points,
    goal,
    unit: METRIC_UNITS[metric],
    latest,
    delta,
    min,
    max,
  };
}

/* ------------------------------------------------------------------ */
/*  Dip filtering                                                      */
/* ------------------------------------------------------------------ */

/**
 * Filter out short-term regressions from a trend-point series.
 *
 * For lower-is-better metrics (weight, fat): removes upward spikes more than
 * `threshold` (default 5%) above the previous kept point.
 * For higher-is-better metrics (muscle, bone): removes downward dips more than
 * `threshold` (default 5%) below the previous kept point.
 *
 * Null (empty) buckets pass through unchanged so chart gaps are preserved.
 */
export function filterTrendDips(
  points: TrendPoint[],
  lowerIsBetter: boolean,
  threshold = 0.05,
): TrendPoint[] {
  let prevValue: number | null = null;
  return points.map((p) => {
    if (p.value === null) return p;
    if (prevValue === null) {
      prevValue = p.value;
      return p;
    }
    const isRegression = lowerIsBetter
      ? p.value > prevValue * (1 + threshold)
      : p.value < prevValue * (1 - threshold);
    if (!isRegression) {
      prevValue = p.value;
      return p;
    }
    return { ...p, value: null };
  });
}

/* ------------------------------------------------------------------ */
/*  Value formatting                                                   */
/* ------------------------------------------------------------------ */

/** Format a display-unit value for axis labels and headline figures. */
export function formatMetricValue(v: number, metric: WithingsMetric): string {
  if (metric === 'fatRatio' || metric === 'fatFreeMass' || metric === 'boneMass') return v.toFixed(1);
  if (metric === 'heartRate' || metric === 'visceralFat') return v.toFixed(0);
  // Mass metrics (lb): one decimal below 100, whole numbers above.
  if (v >= 100) return v.toFixed(0);
  return v.toFixed(1);
}
