/**
 * Strava activity chart data model and aggregation logic.
 *
 * Consumes activity data from the "Stronger - Strava" sheet tab and
 * produces chart-ready data: bucketed bars, cumulative totals, and
 * prorated goal lines.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** A single Strava activity row (subset consumed by charts). */
export interface StravaActivity {
  /** ISO date string YYYY-MM-DD */
  date: string;
  /** Activity type (e.g. "Run", "Ride", "Hike") */
  activityType: string;
  /** Activity name (e.g. "Morning Run"). Set by Garmin/Strava parsers. */
  name?: string;
  /** Duration in seconds */
  duration: number;
  /** Distance in meters */
  distance: number;
  /** Elevation gain in meters */
  elevationGain: number;
  /** Elevation loss in meters (Garmin activities only) */
  elevationLoss?: number;
  /** Calories burned (optional; populated by Garmin/Strava sheet parsers). */
  calories?: number;
  /** Active calories burned (optional; Garmin only). */
  activeCalories?: number;
  /** Total calories burned (optional; Garmin only). */
  totalCalories?: number;
}

/** An annual goal for a single metric. */
export interface StravaGoal {
  /** 'duration' | 'distance' | 'elevationGain' */
  metric: StravaMetric;
  /** Target value in display units (hours, miles, feet) */
  value: number;
}

export type StravaMetric = 'distance' | 'elevationGain' | 'duration';

/**
 * Time range selector for activity charts.
 * - 'month': rolling last 30 days
 * - 'year': rolling last 365 days
 * - A 4-digit year string (e.g. '2026'): that full calendar year (Jan 1 – Dec 31)
 */
export type StravaTimeRange = string;

/** Bucket aggregation granularity for charts. */
export type StravaAggregation = 'day' | 'week' | 'month';

/** A single bar in the chart (one time bucket). */
export interface ChartBucket {
  /** Human-readable label for the bucket (e.g. "Mon", "W3", "Jan") */
  label: string;
  /** Aggregated metric value in display units */
  value: number;
}

/** Complete chart data for a single metric. */
export interface MetricChartData {
  metric: StravaMetric;
  buckets: ChartBucket[];
  /** Cumulative values at each bucket boundary (same length as buckets) */
  cumulative: number[];
  /** Prorated goal value for the selected time range, or null if no goal */
  proratedGoal: number | null;
  /**
   * Linear goal trajectory at each bucket (same length as buckets).
   * Shows where cumulative progress should be if progressing linearly
   * toward the prorated goal. Empty array when no goal is set.
   */
  goalTrajectory: number[];
  /** Display unit label */
  unit: string;
  /** Total across all buckets */
  total: number;
  /** Value of the most recently recorded activity within the active range. */
  latestValue: number | null;
}

/* ------------------------------------------------------------------ */
/*  Unit conversions (storage → display)                               */
/* ------------------------------------------------------------------ */

const METERS_TO_MILES = 0.000621371;
const METERS_TO_FEET = 3.28084;
const SECONDS_TO_HOURS = 1 / 3600;

/** Convert a raw metric value from storage units to display units. */
export function toDisplayUnit(metric: StravaMetric, value: number): number {
  switch (metric) {
    case 'distance':
      return value * METERS_TO_MILES;
    case 'elevationGain':
      return value * METERS_TO_FEET;
    case 'duration':
      return value * SECONDS_TO_HOURS;
  }
}

export const METRIC_UNITS: Record<StravaMetric, string> = {
  distance: 'miles',
  elevationGain: 'feet',
  duration: 'hours',
};

export const METRIC_LABELS: Record<StravaMetric, string> = {
  distance: 'Distance',
  elevationGain: 'Elevation Gain',
  duration: 'Duration',
};

/* ------------------------------------------------------------------ */
/*  Activity classification                                            */
/* ------------------------------------------------------------------ */

/** Activity type used by Strava for strength workouts. */
export const STRENGTH_ACTIVITY_TYPE = 'Weight Training';

/** Check if an activity type is strength training. */
export function isStrengthTraining(activityType: string): boolean {
  return activityType === STRENGTH_ACTIVITY_TYPE;
}

