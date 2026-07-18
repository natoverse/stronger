import { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import type { StravaActivity, StravaTimeRange } from '../model/strava.js';
import { filterActivities, getActivityTypes, toDisplayUnit, formatMetricValue } from '../model/strava.js';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface Props {
  activities: StravaActivity[];
  range: StravaTimeRange;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDistance(meters: number): string {
  if (meters <= 0) return '';
  const miles = toDisplayUnit('distance', meters);
  return `${formatMetricValue(miles, 'distance')} mi`;
}

function formatElevation(meters: number): string {
  if (meters <= 0) return '';
  const feet = toDisplayUnit('elevationGain', meters);
  return `${formatMetricValue(feet, 'elevationGain')} ft`;
}

function formatDate(iso: string): string {
  // YYYY-MM-DD → e.g. "Jul 18, 2026"
  const [year, month, day] = iso.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function GarminActivitiesListView({ activities, range }: Props) {
  const [query, setQuery] = useState('');

  const today = useMemo(() => new Date(), []);

  // Filter by selected time range (all activity types included)
  const inRange = useMemo(() => {
    const allTypes = new Set(getActivityTypes(activities));
    return filterActivities(activities, range, allTypes, today);
  }, [activities, range, today]);

  // Apply search filter and sort descending by date
  const displayed = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? inRange.filter((a) => {
          const name = (a.name ?? '').toLowerCase();
          const type = (a.activityType ?? '').toLowerCase();
          return name.includes(q) || type.includes(q);
        })
      : inRange;
    return [...filtered].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [inRange, query]);

  return (
    <div className="activity-list-view">
      <h3 className="strava-section-title">Activity Log</h3>

      <div className="activity-list-search">
        <Search size={15} className="activity-list-search-icon" />
        <input
          className="activity-list-search-input"
          type="search"
          placeholder="Search activities…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {displayed.length === 0 ? (
        <p className="strava-empty">
          {query ? 'No activities match your search.' : 'No activities in the selected time range.'}
        </p>
      ) : (
        <div className="activity-list">
          {displayed.map((a, i) => {
            const distStr = formatDistance(a.distance);
            const elevStr = formatElevation(a.elevationGain);
            return (
              <div key={`${a.date}-${i}`} className="activity-card">
                <div className="activity-card-header">
                  <span className="activity-card-name">{a.name || a.activityType}</span>
                  <span className="activity-card-date">{formatDate(a.date)}</span>
                </div>
                <div className="activity-card-meta">
                  <span className="activity-card-type">{a.activityType}</span>
                  <span className="activity-card-stat">{formatDuration(a.duration)}</span>
                  {distStr && <span className="activity-card-stat">{distStr}</span>}
                  {elevStr && <span className="activity-card-stat">↑ {elevStr}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
