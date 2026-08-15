import { describe, expect, it } from 'vitest';
import { activityGoalBarCap, cappedTicksFor } from '../ActivitiesView.js';

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