/** Split activities into cardio and strength training. */
export function splitActivities(activities: StravaActivity[]): {
  cardio: StravaActivity[];
  strength: StravaActivity[];
} {
  const cardio: StravaActivity[] = [];
  const strength: StravaActivity[] = [];
  for (const a of activities) {
    if (isStrengthTraining(a.activityType)) {
      strength.push(a);
    } else {
      cardio.push(a);
    }
  }
  return { cardio, strength };
}

/* ------------------------------------------------------------------ */
/*  Time range helpers                                                 */
/* ------------------------------------------------------------------ */

/** Parse a year from a range string, or null if it's 'month' or 'year'. */
function parseYearRange(range: StravaTimeRange): number | null {
  if (range === 'month' || range === 'year') return null;
  const year = parseInt(range, 10);
  return year >= 2000 ? year : null;
}

/** Get the start date (inclusive) for a time range anchored to today. */
export function getRangeStart(range: StravaTimeRange, today: Date = new Date()): Date {
  const d = new Date(today);
  d.setHours(0, 0, 0, 0);

  const year = parseYearRange(range);
  if (year !== null) {
    // Specific year: Jan 1
    return new Date(year, 0, 1);
  }
  if (range === 'year') {
    // Rolling last 365 days: today − 364 days (inclusive of today = 365 total)
    d.setDate(d.getDate() - 364);
    return d;
  }
  // 'month': rolling last 30 days
  d.setDate(d.getDate() - 29);
  return d;
}

/** Get the end date (inclusive) for a time range anchored to today. */
export function getRangeEnd(range: StravaTimeRange, today: Date = new Date()): Date {
  const year = parseYearRange(range);
  if (year !== null) {
    // Specific year: Dec 31
    const end = new Date(year, 11, 31);
    end.setHours(23, 59, 59, 999);
    return end;
  }
  // 'month' and 'year': rolling window ending today
  const d = new Date(today);
  d.setHours(23, 59, 59, 999);
  return d;
}

/* ------------------------------------------------------------------ */
/*  Activity filtering                                                 */
/* ------------------------------------------------------------------ */

/** Get unique activity types from the data. */
export function getActivityTypes(activities: StravaActivity[]): string[] {
  return [...new Set(activities.map((a) => a.activityType))].sort();
}

/** Filter activities by date range and activity types. */
export function filterActivities(
  activities: StravaActivity[],
  range: StravaTimeRange,
  selectedTypes: Set<string>,
  today: Date = new Date(),
): StravaActivity[] {
  const start = getRangeStart(range, today);
  const end = getRangeEnd(range, today);
  const startStr = toISODate(start);
  const endStr = toISODate(end);

  return activities.filter(
    (a) =>
      a.date >= startStr &&
      a.date <= endStr &&
      selectedTypes.has(a.activityType),
  );
}

/** Filter activities only by the selected time range, keeping all types. */
export function filterActivitiesByRange(
  activities: StravaActivity[],
  range: StravaTimeRange,
  today: Date = new Date(),
): StravaActivity[] {
  return filterActivities(activities, range, new Set(getActivityTypes(activities)), today);
}

/* ------------------------------------------------------------------ */
/*  Bucketing                                                          */
/* ------------------------------------------------------------------ */

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Build the list of time range options: Month (30 days), Year (365 days), current year, and 3 prior years. */
export function getTimeRangeOptions(today: Date = new Date()): { value: StravaTimeRange; label: string }[] {
  const currentYear = today.getFullYear();
  return [
    { value: 'month', label: 'Month' },
    { value: 'year', label: 'Year' },
    { value: String(currentYear), label: String(currentYear) },
    ...Array.from({ length: 3 }, (_, i) => ({
      value: String(currentYear - 1 - i),
      label: String(currentYear - 1 - i),
    })),
  ];
}

