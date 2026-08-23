import { describe, expect, it } from 'vitest';
import {
  activityChartHeaderValue,
  activityGoalBarCap,
  cappedTicksFor,
} from '../ActivitiesView.js';
import type { MetricChartData } from '../../model/strava.js';

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
