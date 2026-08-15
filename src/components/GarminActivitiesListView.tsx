import { useState, useMemo, useRef, useEffect } from 'react';
import { Search, ChevronDown } from 'lucide-react';
import type { StravaActivity } from '../model/strava.js';
import {
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

export function GarminActivitiesListView({ activities }: Props) {
  const [query, setQuery] = useState('');

  // Derive all known types from the full activity list
  const allTypes = useMemo(() => getActivityTypes(activities), [activities]);

  // Initialize selected types: everything except strength training
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(
    () => new Set(allTypes.filter(isDefaultType)),
  );

  // When the activity list first loads (allTypes changes from empty), seed defaults
  const seededRef = useRef(false);
  useEffect(() => {
    if (allTypes.length > 0 && !seededRef.current) {
      seededRef.current = true;
      setSelectedTypes(new Set(allTypes.filter(isDefaultType)));
    }
  }, [allTypes]);

  const handleToggle = (type: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const handleSelectAll = () => setSelectedTypes(new Set(allTypes));
  const handleSelectNone = () => setSelectedTypes(new Set());

  // Filter and sort: search across all activities (no year/range filter)
  const displayed = useMemo(() => {
    const q = query.trim().toLowerCase();
    const typeFiltered = activities.filter((a) => selectedTypes.has(a.activityType));
    const searched = q
      ? typeFiltered.filter((a) => {
          const name = (a.name ?? '').toLowerCase();
          const type = (a.activityType ?? '').toLowerCase();
          return name.includes(q) || type.includes(q);
        })
      : typeFiltered;
    return [...searched].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [activities, selectedTypes, query]);

  return (
    <div className="activity-list-view">
      <h3 className="strava-section-title">Activity Log</h3>

      <div className="activity-list-controls">
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
        {allTypes.length > 0 && (
          <TypeFilterDropdown
            allTypes={allTypes}
            selectedTypes={selectedTypes}
            onToggle={handleToggle}
            onSelectAll={handleSelectAll}
            onSelectNone={handleSelectNone}
          />
        )}
      </div>

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
