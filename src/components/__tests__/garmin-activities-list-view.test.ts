import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GarminActivitiesListView,
  formatDistance,
  formatDuration,
  formatElevation,
  formatActivityCount,
  garminActivityUrl,
  getDisplayedActivities,
  getSelectableActivityTypes,
  getActivityAverages,
} from '../GarminActivitiesListView.js';
import type { StravaActivity } from '../../model/strava.js';

function activity(timestamp: string, name: string): StravaActivity {
  return {
    timestamp: `${timestamp}T00:00:00`,
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

  describe('Garmin activity list averages', () => {
    const first = {
      ...activity('2025-06-16', 'Park run'),
      distance: 1609.344,
      duration: 3600,
      elevationGain: 30.48,
      elevationLoss: 60.96,
    };
    const second = {
      ...activity('2025-06-17', 'Park loop'),
      activityType: 'Hike',
      distance: 3 * 1609.344,
      duration: 7200,
      elevationGain: 91.44,
      elevationLoss: 121.92,
    };

    afterEach(() => vi.useRealTimers());

    it('computes arithmetic means in storage units before formatting', () => {
      const averages = getActivityAverages([first, second]);
      expect(averages.distance).toBeCloseTo(2 * 1609.344);
      expect(averages.duration).toBe(5400);
      expect(averages.elevationGain).toBeCloseTo(60.96);
      expect(averages.elevationLoss).toBeCloseTo(91.44);
    });

    it('includes recorded zeroes but excludes missing and invalid values per metric', () => {
      expect(getActivityAverages([
        { ...first, distance: 100, duration: 60, elevationGain: 10, elevationLoss: 20 },
        { ...first, distance: 0, duration: 0, elevationGain: 0, elevationLoss: undefined },
        { ...first, distance: NaN, duration: Infinity, elevationGain: -1, elevationLoss: 0 },
      ])).toEqual({ distance: 50, duration: 30, elevationGain: 5, elevationLoss: 10 });
    });

    it('returns unavailable averages for an empty list or unrecorded elevation loss', () => {
      expect(getActivityAverages([])).toEqual({
        distance: null, duration: null, elevationGain: null, elevationLoss: null,
      });
      expect(getActivityAverages([activity('2025-06-16', 'Run')]).elevationLoss).toBeNull();
    });

    it.each([
      { range: 'all', types: ['Run', 'Hike'], query: '', count: 4, distance: '4.50mi', duration: '2:45', gain: '550‘', loss: '600‘' },
      { range: 'month', types: ['Run', 'Hike'], query: '', count: 3, distance: '3.00mi', duration: '2:00', gain: '400‘', loss: '467‘' },
      { range: 'month', types: ['Run', 'Hike'], query: 'park', count: 2, distance: '2.00mi', duration: '1:30', gain: '200‘', loss: '300‘' },
      { range: 'month', types: ['Hike'], query: 'park', count: 1, distance: '3.00mi', duration: '2:00', gain: '300‘', loss: '400‘' },
    ] as const)('renders averages matching the cards for $range / $types / "$query"', ({ range, types, query, count, distance, duration, gain, loss }) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2025, 5, 18));
      const markup = renderToStaticMarkup(createElement(GarminActivitiesListView, {
        activities: [
          first,
          second,
          { ...first, timestamp: '2025-06-15T00:00:00', name: 'River run', distance: 5 * 1609.344, duration: 10800, elevationGain: 243.84, elevationLoss: 243.84 },
          { ...first, timestamp: '2025-01-10T00:00:00', distance: 9 * 1609.344, duration: 18000, elevationGain: 304.8, elevationLoss: 304.8 },
        ],
        range,
        selectedTypes: new Set(types),
        query,
      }));
      expect(markup).toContain(formatActivityCount(count));
      expect(markup.match(/class="activity-card"/g)).toHaveLength(count);
      expect(markup).toContain(`<dt>Avg distance</dt><dd>${distance}</dd>`);
      expect(markup).toContain(`<dt>Avg time (h:mm)</dt><dd>${duration}</dd>`);
      expect(markup).toContain(`<dt>Avg elevation gain</dt><dd>${gain}</dd>`);
      expect(markup).toContain(`<dt>Avg elevation loss</dt><dd>${loss}</dd>`);
      expect(markup.indexOf('activity-list-averages')).toBeLessThan(markup.indexOf('class="activity-list"'));
    });

    it.each([
      { activities: [], types: ['Run'], query: '' },
      { activities: [first], types: ['Run'], query: 'missing' },
      { activities: [first], types: [], query: '' },
    ])('keeps the summary visible when there are no displayed activities', ({ activities, types, query }) => {
      const markup = renderToStaticMarkup(createElement(GarminActivitiesListView, {
        activities, range: 'all', selectedTypes: new Set(types), query,
      }));
      expect(markup).toContain('0 activities');
      expect(markup.match(/<dd>—<\/dd>/g)).toHaveLength(4);
      expect(markup).not.toContain('class="activity-card"');
    });

    it('renders zero measurements explicitly and missing elevation loss as unavailable', () => {
      const markup = renderToStaticMarkup(createElement(GarminActivitiesListView, {
        activities: [{ ...first, distance: 0, duration: 0, elevationGain: 0, elevationLoss: undefined }],
        range: 'all',
        selectedTypes: new Set(['Run']),
        query: '',
      }));
      expect(markup).toContain('<dt>Avg distance</dt><dd>0.00mi</dd>');
      expect(markup).toContain('<dt>Avg time (h:mm)</dt><dd>0:00</dd>');
      expect(markup).toContain('<dt>Avg elevation gain</dt><dd>0‘</dd>');
      expect(markup).toContain('<dt>Avg elevation loss</dt><dd>—</dd>');
    });
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
      const morning = { ...activity('2025-06-17', 'Morning run'), timestamp: '2025-06-17T07:15:00' };
      const evening = { ...activity('2025-06-17', 'Evening run'), timestamp: '2025-06-17T18:30:00' };
      const afternoon = { ...activity('2025-06-17', 'Afternoon run'), timestamp: '2025-06-17T13:45:00' };

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

  it('formats displayed activity counts with correct pluralization', () => {
    expect(formatActivityCount(0)).toBe('0 activities');
    expect(formatActivityCount(1)).toBe('1 activity');
    expect(formatActivityCount(2)).toBe('2 activities');
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
