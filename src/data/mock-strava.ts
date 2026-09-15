/**
 * Mock Strava activity data for development.
 * Replaced with real data from the "Stronger - Strava" sheet tab once synced.
 */
import type { StravaActivity, StravaGoal } from '../model/strava.js';

/** Generate mock activities spanning the last ~6 months. */
export function generateMockStravaActivities(): StravaActivity[] {
  const activities: StravaActivity[] = [];
  const today = new Date();
  const sixMonthsAgo = new Date(today);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const types = [
    { type: 'Run', distRange: [3000, 16000], elevRange: [20, 200], durRange: [1200, 5400] },
    { type: 'Ride', distRange: [15000, 80000], elevRange: [100, 1500], durRange: [2400, 10800] },
    { type: 'Hike', distRange: [5000, 20000], elevRange: [200, 1500], durRange: [3600, 14400] },
    { type: 'Trail Run', distRange: [4000, 15000], elevRange: [100, 800], durRange: [1800, 5400] },
    { type: 'Weight Training', distRange: [0, 0], elevRange: [0, 0], durRange: [2700, 5400] },
  ];

  // Use a simple seeded random for reproducibility
  let seed = 42;
  function rand() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }

  function randBetween(min: number, max: number) {
    return min + rand() * (max - min);
  }

  const cursor = new Date(sixMonthsAgo);
  while (cursor <= today) {
    // 0-3 activities per day, weighted toward 0-1
    const count = rand() < 0.35 ? 1 : rand() < 0.08 ? 2 : 0;
    for (let i = 0; i < count; i++) {
      const typeInfo = types[Math.floor(rand() * types.length)];
      const timestamp = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}T12:00:00`;
      activities.push({
        timestamp,
        activityType: typeInfo.type,
        distance: Math.round(randBetween(typeInfo.distRange[0], typeInfo.distRange[1])),
        elevationGain: Math.round(randBetween(typeInfo.elevRange[0], typeInfo.elevRange[1])),
        duration: Math.round(randBetween(typeInfo.durRange[0], typeInfo.durRange[1])),
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return activities;
}

/** Example goals for development. */
export const mockStravaGoals: StravaGoal[] = [
  { metric: 'distance', value: 1500 },      // 1500 miles
  { metric: 'elevationGain', value: 200000 }, // 200k feet
  { metric: 'duration', value: 500 },         // 500 hours
];
