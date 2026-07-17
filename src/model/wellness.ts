/**
 * Wellness chart data model — aggregation utilities for Garmin wellness metrics.
 *
 * Mirrors the pattern in strava.ts: generateBucketSlots, getRangeStart,
 * getRangeEnd, and getTimeRangeOptions are re-exported for convenience.
 * getBucketKey and getISOWeek are duplicated locally (not exported from strava.ts).
 */

import type { GarminWellnessEntry } from './types.js';
import type { StravaAggregation } from './strava.js';
import {
  generateBucketSlots,
  getRangeStart,
  getRangeEnd,
  getTimeRangeOptions,
} from './strava.js';

export type { StravaAggregation as WellnessAggregation, StravaTimeRange as WellnessTimeRange } from './strava.js';
export { generateBucketSlots, getRangeStart, getRangeEnd, getTimeRangeOptions };

// ---------------------------------------------------------------------------
// Metric catalogue
// ---------------------------------------------------------------------------

export type WellnessNumericMetric =
  | 'hrvWeeklyAvg'
  | 'sleepDurationSec'
  | 'sleepScore'
  | 'bodyBatteryHigh'
  | 'bodyBatteryLow'
  | 'readinessScore'
  | 'trainingAcuteLoad'
  | 'trainingChronicLoad'
  | 'steps'
  | 'floors'
  | 'restingHR'
  | 'vo2Max'
  | 'intensityMinModerate'
  | 'intensityMinVigorous'
  | 'hillScore'
  | 'enduranceScore'
  | 'activeCalories'
  | 'bmrCalories';

/** Metrics that are SUMmed when aggregating (vs averaged). */
const SUM_METRICS = new Set<WellnessNumericMetric>([
  'steps',
  'floors',
  'intensityMinModerate',
  'intensityMinVigorous',
  'activeCalories',
  'bmrCalories',
]);

export const WELLNESS_METRIC_LABELS: Record<WellnessNumericMetric, string> = {
  hrvWeeklyAvg: 'HRV Weekly Avg',
  sleepDurationSec: 'Sleep Duration',
  sleepScore: 'Sleep Score',
  bodyBatteryHigh: 'Body Battery High',
  bodyBatteryLow: 'Body Battery Low',
  readinessScore: 'Training Readiness',
  trainingAcuteLoad: 'Acute Training Load',
  trainingChronicLoad: 'Chronic Training Load',
  steps: 'Steps',
  floors: 'Floors',
  restingHR: 'Resting Heart Rate',
  vo2Max: 'VO₂ Max (Running)',
  intensityMinModerate: 'Moderate Intensity Min',
  intensityMinVigorous: 'Vigorous Intensity Min',
  hillScore: 'Hill Score',
  enduranceScore: 'Endurance Score',
  activeCalories: 'Active Calories',
  bmrCalories: 'Resting Calories (BMR)',
};

export const WELLNESS_METRIC_UNITS: Record<WellnessNumericMetric, string> = {
  hrvWeeklyAvg: 'ms',
  sleepDurationSec: 'h',
  sleepScore: '',
  bodyBatteryHigh: '',
  bodyBatteryLow: '',
  readinessScore: '',
  trainingAcuteLoad: '',
  trainingChronicLoad: '',
  steps: '',
  floors: '',
  restingHR: 'bpm',
  vo2Max: 'mL/kg/min',
  intensityMinModerate: 'min',
  intensityMinVigorous: 'min',
  hillScore: '',
  enduranceScore: '',
  activeCalories: 'kcal',
  bmrCalories: 'kcal',
};

// ---------------------------------------------------------------------------
// Bucket types
// ---------------------------------------------------------------------------

export interface WellnessBucket {
  /** X-axis display label. */
  label: string;
  /** Aggregated numeric value, or null for empty buckets. */
  value: number | null;
  /**
   * Optional categorical color key (e.g. HRV status, training status).
   * Used by color-coded charts to pick bar color independently of value.
   */
  colorKey?: string;
}

export interface WellnessChartData {
  metric: WellnessNumericMetric;
  buckets: WellnessBucket[];
  /** Sum or average of all non-null values — shown in the chart header. */
  summary: number | null;
  /** Most recent non-null bucket value in the selected range. */
  latestValue: number | null;
}

/** Bucket for the training-status status chart (categorical, no numeric value). */
export interface WellnessStatusBucket {
  label: string;
  /** Garmin training status string, or '' for empty buckets. */
  status: string;
}

export interface WellnessStatusChartData {
  buckets: WellnessStatusBucket[];
}

// ---------------------------------------------------------------------------
// Local helpers (duplicated from strava.ts — not exported there)
// ---------------------------------------------------------------------------

