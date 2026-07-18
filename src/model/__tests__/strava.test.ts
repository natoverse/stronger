import { describe, it, expect } from 'vitest';
import {
  toDisplayUnit,
  getRangeStart,
  getRangeEnd,
  getActivityTypes,
  filterActivities,
  filterActivitiesByRange,
  generateBucketSlots,
  prorateGoal,
  buildMetricChartData,
  formatMetricValue,
  getTimeRangeOptions,
  isStrengthTraining,
  splitActivities,
  STRENGTH_ACTIVITY_TYPE,
} from '../strava.js';
import type { StravaActivity, StravaAggregation } from '../strava.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeActivity(overrides: Partial<StravaActivity> = {}): StravaActivity {
  return {
    date: '2025-06-15',
    activityType: 'Run',
    duration: 3600,        // 1 hour
    distance: 10000,       // 10 km
    elevationGain: 100,    // 100 m
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  toDisplayUnit                                                      */
/* ------------------------------------------------------------------ */

describe('toDisplayUnit', () => {
  it('converts meters to miles', () => {
    expect(toDisplayUnit('distance', 1609.34)).toBeCloseTo(1.0, 1);
  });

  it('converts meters to feet', () => {
    expect(toDisplayUnit('elevationGain', 100)).toBeCloseTo(328.084, 1);
  });

  it('converts seconds to hours', () => {
    expect(toDisplayUnit('duration', 3600)).toBeCloseTo(1.0, 5);
  });
});

/* ------------------------------------------------------------------ */
/*  getRangeStart / getRangeEnd                                        */
/* ------------------------------------------------------------------ */

describe('getRangeStart', () => {
  it('returns 30 days ago for month range', () => {
    const today = new Date(2025, 5, 18); // June 18 2025
    const start = getRangeStart('month', today);
    // today - 29 days = May 20
    expect(start.getDate()).toBe(20);
    expect(start.getMonth()).toBe(4); // May
  });

  it('returns 365 days ago for rolling year range', () => {
    const today = new Date(2025, 5, 18); // June 18 2025
    const start = getRangeStart('year', today);
    // today - 364 days = June 19 2024
    expect(start.getFullYear()).toBe(2024);
    expect(start.getMonth()).toBe(5); // June
    expect(start.getDate()).toBe(19);
  });

  it('returns Jan 1 for a year range', () => {
    const today = new Date(2025, 5, 18);
    const start = getRangeStart('2025', today);
    expect(start.getMonth()).toBe(0);
    expect(start.getDate()).toBe(1);
    expect(start.getFullYear()).toBe(2025);
  });

  it('returns Jan 1 of specified year even if not current year', () => {
    const today = new Date(2025, 5, 18);
    const start = getRangeStart('2023', today);
    expect(start.getFullYear()).toBe(2023);
    expect(start.getMonth()).toBe(0);
    expect(start.getDate()).toBe(1);
  });
});

describe('getRangeEnd', () => {
  it('returns today for month range', () => {
    const today = new Date(2025, 5, 18); // June 18
    const end = getRangeEnd('month', today);
    expect(end.getDate()).toBe(18);
    expect(end.getMonth()).toBe(5);
  });

  it('returns today for rolling year range', () => {
    const today = new Date(2025, 5, 18);
    const end = getRangeEnd('year', today);
    expect(end.getDate()).toBe(18);
    expect(end.getMonth()).toBe(5);
  });

  it('returns Dec 31 for a year range', () => {
    const today = new Date(2025, 5, 18);
    const end = getRangeEnd('2025', today);
    expect(end.getMonth()).toBe(11);
    expect(end.getDate()).toBe(31);
    expect(end.getFullYear()).toBe(2025);
  });

  it('returns Dec 31 of specified past year', () => {
    const today = new Date(2025, 5, 18);
    const end = getRangeEnd('2023', today);
    expect(end.getFullYear()).toBe(2023);
    expect(end.getMonth()).toBe(11);
    expect(end.getDate()).toBe(31);
  });
});

/* ------------------------------------------------------------------ */
/*  getActivityTypes                                                   */
/* ------------------------------------------------------------------ */

describe('getActivityTypes', () => {
  it('returns sorted unique types', () => {
    const activities = [
      makeActivity({ activityType: 'Run' }),
      makeActivity({ activityType: 'Hike' }),
      makeActivity({ activityType: 'Run' }),
      makeActivity({ activityType: 'Ride' }),
    ];
    expect(getActivityTypes(activities)).toEqual(['Hike', 'Ride', 'Run']);
  });

  it('returns empty for no activities', () => {
    expect(getActivityTypes([])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  filterActivities                                                   */
/* ------------------------------------------------------------------ */

describe('filterActivities', () => {
  it('filters by date range and activity type', () => {
    const today = new Date(2025, 5, 18);
    const activities = [
      makeActivity({ date: '2025-06-16', activityType: 'Run' }),
      makeActivity({ date: '2025-06-17', activityType: 'Hike' }),
      makeActivity({ date: '2025-01-01', activityType: 'Run' }), // out of month range
    ];
    const result = filterActivities(activities, 'month', new Set(['Run']), today);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2025-06-16');
  });

  it('includes all types in selectedTypes', () => {
    const today = new Date(2025, 5, 18);
    const activities = [
      makeActivity({ date: '2025-06-16', activityType: 'Run' }),
      makeActivity({ date: '2025-06-17', activityType: 'Hike' }),
    ];
    const result = filterActivities(activities, 'month', new Set(['Run', 'Hike']), today);
    expect(result).toHaveLength(2);
  });

  it('filters by year range', () => {
    const today = new Date(2025, 5, 18);
    const activities = [
      makeActivity({ date: '2025-03-01', activityType: 'Run' }),
      makeActivity({ date: '2024-12-01', activityType: 'Run' }), // different year
    ];
    const result = filterActivities(activities, '2025', new Set(['Run']), today);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2025-03-01');
  });
});

describe('filterActivitiesByRange', () => {
  it('keeps every in-range activity type while excluding out-of-range rows', () => {
    const today = new Date(2025, 5, 18);
    const activities = [
      makeActivity({ date: '2025-06-16', activityType: 'Run' }),
      makeActivity({ date: '2025-06-17', activityType: 'Ride' }),
      makeActivity({ date: '2025-04-01', activityType: 'Hike' }),
    ];

    expect(filterActivitiesByRange(activities, 'month', today)).toEqual([
      activities[0],
      activities[1],
    ]);
  });
});

/* ------------------------------------------------------------------ */
/*  generateBucketSlots                                                */
/* ------------------------------------------------------------------ */

describe('generateBucketSlots', () => {
  it('generates weekly slots for month (default aggregation)', () => {
    const today = new Date(2025, 5, 15); // June 2025
    const slots = generateBucketSlots('month', 'week', today);
    expect(slots.length).toBeGreaterThanOrEqual(4);
    expect(slots.length).toBeLessThanOrEqual(6);
    expect(slots[0].label).toMatch(/^W\d+$/);
  });

  it('generates 12 monthly slots for a year with month aggregation', () => {
    const today = new Date(2025, 5, 15);
    const slots = generateBucketSlots('2025', 'month', today);
    expect(slots).toHaveLength(12);
    expect(slots[0].label).toBe('Jan');
    expect(slots[11].label).toBe('Dec');
  });

  it('generates 12 monthly slots for a past year with month aggregation', () => {
    const today = new Date(2025, 5, 15);
    const slots = generateBucketSlots('2023', 'month', today);
    expect(slots).toHaveLength(12);
    expect(slots[0].label).toBe('Jan');
    expect(slots[11].label).toBe('Dec');
  });

  it('generates daily slots for month range (last 30 days with M/D labels)', () => {
    // today = June 15; range = May 17 – June 15 (30 days)
    const today = new Date(2025, 5, 15);
    const slots = generateBucketSlots('month', 'day', today);
    expect(slots).toHaveLength(30);
    expect(slots[0].label).toBe('5/17');  // May 17
    expect(slots[29].label).toBe('6/15'); // June 15
  });

  it('generates daily slots for year range', () => {
    const today = new Date(2025, 5, 15);
    const slots = generateBucketSlots('2025', 'day', today);
    expect(slots).toHaveLength(365);
    expect(slots[0].label).toBe('1/1');
    expect(slots[364].label).toBe('12/31');
  });

  it('generates weekly slots for year range', () => {
    const today = new Date(2025, 5, 15);
    const slots = generateBucketSlots('2025', 'week', today);
    // A year has 52-53 ISO weeks overlapping
    expect(slots.length).toBeGreaterThanOrEqual(52);
    expect(slots.length).toBeLessThanOrEqual(54);
    expect(slots[0].label).toMatch(/^W\d+$/);
  });

  it('generates 1–2 monthly buckets for month range with month aggregation', () => {
    // today = June 15; range = May 17 – June 15 → spans May and June
    const today = new Date(2025, 5, 15);
    const slots = generateBucketSlots('month', 'month', today);
    expect(slots.length).toBeGreaterThanOrEqual(1);
    expect(slots.length).toBeLessThanOrEqual(2);
    expect(slots.some((s) => s.label === 'May')).toBe(true);
    expect(slots.some((s) => s.label === 'Jun')).toBe(true);
  });

  it('generates 12 monthly buckets for rolling year range', () => {
    const today = new Date(2025, 5, 15);
    const slots = generateBucketSlots('year', 'month', today);
    expect(slots).toHaveLength(12);
    expect(slots[0].label).toBe('Jan');
    expect(slots[11].label).toBe('Dec');
  });
});

/* ------------------------------------------------------------------ */
/*  prorateGoal                                                        */
/* ------------------------------------------------------------------ */

describe('prorateGoal', () => {
  it('returns null for past year range', () => {
    const today = new Date(2025, 5, 15);
    expect(prorateGoal(1000, '2024', today)).toBeNull();
  });

  it('returns full goal for current year range', () => {
    const today = new Date(2025, 5, 15);
    const result = prorateGoal(1000, '2025', today);
    expect(result).toBe(1000);
  });

  it('prorates annual goal to a month', () => {
    const today = new Date(2025, 5, 15); // June, 30 days
    const result = prorateGoal(1000, 'month', today);
    // 30 days / 365 days * 1000 ≈ 82.19
    expect(result).toBeGreaterThan(70);
    expect(result).toBeLessThan(100);
  });
});

/* ------------------------------------------------------------------ */
/*  buildMetricChartData                                               */
/* ------------------------------------------------------------------ */

describe('buildMetricChartData', () => {
  it('returns empty buckets when no activities have data for metric', () => {
    const activities = [makeActivity({ distance: 0 })];
    const data = buildMetricChartData(activities, 'distance', 'month', null);
    expect(data.buckets).toHaveLength(0);
    expect(data.total).toBe(0);
  });

  it('aggregates distance into weekly buckets for month view', () => {
    const today = new Date(2025, 5, 18); // June 2025
    const activities = [
      makeActivity({ date: '2025-06-02', distance: 5000 }),
      makeActivity({ date: '2025-06-03', distance: 3000 }),
      makeActivity({ date: '2025-06-18', distance: 10000 }),
    ];
    const data = buildMetricChartData(activities, 'distance', 'month', null, today, 'week');
    expect(data.buckets.length).toBeGreaterThanOrEqual(4);
    expect(data.total).toBeCloseTo(toDisplayUnit('distance', 18000), 1);
  });

  it('aggregates into monthly buckets for year view', () => {
    const today = new Date(2025, 5, 18);
    const activities = [
      makeActivity({ date: '2025-01-15', distance: 5000 }),
      makeActivity({ date: '2025-01-20', distance: 3000 }),
      makeActivity({ date: '2025-06-18', distance: 10000 }),
    ];
    const data = buildMetricChartData(activities, 'distance', '2025', null, today, 'month');
    expect(data.buckets).toHaveLength(12);
    // January bucket
    expect(data.buckets[0].value).toBeCloseTo(toDisplayUnit('distance', 8000), 1);
    // June bucket
    expect(data.buckets[5].value).toBeCloseTo(toDisplayUnit('distance', 10000), 1);
    // Other months = 0
    expect(data.buckets[2].value).toBe(0);
  });

  it('computes cumulative values', () => {
    const today = new Date(2025, 5, 18);
    const activities = [
      makeActivity({ date: '2025-01-15', distance: 5000 }),
      makeActivity({ date: '2025-03-10', distance: 10000 }),
    ];
    const data = buildMetricChartData(activities, 'distance', '2025', null, today, 'month');
    // Cumulative: Jan, Feb (no change), Mar, ...
    expect(data.cumulative[0]).toBeCloseTo(toDisplayUnit('distance', 5000), 1);
    expect(data.cumulative[1]).toBeCloseTo(toDisplayUnit('distance', 5000), 1); // no change
    expect(data.cumulative[2]).toBeCloseTo(toDisplayUnit('distance', 15000), 1);
  });

  it('truncates cumulative for in-progress current year', () => {
    const today = new Date(2025, 5, 18); // June 18, 2025
    const activities = [
      makeActivity({ date: '2025-01-15', distance: 5000 }),
      makeActivity({ date: '2025-03-10', distance: 10000 }),
    ];
    const data = buildMetricChartData(activities, 'distance', '2025', null, today, 'month');
    // Buckets should still be 12 (full year)
    expect(data.buckets).toHaveLength(12);
    // Cumulative should only go up to June (index 5), so 6 entries
    expect(data.cumulative).toHaveLength(6);
    // Cumulative values should be correct for the active months
    expect(data.cumulative[0]).toBeCloseTo(toDisplayUnit('distance', 5000), 1);
    expect(data.cumulative[5]).toBeCloseTo(toDisplayUnit('distance', 15000), 1);
  });

  it('does not truncate cumulative for a past year', () => {
    const today = new Date(2025, 5, 18);
    const activities = [
      makeActivity({ date: '2024-01-15', distance: 5000 }),
      makeActivity({ date: '2024-06-10', distance: 10000 }),
    ];
    const data = buildMetricChartData(activities, 'distance', '2024', null, today, 'month');
    // Past year: cumulative should cover all 12 months
    expect(data.buckets).toHaveLength(12);
    expect(data.cumulative).toHaveLength(12);
  });

  it('truncates cumulative for in-progress rolling month', () => {
    const today = new Date(2025, 5, 15); // June 15, 2025
    const activities = [
      // Both within the last 30 days (May 17 – June 15)
      makeActivity({ date: '2025-06-02', distance: 5000 }),
      makeActivity({ date: '2025-06-10', distance: 3000 }),
    ];
    const data = buildMetricChartData(activities, 'distance', 'month', null, today, 'day');
    // 30 day slots (May 17 – June 15)
    expect(data.buckets).toHaveLength(30);
    // today === range end (June 15 = last slot), so all 30 buckets are active
    expect(data.cumulative).toHaveLength(30);
  });

  it('includes prorated goal when provided', () => {
    const today = new Date(2025, 5, 18);
    const activities = [makeActivity({ date: '2025-06-16', distance: 5000 })];
    const data = buildMetricChartData(activities, 'distance', 'month', 1000, today, 'week');
    expect(data.proratedGoal).not.toBeNull();
    expect(data.proratedGoal!).toBeGreaterThan(0);
  });

  it('computes goalTrajectory as linear ramp through buckets', () => {
    const today = new Date(2025, 5, 18);
    const activities = [
      makeActivity({ date: '2025-01-15', distance: 5000 }),
      makeActivity({ date: '2025-06-18', distance: 10000 }),
    ];
    const data = buildMetricChartData(activities, 'distance', '2025', 1200, today, 'month');
    // Year range with 12 buckets, goal = 1200 miles
    expect(data.goalTrajectory).toHaveLength(12);
    expect(data.goalTrajectory[0]).toBeCloseTo(100, 1);   // 1200 * 1/12
    expect(data.goalTrajectory[5]).toBeCloseTo(600, 1);   // 1200 * 6/12
    expect(data.goalTrajectory[11]).toBeCloseTo(1200, 1); // 1200 * 12/12
  });

  it('returns empty goalTrajectory when no goal is set', () => {
    const today = new Date(2025, 5, 18);
    const activities = [makeActivity({ date: '2025-06-16', distance: 5000 })];
    const data = buildMetricChartData(activities, 'distance', 'month', null, today, 'week');
    expect(data.goalTrajectory).toEqual([]);
  });

  it('returns empty goalTrajectory for past year', () => {
    const today = new Date(2025, 5, 18);
    const activities = [makeActivity({ date: '2024-06-16', distance: 5000 })];
    const data = buildMetricChartData(activities, 'distance', '2024', 1000, today, 'month');
    // prorateGoal returns null for past years
    expect(data.goalTrajectory).toEqual([]);
  });

  it('handles duration metric', () => {
    const today = new Date(2025, 5, 18);
    const activities = [makeActivity({ date: '2025-06-16', duration: 7200 })]; // 2 hours
    const data = buildMetricChartData(activities, 'duration', 'month', null, today, 'week');
    // Find the bucket containing the activity
    const totalDuration = data.buckets.reduce((sum, b) => sum + b.value, 0);
    expect(totalDuration).toBeCloseTo(2.0, 1);
    expect(data.unit).toBe('hours');
  });

  it('handles elevationGain metric', () => {
    const today = new Date(2025, 5, 18);
    const activities = [makeActivity({ date: '2025-06-16', elevationGain: 500 })]; // 500m
    const data = buildMetricChartData(activities, 'elevationGain', 'month', null, today, 'week');
    const totalElevation = data.buckets.reduce((sum, b) => sum + b.value, 0);
    expect(totalElevation).toBeCloseTo(toDisplayUnit('elevationGain', 500), 0);
    expect(data.unit).toBe('feet');
  });

  it('aggregates into daily buckets', () => {
    const today = new Date(2025, 5, 18); // June 18
    const activities = [
      makeActivity({ date: '2025-06-02', distance: 5000 }),
      makeActivity({ date: '2025-06-02', distance: 3000 }), // same day
      makeActivity({ date: '2025-06-18', distance: 10000 }),
    ];
    const data = buildMetricChartData(activities, 'distance', 'month', null, today, 'day');
    // 30 day slots (May 20 – June 18)
    expect(data.buckets).toHaveLength(30);
    // June 2 = May 20 + 13 days → index 13
    expect(data.buckets[13].value).toBeCloseTo(toDisplayUnit('distance', 8000), 1);
    // June 18 = last slot → index 29
    expect(data.buckets[29].value).toBeCloseTo(toDisplayUnit('distance', 10000), 1);
    expect(data.latestValue).toBeCloseTo(toDisplayUnit('distance', 10000), 1);
  });

  it('uses the most recent active bucket value for latestValue', () => {
    const today = new Date(2025, 5, 18); // June 18
    const activities = [
      makeActivity({ date: '2025-06-02', distance: 5000 }),
      makeActivity({ date: '2025-06-10', distance: 3000 }),
    ];
    const data = buildMetricChartData(activities, 'distance', 'month', null, today, 'day');
    expect(data.latestValue).toBeCloseTo(toDisplayUnit('distance', 3000), 1);
  });
});

/* ------------------------------------------------------------------ */
/*  getTimeRangeOptions                                                */
/* ------------------------------------------------------------------ */

describe('getTimeRangeOptions', () => {
  it('returns Month, Year, current year and 3 prior years (6 total)', () => {
    const today = new Date(2025, 5, 15);
    const options = getTimeRangeOptions(today);
    expect(options).toHaveLength(6);
    expect(options[0]).toEqual({ value: 'month', label: 'Month' });
    expect(options[1]).toEqual({ value: 'year', label: 'Year' });
    expect(options[2]).toEqual({ value: '2025', label: '2025' });
    expect(options[5]).toEqual({ value: '2022', label: '2022' });
  });
});

/* ------------------------------------------------------------------ */
/*  formatMetricValue                                                  */
/* ------------------------------------------------------------------ */

describe('formatMetricValue', () => {
  it('formats large elevation values with k suffix', () => {
    expect(formatMetricValue(15000, 'elevationGain')).toBe('15k');
    expect(formatMetricValue(1500, 'elevationGain')).toBe('1.5k');
  });

  it('formats small distance values with decimals', () => {
    expect(formatMetricValue(3.14, 'distance')).toBe('3.14');
    expect(formatMetricValue(12.5, 'distance')).toBe('12.5');
  });

  it('formats duration with appropriate precision', () => {
    expect(formatMetricValue(1.5, 'duration')).toBe('1.50');
    expect(formatMetricValue(25.3, 'duration')).toBe('25.3');
  });
});

/* ------------------------------------------------------------------ */
/*  isStrengthTraining                                                 */
/* ------------------------------------------------------------------ */

describe('isStrengthTraining', () => {
  it('returns true for Weight Training', () => {
    expect(isStrengthTraining(STRENGTH_ACTIVITY_TYPE)).toBe(true);
  });

  it('returns false for cardio types', () => {
    expect(isStrengthTraining('Run')).toBe(false);
    expect(isStrengthTraining('Ride')).toBe(false);
    expect(isStrengthTraining('Hike')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  splitActivities                                                    */
/* ------------------------------------------------------------------ */

describe('splitActivities', () => {
  it('separates strength from cardio', () => {
    const activities = [
      makeActivity({ activityType: 'Run' }),
      makeActivity({ activityType: 'Weight Training', distance: 0, elevationGain: 0 }),
      makeActivity({ activityType: 'Hike' }),
      makeActivity({ activityType: 'Weight Training', distance: 0, elevationGain: 0 }),
    ];
    const { cardio, strength } = splitActivities(activities);
    expect(cardio).toHaveLength(2);
    expect(strength).toHaveLength(2);
    expect(cardio.every(a => a.activityType !== 'Weight Training')).toBe(true);
    expect(strength.every(a => a.activityType === 'Weight Training')).toBe(true);
  });

  it('returns all as cardio when no strength activities', () => {
    const activities = [
      makeActivity({ activityType: 'Run' }),
      makeActivity({ activityType: 'Ride' }),
    ];
    const { cardio, strength } = splitActivities(activities);
    expect(cardio).toHaveLength(2);
    expect(strength).toHaveLength(0);
  });

  it('handles empty input', () => {
    const { cardio, strength } = splitActivities([]);
    expect(cardio).toHaveLength(0);
    expect(strength).toHaveLength(0);
  });
});
