import { useState, useCallback, useEffect } from 'react';
import type { CalendarListEntry } from '../google/index.js';
import type { CalendarSyncResult } from '../google/index.js';
import {
  authorizeCalendar,
  clearAuth,
  listWritableCalendars,
  loadCalendarId,
  prepareCalendarAuthorization,
  saveCalendarId,
} from '../google/index.js';
import { RefreshCw, Loader, CheckCircle, AlertCircle } from 'lucide-react';

interface CalendarSyncProps {
  onSync: (calendarId: string) => Promise<CalendarSyncResult>;
}

type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as { status?: number; result?: { error?: { code?: number } } };
  return value.status ?? value.result?.error?.code;
}

export function selectWritableCalendar(
  calendars: CalendarListEntry[],
  preferredId: string | null,
): CalendarListEntry | undefined {
  return (
    calendars.find((calendar) => calendar.id === preferredId)
    ?? calendars.find((calendar) => calendar.primary)
    ?? calendars[0]
  );
}

export function CalendarSync({ onSync }: CalendarSyncProps) {
  const [calendars, setCalendars] = useState<CalendarListEntry[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState(() => loadCalendarId() ?? '');
  const [authorizationReady, setAuthorizationReady] = useState(false);
  const [preparationError, setPreparationError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncResult, setSyncResult] = useState<CalendarSyncResult | null>(null);

  useEffect(() => {
    let active = true;
    void prepareCalendarAuthorization()
      .then(() => {
        if (!active) return;
        setAuthorizationReady(true);
        setPreparationError(null);
      })
      .catch((error) => {
        if (!active) return;
        setPreparationError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, []);

  const canSync = authorizationReady && syncStatus !== 'syncing';

  const handleSync = useCallback(async () => {
    if (!canSync) return;

    setSyncStatus('syncing');
    setSyncResult(null);

    try {
      await authorizeCalendar();
      const writableCalendars = await listWritableCalendars();
      setCalendars(writableCalendars);

      const preferredId = selectedCalendarId || loadCalendarId();
      const targetCalendar = selectWritableCalendar(writableCalendars, preferredId);
      if (!targetCalendar?.id) {
        throw new Error('No writable Google Calendars are available.');
      }

      setSelectedCalendarId(targetCalendar.id);
      saveCalendarId(targetCalendar.id);
      const result = await onSync(targetCalendar.id);
      setSyncResult(result);
      setSyncStatus(result.errors.length > 0 ? 'error' : 'success');
    } catch (err) {
      if (errorStatus(err) === 401) {
        clearAuth();
      }
      setSyncResult({
        created: 0,
        updated: 0,
        deleted: 0,
        pulledCreations: 0,
        pulledDateChanges: 0,
        pulledDeletions: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      });
      setSyncStatus('error');
    }
  }, [canSync, selectedCalendarId, onSync]);

  /** Build a human-readable summary of what the sync did. */
  function buildSummary(r: CalendarSyncResult): string {
    const parts: string[] = [];
    if (r.created > 0) parts.push(`${r.created} pushed`);
    if (r.updated > 0) parts.push(`${r.updated} title${r.updated !== 1 ? 's' : ''} updated`);
    if (r.pulledCreations > 0) parts.push(`${r.pulledCreations} pulled from calendar`);
    if (r.pulledDateChanges > 0) parts.push(`${r.pulledDateChanges} date${r.pulledDateChanges !== 1 ? 's' : ''} updated`);
    if (r.pulledDeletions > 0) parts.push(`${r.pulledDeletions} removed (deleted in calendar)`);
    if (r.deleted > 0) parts.push(`${r.deleted} calendar event${r.deleted !== 1 ? 's' : ''} cleaned up`);
    if (parts.length === 0) return 'Everything is in sync.';
    return parts.join(', ') + '.';
  }

  return (
    <div className="calendar-push">
      <div className="calendar-push-header">
        <h3>Sync with Calendar</h3>
      </div>

      <div className="calendar-push-section">
        <p className="calendar-sync-description">
          Two-way sync pushes new schedule entries to Google Calendar and pulls back any date changes or deletions made there.
        </p>
      </div>

      {/* Calendar picker */}
      {calendars.length > 0 && <div className="calendar-push-section">
        <label className="calendar-push-label" htmlFor="sync-calendar">
          Target calendar
        </label>
        <select
          id="sync-calendar"
          className="calendar-push-select"
          value={selectedCalendarId}
          onChange={(e) => {
            setSelectedCalendarId(e.target.value);
            saveCalendarId(e.target.value);
          }}
        >
          {calendars.map((c) => (
            <option key={c.id} value={c.id}>
              {c.summary}{c.primary ? ' (primary)' : ''}
            </option>
          ))}
        </select>
      </div>}

      {/* Sync button */}
      <button
        className="calendar-push-btn"
        onClick={handleSync}
        disabled={!canSync}
      >
        {syncStatus === 'syncing' ? (
          <>
            <Loader size={16} className="spin" /> Syncing…
          </>
        ) : !authorizationReady ? (
          <>
            <Loader size={16} className="spin" /> Preparing Calendar…
          </>
        ) : (
          <>
            <RefreshCw size={16} /> Sync with Calendar
          </>
        )}
      </button>

      {preparationError && (
        <div className="calendar-push-error">
          <AlertCircle size={16} /> {preparationError}
        </div>
      )}

      {/* Result feedback */}
      {syncResult && syncStatus === 'success' && (
        <div className="calendar-push-feedback calendar-push-feedback-success">
          <CheckCircle size={16} />
          {buildSummary(syncResult)}
        </div>
      )}
      {syncResult && syncStatus === 'error' && (
        <div className="calendar-push-feedback calendar-push-feedback-error">
          <AlertCircle size={16} />
          <div>
            <p>{buildSummary(syncResult)}</p>
            {syncResult.errors.slice(0, 3).map((err, i) => (
              <p key={i} className="calendar-push-error-detail">{err}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
