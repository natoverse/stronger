import { describe, expect, it } from 'vitest';
import {
  formatDistance,
  formatDuration,
  formatElevation,
  garminActivityUrl,
  getDisplayedActivities,
  getSelectableActivityTypes,
} from '../GarminActivitiesListView.js';
import type { StravaActivity } from '../../model/strava.js';

function activity(date: string, name: string): StravaActivity {
  return {
    date,
    activityType: 'Run',
    name,
    duration: 3600,
    distance: 1609.344,
    elevationGain: 0,
  };
}

describe('Garmin activity card formatting', () => {
  it('formats duration as hours and zero-padded minutes', () => {
    expect(formatDuration(45 * 60)).toBe('0:45');
    expect(formatDuration(65 * 60)).toBe('1:05');
    expect(formatDuration(0)).toBe('—');
  });

  describe('Garmin activity log filtering', () => {
    const activities = [
      activity('2025-06-16', 'Current run'),
      activity('2025-01-10', 'Older run'),
    ];
    const selectedTypes = new Set(['Run']);
    const today = new Date(2025, 5, 18);

    it('shows only activities in the selected period without a search', () => {
      expect(getDisplayedActivities(activities, 'month', selectedTypes, '', today)).toEqual([
        activities[0],
      ]);
    });

    it('combines search with the selected period', () => {
      expect(getDisplayedActivities(activities, 'month', selectedTypes, 'older', today)).toEqual([]);
    });

    it('combines activity type, search, and date filters', () => {
      const hike = { ...activity('2025-06-17', 'Park loop'), activityType: 'Hike' };
      const run = activity('2025-06-16', 'Park run');
      expect(getDisplayedActivities(
        [hike, run, activities[1]],
        'month',
        new Set(['Hike']),
        'park',
        today,
      )).toEqual([hike]);
    });

    it('sorts activities on the same day by start time descending', () => {
      const morning = { ...activity('2025-06-17', 'Morning run'), startTime: '07:15:00' };
      const evening = { ...activity('2025-06-17', 'Evening run'), startTime: '18:30:00' };
      const afternoon = { ...activity('2025-06-17', 'Afternoon run'), startTime: '13:45:00' };

      expect(getDisplayedActivities(
        [morning, evening, afternoon],
        'month',
        selectedTypes,
        '',
        today,
      )).toEqual([evening, afternoon, morning]);
    });

    it('excludes strength training from selectable activity types', () => {
      const strength = { ...activity('2025-06-17', 'Lifting'), activityType: 'Weight Training' };
      expect(getSelectableActivityTypes([strength, activities[0]])).toEqual(['Run']);
    });

    it('returns to the selected period when search is cleared', () => {
      getDisplayedActivities(activities, 'month', selectedTypes, 'older', today);
      expect(getDisplayedActivities(activities, 'month', selectedTypes, '', today)).toEqual([
        activities[0],
      ]);
    });
  });

  it('formats distance without a space before miles', () => {
    expect(formatDistance(1609.344)).toBe('1.00mi');
    expect(formatDistance(0)).toBe('');
  });

  it('formats elevation with a single quotation mark', () => {
    expect(formatElevation(30.48)).toBe('100‘');
    expect(formatElevation(0)).toBe('');
  });

  it('builds a Garmin Connect link from the activity id', () => {
    expect(garminActivityUrl('24229675607')).toBe(
      'https://connect.garmin.com/app/activity/24229675607',
    );
  });

  it('returns null when the activity id is missing or not numeric', () => {
    expect(garminActivityUrl(undefined)).toBeNull();
    expect(garminActivityUrl('')).toBeNull();
    expect(garminActivityUrl('javascript:alert(1)')).toBeNull();
  });
});
