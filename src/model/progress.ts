import type { ParsedLogRow } from '../google/sheets.js';
import { getRangeStart, getRangeEnd } from './strava.js';
import type { StravaTimeRange } from './strava.js';

/** A single data point on the progress chart. */
export interface ProgressDataPoint {
  date: string;
  value: number;
  /** Human-readable label for tooltips (e.g. "180 × 5" or "180 × 5 = 198"). */
  label?: string;
}

export type ProgressMetric = 'volume' | 'heaviest' | 'e1rm';

/** Time range for strength-progress charts. Shares the same vocabulary as StravaTimeRange,
 *  plus 'all' for the internal all-time baseline computation. */
export type TimeRange = StravaTimeRange | 'all';

/** Set types that count toward progress metrics. Warmup sets are excluded. */
const QUALIFYING_SET_TYPES = new Set(['work', 'backoff', 'joker']);

/** Check whether a log row should contribute to progress metrics. */
function isQualifyingSet(row: ParsedLogRow): boolean {
  return (
    row.completed &&
    QUALIFYING_SET_TYPES.has(row.setType)
  );
}

/** Result from a metric computation: the aggregate value plus a tooltip label. */
interface MetricResult {
  value: number;
  label: string;
}

/**
 * Total volume: sum of (weight × reps) across all qualifying sets in a session.
 * Label shows the top set (heaviest weight × its reps).
 */
export function computeVolume(sets: ParsedLogRow[]): number {
  return computeVolumeWithLabel(sets).value;
}

function computeVolumeWithLabel(sets: ParsedLogRow[]): MetricResult {
  const qualifying = sets.filter(isQualifyingSet);
  const value = qualifying.reduce((sum, s) => sum + s.actualWeight * s.actualReps, 0);
  if (qualifying.length === 0) return { value: 0, label: '' };
  // Top set = heaviest weight; on tie pick the one with more reps
  const top = qualifying.reduce((best, s) =>
    s.actualWeight > best.actualWeight ||
    (s.actualWeight === best.actualWeight && s.actualReps > best.actualReps)
      ? s : best,
  );
  return { value, label: `${top.actualWeight} × ${top.actualReps}` };
}

/**
 * Heaviest weight: the maximum weight used in any qualifying set in a session.
 * Label shows weight × reps for that set.
 */
export function computeHeaviest(sets: ParsedLogRow[]): number {
  return computeHeaviestWithLabel(sets).value;
}

function computeHeaviestWithLabel(sets: ParsedLogRow[]): MetricResult {
  const qualifying = sets.filter(isQualifyingSet);
  if (qualifying.length === 0) return { value: 0, label: '' };
  const top = qualifying.reduce((best, s) =>
    s.actualWeight > best.actualWeight ||
    (s.actualWeight === best.actualWeight && s.actualReps > best.actualReps)
      ? s : best,
  );
  return { value: top.actualWeight, label: `${top.actualWeight} × ${top.actualReps}` };
}

/**
 * Estimated 1RM using the Epley formula: weight × (1 + reps / 30).
 * Takes the highest result across all qualifying sets in a session.
 * Label shows weight × reps = e1RM.
 */
export function computeE1RM(sets: ParsedLogRow[]): number {
  return computeE1RMWithLabel(sets).value;
}

function computeE1RMWithLabel(sets: ParsedLogRow[]): MetricResult {
  const qualifying = sets.filter(isQualifyingSet);
  if (qualifying.length === 0) return { value: 0, label: '' };
  let bestE1RM = 0;
  let bestSet = qualifying[0];
  for (const s of qualifying) {
    const e = s.actualWeight * (1 + s.actualReps / 30);
    if (e > bestE1RM) {
      bestE1RM = e;
      bestSet = s;
    }
  }
  const rounded = Math.round(bestE1RM);
  return {
    value: bestE1RM,
    label: `${bestSet.actualWeight} × ${bestSet.actualReps} = ${rounded}`,
  };
}

const METRIC_FN_WITH_LABEL: Record<ProgressMetric, (sets: ParsedLogRow[]) => MetricResult> = {
  volume: computeVolumeWithLabel,
  heaviest: computeHeaviestWithLabel,
  e1rm: computeE1RMWithLabel,
};

/**
 * Get all unique lift IDs from log rows that have qualifying set data.
 * Returns array of { liftId, exerciseName } sorted by exerciseName.
 */
