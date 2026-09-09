import { describe, expect, it } from 'vitest';
import {
  activityChartHeaderValue,
  activityGoalBarCap,
  cappedTicksFor,
  getFilteredActivityGroups,
} from '../ActivitiesView.js';
import type { MetricChartData, StravaActivity } from '../../model/strava.js';

describe('activity chart header', () => {
  it('shows the selected range total instead of the latest sub-aggregate', () => {
    const data: MetricChartData = {
      metric: 'distance',
      buckets: [
        { label: 'Aug 1', value: 3 },
        { label: 'Aug 2', value: 5 },
      ],
      cumulative: [3, 8],
      proratedGoal: null,
      goalTrajectory: [],
      unit: 'miles',
      total: 8,
      latestValue: 5,
    };

    expect(activityChartHeaderValue(data)).toBe(8);
  });
});

describe('activity goal chart scale', () => {
  it('caps bars at three times the evenly allocated bucket goal', () => {
    expect(activityGoalBarCap(365, 365)).toBe(3);
    expect(activityGoalBarCap(1200, 12)).toBe(300);
  });

  describe('activity chart filtering', () => {
    const activity = (
      date: string,
      activityType: string,
      name: string,
    ): StravaActivity => ({
      date,
      activityType,
      name,
      duration: 3600,
      distance: 1000,
      elevationGain: 10,
    });

    it('combines date, type, and search filters for cardio charts', () => {
      const hike = activity('2025-06-17', 'Hike', 'Park loop');
      const run = activity('2025-06-16', 'Run', 'Park run');
      const oldHike = activity('2025-01-10', 'Hike', 'Park loop');

      expect(getFilteredActivityGroups(
        [hike, run, oldHike],
        'month',
        new Set(['Hike']),
        'park',
        new Date(2025, 5, 18),
      ).cardio).toEqual([hike]);
    });

    it('applies date and search to the dedicated strength chart', () => {
      const matching = activity('2025-06-17', 'Weight Training', 'Garage strength');
      const nonMatching = activity('2025-06-16', 'Weight Training', 'Gym strength');

      expect(getFilteredActivityGroups(
        [matching, nonMatching],
        'month',
        new Set(),
        'garage',
        new Date(2025, 5, 18),
      ).strength).toEqual([matching]);
    });
  });

  it('does not cap charts without an applicable goal', () => {
    expect(activityGoalBarCap(null, 30)).toBeNull();
    expect(activityGoalBarCap(0, 30)).toBeNull();
  });

  it('caps ticks at the exact goal-relative maximum', () => {
    expect(cappedTicksFor(3.7, 4)).toEqual([0, 1, 2, 3, 3.7]);
  });

  it('does not duplicate a naturally nice maximum', () => {
    expect(cappedTicksFor(3, 4)).toEqual([0, 1, 2, 3]);
  });
});