/** Get ISO week number for a date. */
function getISOWeek(d: Date): number {
  const tmp = new Date(d.getTime());
  tmp.setHours(0, 0, 0, 0);
  // Thursday of this week
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
  const jan4 = new Date(tmp.getFullYear(), 0, 4);
  return 1 + Math.round(((tmp.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}

/**
 * Assign a bucket key to an activity based on the aggregation level.
 * - day: ISO date "YYYY-MM-DD"
 * - week: ISO week number "W{n}"
 * - month: month index "0"-"11"
 */
export function getBucketKey(dateStr: string, aggregation: StravaAggregation): string {
  if (aggregation === 'day') return dateStr;
  const d = new Date(dateStr + 'T00:00:00');
  return aggregation === 'week' ? `W${getISOWeek(d)}` : String(d.getMonth());
}

/** Generate all expected bucket keys and labels for a time range and aggregation. */
export function generateBucketSlots(
  range: StravaTimeRange,
  aggregation: StravaAggregation = 'week',
  today: Date = new Date(),
): { key: string; label: string }[] {
  const start = getRangeStart(range, today);
  const end = getRangeEnd(range, today);

  switch (aggregation) {
    case 'day': {
      const slots: { key: string; label: string }[] = [];
      const cursor = new Date(start);
      while (cursor <= end) {
        const key = toISODate(cursor);
        const label = `${cursor.getMonth() + 1}/${cursor.getDate()}`;
        slots.push({ key, label });
        cursor.setDate(cursor.getDate() + 1);
      }
      return slots;
    }

    case 'week': {
      const slots: { key: string; label: string }[] = [];
      const seen = new Set<string>();
      const cursor = new Date(start);
      while (cursor <= end) {
        const wk = getISOWeek(cursor);
        const key = `W${wk}`;
        if (!seen.has(key)) {
          seen.add(key);
          slots.push({ key, label: `W${wk}` });
        }
        cursor.setDate(cursor.getDate() + 7);
      }
      // Also check the end date's week
      const endWk = getISOWeek(end);
      const endKey = `W${endWk}`;
      if (!seen.has(endKey)) {
        slots.push({ key: endKey, label: `W${endWk}` });
      }
      return slots;
    }

    case 'month': {
      if (range === 'month') {
        // 'month' = last 30 days; may span two calendar months — emit one slot per distinct month
        const slots: { key: string; label: string }[] = [];
        const seen = new Set<string>();
        const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
        while (cursor <= end) {
          const key = String(cursor.getMonth());
          if (!seen.has(key)) {
            seen.add(key);
            slots.push({ key, label: MONTH_LABELS[cursor.getMonth()] });
          }
          cursor.setMonth(cursor.getMonth() + 1);
        }
        return slots;
      }
      // Year-based range ('year' rolling or specific year string) → 12 monthly buckets
      return MONTH_LABELS.map((label, i) => ({ key: String(i), label }));
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Goal proration                                                     */
/* ------------------------------------------------------------------ */

/**
 * Prorate an annual goal to the selected time range.
 * Returns the full goal for the current year and rolling 'year' range,
 * prorated for 'month', or null for past years.
 */
export function prorateGoal(
  annualGoal: number,
  range: StravaTimeRange,
  today: Date = new Date(),
): number | null {
  const year = parseYearRange(range);
  if (year !== null) {
    // Current year → full goal; past years → no goal
    return year === today.getFullYear() ? annualGoal : null;
  }

  if (range === 'year') {
    // Rolling 365 days → full year goal
    return annualGoal;
  }

  // 'month': prorate by days (rolling 30-day window)
  const start = getRangeStart(range, today);
  const end = getRangeEnd(range, today);
  const rangeDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24) + 1;

  const yearStart = new Date(today.getFullYear(), 0, 1);
  const yearEnd = new Date(today.getFullYear(), 11, 31);
  const yearDays = (yearEnd.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24) + 1;

  return annualGoal * (rangeDays / yearDays);
}

/* ------------------------------------------------------------------ */
/*  Main chart data builder                                            */
/* ------------------------------------------------------------------ */

/**
 * Build chart data for a single metric from filtered activities.
 *
 * @param activities - Already filtered by date range and activity type
 * @param metric - Which metric to aggregate
 * @param range - Time range (determines date boundaries)
 * @param goal - Annual goal value in display units, or null
 * @param today - Reference date for range calculations
 * @param aggregation - Bucket granularity (day/week/month)
 */
export function buildMetricChartData(
  activities: StravaActivity[],
  metric: StravaMetric,
  range: StravaTimeRange,
  goal: number | null,
  today: Date = new Date(),
  aggregation: StravaAggregation = 'week',
): MetricChartData {
  // Check if any activity has data for this metric
  const hasData = activities.some((a) => {
    const raw = a[metric];
    return typeof raw === 'number' && raw > 0;
  });

  if (!hasData) {
    return {
      metric,
      buckets: [],
      cumulative: [],
      proratedGoal: null,
      goalTrajectory: [],
      unit: METRIC_UNITS[metric],
      total: 0,
      latestValue: null,
    };
  }

  const slots = generateBucketSlots(range, aggregation, today);

  // Aggregate into buckets
  const bucketMap = new Map<string, number>();
  for (const { key } of slots) {
    bucketMap.set(key, 0);
  }

  for (const activity of activities) {
    const raw = activity[metric];
    if (typeof raw !== 'number' || raw <= 0) continue;
    const displayVal = toDisplayUnit(metric, raw);
    const key = getBucketKey(activity.date, aggregation);
    bucketMap.set(key, (bucketMap.get(key) ?? 0) + displayVal);
  }

  const buckets: ChartBucket[] = slots.map(({ key, label }) => ({
    label,
    value: bucketMap.get(key) ?? 0,
  }));

  // Cumulative
  const fullCumulative: number[] = [];
  let running = 0;
  for (const b of buckets) {
    running += b.value;
    fullCumulative.push(running);
  }

  // Truncate cumulative for in-progress time periods:
  // Only show cumulative up to the bucket containing today.
  const rangeEnd = getRangeEnd(range, today);
  let activeBucketCount = buckets.length;
  if (today < rangeEnd) {
    const todayKey = getBucketKey(toISODate(today), aggregation);
    const currentIdx = slots.findIndex((s) => s.key === todayKey);
    if (currentIdx >= 0) {
      activeBucketCount = currentIdx + 1;
    }
  }
  const cumulative = fullCumulative.slice(0, activeBucketCount);
  const rangeStartISO = toISODate(getRangeStart(range, today));
  const rangeEndISO = toISODate(getRangeEnd(range, today));
  const latestActivity = activities.reduce<StravaActivity | null>((latest, activity) => {
    if (activity.date < rangeStartISO || activity.date > rangeEndISO) return latest;
    const raw = activity[metric];
    if (typeof raw !== 'number' || raw <= 0) return latest;
    return latest === null || activity.date >= latest.date ? activity : latest;
  }, null);
  const latestValue = latestActivity === null
    ? null
    : toDisplayUnit(metric, latestActivity[metric] as number);

  const proratedGoal = goal !== null ? prorateGoal(goal, range, today) : null;

  // Goal trajectory: linear ramp from 0 to proratedGoal through each bucket
  const goalTrajectory: number[] =
    proratedGoal !== null
      ? buckets.map((_, i) => proratedGoal * ((i + 1) / buckets.length))
      : [];

  return {
    metric,
    buckets,
    cumulative,
    proratedGoal,
    goalTrajectory,
    unit: METRIC_UNITS[metric],
    total: running,
    latestValue,
  };
}

/* ------------------------------------------------------------------ */
/*  Value formatting                                                   */
/* ------------------------------------------------------------------ */

/** Format a display-unit value for axis labels. */
export function formatMetricValue(v: number, metric: StravaMetric): string {
  if (metric === 'duration') {
    if (v >= 100) return `${Math.round(v)}`;
    if (v >= 10) return v.toFixed(1);
    return v.toFixed(2);
  }
  if (metric === 'elevationGain') {
    if (v >= 10000) return `${(v / 1000).toFixed(0)}k`;
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return Math.round(v).toString();
  }
  // distance
  if (v >= 100) return Math.round(v).toString();
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
