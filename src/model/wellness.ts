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
  | 'hrvLastNight'
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
  | 'enduranceScore';

/** Metrics that are SUMmed when aggregating (vs averaged). */
const SUM_METRICS = new Set<WellnessNumericMetric>([
  'steps',
  'floors',
  'intensityMinModerate',
  'intensityMinVigorous',
]);

export const WELLNESS_METRIC_LABELS: Record<WellnessNumericMetric, string> = {
  hrvLastNight: 'Overnight HRV',
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
};

export const WELLNESS_METRIC_UNITS: Record<WellnessNumericMetric, string> = {
  hrvLastNight: 'ms',
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

  return { metric, buckets, summary };
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