function getISOWeek(d: Date): number {
  const tmp = new Date(d.getTime());
  tmp.setHours(0, 0, 0, 0);
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
  const jan4 = new Date(tmp.getFullYear(), 0, 4);
  return 1 + Math.round(((tmp.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}

function getBucketKey(dateStr: string, aggregation: StravaAggregation): string {
  if (aggregation === 'day') return dateStr;
  const d = new Date(dateStr + 'T00:00:00');
  return aggregation === 'week' ? `W${getISOWeek(d)}` : String(d.getMonth());
}

/** Return the modal (most common) string in an array, or '' if empty. */
function modalString(values: string[]): string {
  if (values.length === 0) return '';
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = '';
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) { bestCount = c; best = v; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Chart data builders
// ---------------------------------------------------------------------------

/**
 * Build bar-chart data for a single numeric wellness metric.
 *
 * Pass `colorKeyField` to attach a modal status string (e.g. 'hrvStatus') to
 * each bucket for use by color-coded charts.
 */
export function buildWellnessChartData(
  entries: GarminWellnessEntry[],
  metric: WellnessNumericMetric,
  range: string,
  aggregation: StravaAggregation,
  today: Date = new Date(),
  colorKeyField?: 'hrvStatus',
): WellnessChartData {
  const slots = generateBucketSlots(range, aggregation, today);
  const start = getRangeStart(range, today);
  const end = getRangeEnd(range, today);

  // Filter entries to the range
  const inRange = entries.filter(({ date }) => {
    const d = new Date(date + 'T00:00:00');
    return d >= start && d <= end;
  });

  // Group values (and optional color keys) by bucket key
  const valueMap = new Map<string, number[]>();
  const colorMap = new Map<string, string[]>();
  for (const entry of inRange) {
    const key = getBucketKey(entry.date, aggregation);
    const raw = entry[metric] as number | null;
    let display = raw;
    if (raw !== null && metric === 'sleepDurationSec') display = raw / 3600;
    if (display !== null) {
      if (!valueMap.has(key)) valueMap.set(key, []);
      valueMap.get(key)!.push(display);
    }
    if (colorKeyField) {
      const colorVal = entry[colorKeyField];
      if (colorVal) {
        if (!colorMap.has(key)) colorMap.set(key, []);
        colorMap.get(key)!.push(colorVal);
      }
    }
  }

  const isSum = SUM_METRICS.has(metric);
  let totalSum = 0;
  let totalCount = 0;

  const buckets: WellnessBucket[] = slots.map(({ key, label }) => {
    const vals = valueMap.get(key);
    let value: number | null = null;
    if (vals && vals.length > 0) {
      if (isSum) {
        value = vals.reduce((a, b) => a + b, 0);
        totalSum += value;
        totalCount++;
      } else {
        value = vals.reduce((a, b) => a + b, 0) / vals.length;
        totalSum += value;
        totalCount++;
      }
    }
    const bucket: WellnessBucket = { label, value };
    if (colorKeyField) {
      const colorVals = colorMap.get(key);
      bucket.colorKey = colorVals ? modalString(colorVals) : '';
    }
    return bucket;
  });

  const summary = totalCount > 0
    ? (isSum ? totalSum : totalSum / totalCount)
    : null;
  const latestValue = [...buckets].reverse().find((bucket) => bucket.value !== null)?.value ?? null;

  return { metric, buckets, summary, latestValue };
}

export function buildTrainingLoadRatioChartData(
  entries: GarminWellnessEntry[],
  range: string,
  aggregation: StravaAggregation,
  today: Date = new Date(),
): WellnessChartData {
  const acute = buildWellnessChartData(entries, 'trainingAcuteLoad', range, aggregation, today);
  const chronic = buildWellnessChartData(entries, 'trainingChronicLoad', range, aggregation, today);

  let total = 0;
  let count = 0;

  const buckets = acute.buckets.map((bucket, index) => {
    const acuteValue = bucket.value;
    const chronicValue = chronic.buckets[index]?.value ?? null;
    const ratio = acuteValue !== null && chronicValue !== null && chronicValue > 0
      ? acuteValue / chronicValue
      : null;

    if (ratio !== null && Number.isFinite(ratio)) {
      total += ratio;
      count++;
    }

    return {
      label: bucket.label,
      value: ratio,
    };
  });

  return {
    metric: 'trainingAcuteLoad',
    buckets,
    summary: count > 0 ? total / count : null,
    latestValue: [...buckets].reverse().find((bucket) => bucket.value !== null)?.value ?? null,
  };
}

/**
 * Build status-bar chart data for the training status metric.
 * Each bucket gets the modal training status string for the period.
 */
export function buildStatusChartData(
  entries: GarminWellnessEntry[],
  range: string,
  aggregation: StravaAggregation,
  today: Date = new Date(),
): WellnessStatusChartData {
  const slots = generateBucketSlots(range, aggregation, today);
  const start = getRangeStart(range, today);
  const end = getRangeEnd(range, today);

  const inRange = entries.filter(({ date }) => {
    const d = new Date(date + 'T00:00:00');
    return d >= start && d <= end;
  });

  const statusMap = new Map<string, string[]>();
  for (const entry of inRange) {
    if (!entry.trainingStatus) continue;
    const key = getBucketKey(entry.date, aggregation);
    if (!statusMap.has(key)) statusMap.set(key, []);
    statusMap.get(key)!.push(entry.trainingStatus);
  }

  const buckets: WellnessStatusBucket[] = slots.map(({ key, label }) => {
    const statuses = statusMap.get(key);
    return { label, status: statuses ? modalString(statuses) : '' };
  });

  return { buckets };
}

/**
 * Build combined intensity-minutes chart data (moderate + vigorous summed).
 *
 * When `weeklyGoal > 0`:
 * - In `'day'` aggregation: each bar's colorKey is set by comparing the
 *   7-day rolling sum ending on that date to the weekly goal.
 * - In `'week'` aggregation: the bar's colorKey compares the week's total to
 *   the weekly goal.
 * - In `'month'` aggregation: compares the month's total to the weekly goal × 4.
 *
 * colorKey values: `'below'` | `'met'` | `'exceeded'` | `''`
 */
export function buildIntensityMinCombinedChartData(
  entries: GarminWellnessEntry[],
  range: string,
  aggregation: StravaAggregation,
  weeklyGoal: number,
  today: Date = new Date(),
): WellnessChartData {
  const slots = generateBucketSlots(range, aggregation, today);
  const start = getRangeStart(range, today);
  const end = getRangeEnd(range, today);

  // Build a daily totals map: date → (moderate + vigorous) sum
  // Include all entries (not just those in range) so the rolling window works
  // for the first days of the range.
  const dailyTotals = new Map<string, number>();
  for (const entry of entries) {
    const mod = entry.intensityMinModerate ?? 0;
    const vig = entry.intensityMinVigorous ?? 0;
    if (entry.intensityMinModerate !== null || entry.intensityMinVigorous !== null) {
      dailyTotals.set(entry.date, mod + vig);
    }
  }

  if (aggregation === 'day') {
    let totalSum = 0;
    let totalCount = 0;

    const buckets: WellnessBucket[] = slots.map(({ key, label }) => {
      // key is the ISO date string in day mode
      const value = dailyTotals.has(key) ? dailyTotals.get(key)! : null;

      if (value !== null) {
        totalSum += value;
        totalCount++;
      }

      let colorKey = '';
      if (weeklyGoal > 0) {
        // Rolling 7-day sum ending on this date
        const endDate = new Date(key + 'T00:00:00');
        const startRoll = new Date(endDate);
        startRoll.setDate(startRoll.getDate() - 6);
        const startRollStr = startRoll.toISOString().slice(0, 10);

        let rollingSum = 0;
        for (const [d, v] of dailyTotals) {
          if (d >= startRollStr && d <= key) rollingSum += v;
        }

        colorKey = rollingSum >= weeklyGoal * 1.25 ? 'exceeded'
          : rollingSum >= weeklyGoal ? 'met'
          : 'below';
      }

      return { label, value, colorKey };
    });

    const summary = totalCount > 0 ? totalSum / totalCount : null;
    const latestValue = [...buckets].reverse().find((b) => b.value !== null)?.value ?? null;
    return { metric: 'intensityMinModerate', buckets, summary, latestValue };
  }

  // Week / month aggregation: sum moderate + vigorous per bucket
  const inRange = entries.filter(({ date }) => {
    const d = new Date(date + 'T00:00:00');
    return d >= start && d <= end;
  });

  const valueMap = new Map<string, number[]>();
  for (const entry of inRange) {
    if (entry.intensityMinModerate === null && entry.intensityMinVigorous === null) continue;
    const key = getBucketKey(entry.date, aggregation);
    const total = (entry.intensityMinModerate ?? 0) + (entry.intensityMinVigorous ?? 0);
    if (!valueMap.has(key)) valueMap.set(key, []);
    valueMap.get(key)!.push(total);
  }

  const scaledGoal = aggregation === 'month' ? weeklyGoal * 4 : weeklyGoal;

  let totalSum = 0;
  let totalCount = 0;

  const buckets: WellnessBucket[] = slots.map(({ key, label }) => {
    const vals = valueMap.get(key);
    let value: number | null = null;
    if (vals && vals.length > 0) {
      value = vals.reduce((a, b) => a + b, 0);
      totalSum += value;
      totalCount++;
    }

    let colorKey = '';
    if (weeklyGoal > 0 && value !== null) {
      colorKey = value >= scaledGoal * 1.25 ? 'exceeded'
        : value >= scaledGoal ? 'met'
        : 'below';
    }

    return { label, value, colorKey };
  });

  const summary = totalCount > 0 ? totalSum / totalCount : null;
  const latestValue = [...buckets].reverse().find((b) => b.value !== null)?.value ?? null;
  return { metric: 'intensityMinModerate', buckets, summary, latestValue };
}

// ---------------------------------------------------------------------------
// Goal coloring helpers
// ---------------------------------------------------------------------------

/** Color key values produced by goal-aware chart builders. */
export type GoalColorKey = 'below' | 'met' | 'exceeded' | '';

/**
 * Return the goal-comparison color for a given value and daily/periodic goal.
 * Aggregation scale: week = ×7, month = ×30, day = ×1.
 *
 * Returns `fallback` when goal is 0 (disabled) or value is null.
 */
export function goalColor(
  value: number | null,
  goal: number,
  aggregation: StravaAggregation,
  fallback: string,
): string {
  if (goal === 0 || value === null) return fallback;
  const scale = aggregation === 'week' ? 7 : aggregation === 'month' ? 30 : 1;
  const scaled = goal * scale;
  if (value >= scaled * 1.25) return '#2196f3'; // BLUE
  if (value >= scaled) return '#00e676';          // GREEN
  return '#ffea00';                               // YELLOW
}

/**
 * Map a `GoalColorKey` (pre-computed in chart data) to a display color.
 * Used by the intensity-minutes combined chart where rolling-window color
 * is embedded as a colorKey in each bucket.
 */
export function goalColorFromKey(colorKey: string | undefined, fallback: string): string {
  if (colorKey === 'exceeded') return '#2196f3'; // BLUE
  if (colorKey === 'met') return '#00e676';       // GREEN
  if (colorKey === 'below') return '#ffea00';     // YELLOW
  return fallback;
}

// ---------------------------------------------------------------------------
// Stacked calorie chart data builder
// ---------------------------------------------------------------------------

export interface StackedCaloriesBucket {
  label: string;
  active: number | null;
  bmr: number | null;
}

export interface StackedCaloriesChartData {
  buckets: StackedCaloriesBucket[];
  /** Average daily total (active + bmr) across all non-empty buckets. */
  summary: number | null;
  latestActive: number | null;
  latestBmr: number | null;
}

/**
 * Build per-bucket stacked calories data combining activeCalories (on top) and
 * bmrCalories (below). Values are summed within the aggregation period.
 */
export function buildStackedCaloriesChartData(
  entries: GarminWellnessEntry[],
  range: string,
  aggregation: StravaAggregation,
  today: Date = new Date(),
): StackedCaloriesChartData {
  const active = buildWellnessChartData(entries, 'activeCalories', range, aggregation, today);
  const bmr = buildWellnessChartData(entries, 'bmrCalories', range, aggregation, today);

  let totalSum = 0;
  let totalCount = 0;

  const buckets: StackedCaloriesBucket[] = active.buckets.map((ab, i) => {
    const bb = bmr.buckets[i];
    const total = (ab.value ?? 0) + (bb?.value ?? 0);
    if (ab.value !== null || bb?.value !== null) {
      totalSum += total;
      totalCount++;
    }
    return {
      label: ab.label,
      active: ab.value,
      bmr: bb?.value ?? null,
    };
  });

  const reversedBuckets = [...buckets].reverse();
  const latestActive = reversedBuckets.find((b) => b.active !== null)?.active ?? null;
  const latestBmr = reversedBuckets.find((b) => b.bmr !== null)?.bmr ?? null;

  return {
    buckets,
    summary: totalCount > 0 ? totalSum / totalCount : null,
    latestActive,
    latestBmr,
  };
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

export function formatWellnessValue(value: number | null, metric: WellnessNumericMetric): string {
  if (value === null) return '—';
  if (metric === 'sleepDurationSec') {
    // Already converted to hours by buildWellnessChartData
    const h = Math.floor(value);
    const m = Math.round((value - h) * 60);
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  if (metric === 'vo2Max' || metric === 'hillScore' || metric === 'enduranceScore') {
    return value.toFixed(1);
  }
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

export function formatWellnessRatio(value: number | null): string {
  if (value === null) return '—';
  return value.toFixed(2).replace(/\.?0+$/, '');
}