export function getLiftsWithData(
  logRows: ParsedLogRow[],
): { liftId: string; exerciseName: string }[] {
  const seen = new Map<string, string>();
  for (const row of logRows) {
    if (isQualifyingSet(row) && row.liftId && !seen.has(row.liftId)) {
      seen.set(row.liftId, row.exerciseName);
    }
  }
  return [...seen.entries()]
    .map(([liftId, exerciseName]) => ({ liftId, exerciseName }))
    .sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));
}

/**
 * A body-weight sample used to compute strength-to-bodyweight ratios.
 * `weight` must be in the same unit as lift weights (pounds).
 */
export interface BodyWeightPoint {
  date: string;
  weight: number;
}

/**
 * Find the body weight closest in time to `date` from a chronologically
 * ordered array. Returns null if the array is empty. Used to express an
 * estimated 1RM as a multiple of the athlete's body weight at that session.
 */
export function bodyWeightForDate(
  bodyWeights: readonly BodyWeightPoint[],
  date: string,
): number | null {
  if (bodyWeights.length === 0) return null;
  const target = Date.parse(date);
  let best = bodyWeights[0];
  let bestDiff = Math.abs(Date.parse(best.date) - target);
  for (let i = 1; i < bodyWeights.length; i++) {
    const diff = Math.abs(Date.parse(bodyWeights[i].date) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = bodyWeights[i];
    }
  }
  return best.weight;
}

/**
 * Ratio of an estimated 1RM (or any lift weight) to body weight, using the
 * body-weight measurement closest in time to `date`. Returns null when no
 * body-weight data is available or the nearest measurement is non-positive.
 */
export function bodyWeightRatio(
  value: number,
  date: string,
  bodyWeights: readonly BodyWeightPoint[],
): number | null {
  const bw = bodyWeightForDate(bodyWeights, date);
  if (bw === null || bw <= 0) return null;
  return value / bw;
}

/**
 * Get the start cutoff date string for a given time range, or null for 'all'.
 */
export function getCutoffDate(range: TimeRange): string | null {
  if (range === 'all') return null;
  const d = getRangeStart(range);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Get the end cutoff date string for a given time range, or null for 'all'.
 * Returns null for 'month' and 'year' (rolling windows — no hard end beyond today).
 */
export function getCutoffEnd(range: TimeRange): string | null {
  if (range === 'all' || range === 'month' || range === 'year') return null;
  // Specific year (e.g. '2025') → Dec 31 of that year
  const d = getRangeEnd(range);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Build progress data points for a given lift, metric, and time range.
 *
 * Groups log rows by (date + startTime) to identify individual sessions,
 * computes the selected metric for each session, and filters by time range.
 */
export function buildProgressData(
  logRows: ParsedLogRow[],
  liftId: string,
  metric: ProgressMetric,
  range: TimeRange,
): ProgressDataPoint[] {
  const cutoff = getCutoffDate(range);
  const cutoffEnd = getCutoffEnd(range);

  // Filter to the selected lift within the time range
  const liftRows = logRows.filter(
    (r) =>
      r.liftId === liftId &&
      (cutoff === null || r.date >= cutoff) &&
      (cutoffEnd === null || r.date <= cutoffEnd),
  );

  // Group by session (date + startTime)
  const sessions = new Map<string, ParsedLogRow[]>();
  for (const row of liftRows) {
    const key = `${row.date}|${row.startTime}`;
    const list = sessions.get(key);
    if (list) {
      list.push(row);
    } else {
      sessions.set(key, [row]);
    }
  }

  // Compute metric per session
  const fn = METRIC_FN_WITH_LABEL[metric];
  const points: ProgressDataPoint[] = [];
  for (const [key, sets] of sessions) {
    const { value, label } = fn(sets);
    if (value > 0) {
      const date = key.split('|')[0];
      points.push({ date, value, label });
    }
  }

  // Sort chronologically
  points.sort((a, b) => a.date.localeCompare(b.date));
  return points;
}

/**
 * Remove data points that are obviously from deload / taper / illness sessions.
 *
 * Hard filter: any point more than `threshold` (default 10%) below the
 * previous *kept* point is removed. If the last point in the series is a dip,
 * the series is truncated (ends early) rather than showing the drop.
 */
export function filterDips(
  points: ProgressDataPoint[],
  threshold = 0.10,
): ProgressDataPoint[] {
  if (points.length < 2) return points;

  const result: ProgressDataPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1].value;
    const curr = points[i].value;
    if (curr >= prev * (1 - threshold)) {
      result.push(points[i]);
    }
    // else: skip this point (it's a dip)
  }

  return result;
}
