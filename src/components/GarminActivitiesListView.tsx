import { useState, useMemo, useRef, useEffect } from 'react';
import { Search, ChevronDown } from 'lucide-react';
import type { StravaActivity, StravaTimeRange } from '../model/strava.js';
import {
  filterActivitiesByRange,
  filterActivitiesByQuery,
  getActivityTypes,
  isStrengthTraining,
  toDisplayUnit,
  formatMetricValue,
} from '../model/strava.js';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** All activity types except strength training are selected by default. */
function isDefaultType(type: string): boolean {
  return !isStrengthTraining(type);
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface Props {
  activities: StravaActivity[];
  range: StravaTimeRange;
  selectedTypes: Set<string>;
  query: string;
}

interface ActivityFilterControlsProps {
  activities: StravaActivity[];
  selectedTypes: Set<string>;
  query: string;
  onSelectedTypesChange: (types: Set<string>) => void;
  onQueryChange: (query: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function formatDistance(meters: number): string {
  if (meters <= 0) return '';
  const miles = toDisplayUnit('distance', meters);
  return `${formatMetricValue(miles, 'distance')}mi`;
}

export function formatElevation(meters: number): string {
  if (meters <= 0) return '';
  const feet = toDisplayUnit('elevationGain', meters);
  return `${formatMetricValue(feet, 'elevationGain')}‘`;
}

function formatDate(iso: string): string {
  // YYYY-MM-DD → e.g. "Jul 18, 2026"
  const [year, month, day] = iso.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Build the Garmin Connect web URL for an activity id, e.g.
 * `https://connect.garmin.com/app/activity/24229675607`.
 * Returns `null` when the id is missing or not a plain numeric Garmin id.
 */
export function garminActivityUrl(activityId: string | undefined): string | null {
  const id = (activityId ?? '').trim();
  if (!/^\d+$/.test(id)) return null;
  return `https://connect.garmin.com/app/activity/${id}`;
}

/* ------------------------------------------------------------------ */
/*  Type-filter dropdown                                               */
/* ------------------------------------------------------------------ */

interface TypeFilterProps {
  allTypes: string[];
  selectedTypes: Set<string>;
  onToggle: (type: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}

function TypeFilterDropdown({ allTypes, selectedTypes, onToggle, onSelectAll, onSelectNone }: TypeFilterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const allSelected = selectedTypes.size === allTypes.length;
  const noneSelected = selectedTypes.size === 0;
  const label = noneSelected
    ? 'No types'
    : allSelected
      ? 'All types'
      : `${selectedTypes.size} type${selectedTypes.size === 1 ? '' : 's'}`;

  return (
    <div className="activity-type-filter" ref={ref}>
      <button
        className="activity-type-filter-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{label}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="activity-type-filter-menu" role="listbox">
          <div className="activity-type-filter-actions">
            <button onClick={onSelectAll} disabled={allSelected}>All</button>
            <button onClick={onSelectNone} disabled={noneSelected}>None</button>
          </div>
          {allTypes.map((t) => (
            <label key={t} className="activity-type-filter-option">
              <input
                type="checkbox"
                checked={selectedTypes.has(t)}
                onChange={() => onToggle(t)}
              />
              <span>{t}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function getDisplayedActivities(
  activities: StravaActivity[],
  range: StravaTimeRange,
  selectedTypes: Set<string>,
  query: string,
  today: Date = new Date(),
): StravaActivity[] {
  const rangeActivities = filterActivitiesByRange(activities, range, today);
  const typeFiltered = rangeActivities.filter((activity) => selectedTypes.has(activity.activityType));
  const searched = filterActivitiesByQuery(typeFiltered, query);
  return [...searched].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function getSelectableActivityTypes(activities: StravaActivity[]): string[] {
  return getActivityTypes(activities).filter(isDefaultType);
}

export function ActivityFilterControls({
  activities,
  selectedTypes,
  query,
  onSelectedTypesChange,
  onQueryChange,
}: ActivityFilterControlsProps) {
  const allTypes = useMemo(() => getSelectableActivityTypes(activities), [activities]);
  const handleToggle = (type: string) => {
    const next = new Set(selectedTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    onSelectedTypesChange(next);
  };

  return (
    <div className="activity-list-controls">
      <div className="activity-list-search">
        <Search size={15} className="activity-list-search-icon" />
        <input
          className="activity-list-search-input"
          type="search"
          placeholder="Search activities…"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
      {allTypes.length > 0 && (
        <TypeFilterDropdown
          allTypes={allTypes}
          selectedTypes={selectedTypes}
          onToggle={handleToggle}
          onSelectAll={() => onSelectedTypesChange(new Set(allTypes))}
          onSelectNone={() => onSelectedTypesChange(new Set())}
        />
      )}
    </div>
  );
}

export function GarminActivitiesListView({ activities, range, selectedTypes, query }: Props) {
  const today = useMemo(() => new Date(), []);
  const allTypes = useMemo(() => getSelectableActivityTypes(activities), [activities]);
  const displayed = useMemo(() => {
    return getDisplayedActivities(activities, range, selectedTypes, query, today);
  }, [activities, range, selectedTypes, query, today]);

  return (
    <div className="activity-list-view">
      <h3 className="strava-section-title">Activity Log</h3>

      {displayed.length === 0 ? (
        <p className="strava-empty">
          {query || selectedTypes.size < allTypes.length
            ? 'No activities match your filters.'
            : 'No activities found.'}
        </p>
      ) : (
        <div className="activity-list">
          {displayed.map((a, i) => {
            const distStr = formatDistance(a.distance);
            const elevStr = formatElevation(a.elevationGain);
            const elevLossStr = formatElevation(a.elevationLoss ?? 0);
            const url = garminActivityUrl(a.stravaId);
            const title = a.name || a.activityType;
            return (
              <div key={`${a.date}-${i}`} className="activity-card">
                <div className="activity-card-header">
                  {url ? (
                    <a
                      className="activity-card-name activity-card-link"
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {title}
                    </a>
                  ) : (
                    <span className="activity-card-name">{title}</span>
                  )}
                  <span className="activity-card-date">{formatDate(a.date)}</span>
                </div>
                <div className="activity-card-meta">
                  <span className="activity-card-type">{a.activityType}</span>
                  <span className="activity-card-stat">{formatDuration(a.duration)}</span>
                  {distStr && <span className="activity-card-stat">{distStr}</span>}
                  {elevStr && <span className="activity-card-stat">↑ {elevStr}</span>}
                  {elevLossStr && <span className="activity-card-stat">↓ {elevLossStr}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
