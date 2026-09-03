import { useState, useCallback } from 'react';
import type { CalendarListEntry } from '../google/index.js';
import type { CalendarSyncResult } from '../google/index.js';
import { authorizeCalendar, clearAuth, listWritableCalendars, saveCalendarId, loadCalendarId } from '../google/index.js';
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

export function CalendarSync({ onSync }: CalendarSyncProps) {
  const [calendars, setCalendars] = useState<CalendarListEntry[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState('');
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncResult, setSyncResult] = useState<CalendarSyncResult | null>(null);

  const loadCalendars = useCallback(async () => {
    setLoadingCalendars(true);
    setCalendarError(null);
    try {
        await authorizeCalendar();
        const cals = await listWritableCalendars();
        setCalendars(cals);
        const saved = loadCalendarId();
        const savedCal = saved ? cals.find((c) => c.id === saved) : null;
        const primary = cals.find((c) => c.primary);
        setSelectedCalendarId(savedCal?.id ?? primary?.id ?? cals[0]?.id ?? '');
        setAuthorized(true);
        setLoadingCalendars(false);
    } catch (err) {
        clearAuth();
        setAuthorized(false);
        setCalendarError(err instanceof Error ? err.message : String(err));
        setLoadingCalendars(false);
    }
  }, []);

  const canSync = selectedCalendarId && syncStatus !== 'syncing';

  const handleSync = useCallback(async () => {
    if (!canSync) return;

    setSyncStatus('syncing');
    setSyncResult(null);

    try {
      const result = await onSync(selectedCalendarId);
      setSyncResult(result);
      setSyncStatus(result.errors.length > 0 ? 'error' : 'success');
    } catch (err) {
      if (errorStatus(err) === 401) {
        clearAuth();
        setAuthorized(false);
        setCalendars([]);
        setSelectedCalendarId('');
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

      {!authorized && (
        <button className="calendar-push-btn" onClick={() => void loadCalendars()} disabled={loadingCalendars}>
          {loadingCalendars ? <><Loader size={16} className="spin" /> Connecting…</> : 'Connect Google Calendar'}
        </button>
      )}

      {/* Calendar picker */}
      {authorized && <div className="calendar-push-section">
        <label className="calendar-push-label" htmlFor="sync-calendar">
          Target calendar
        </label>
        {loadingCalendars ? (
          <div className="calendar-push-loading">
            <Loader size={16} className="spin" /> Loading calendars…
          </div>
        ) : calendarError ? (
          <div className="calendar-push-error">
            <AlertCircle size={16} /> {calendarError}
          </div>
        ) : calendars.length === 0 ? (
          <div className="calendar-push-error">
            <AlertCircle size={16} /> No writable calendars found
          </div>
        ) : (
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
        )}
      </div>}

      {/* Sync button */}
      {authorized && <button
        className="calendar-push-btn"
        onClick={handleSync}
        disabled={!canSync}
      >
        {syncStatus === 'syncing' ? (
          <>
            <Loader size={16} className="spin" /> Syncing…
          </>
        ) : (
          <>
            <RefreshCw size={16} /> Sync with Calendar
          </>
        )}
      </button>}

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
