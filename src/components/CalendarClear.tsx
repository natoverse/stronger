import { useState, useCallback } from 'react';
import { Trash2, CheckCircle, Loader, AlertCircle } from 'lucide-react';

export interface ClearOptions {
  startDate: string;
  weeks: number;
  clearFlags: boolean;
  clearSchedule: boolean;
}

export interface ClearResult {
  flagsCleared: number;
  scheduleCleared: number;
  calendarEventsDeleted: number;
  errors: string[];
}

interface CalendarClearProps {
  onClear: (options: ClearOptions) => Promise<ClearResult>;
}

/** Return today's date as YYYY-MM-DD. */
function today(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

type ClearStatus = 'idle' | 'confirm' | 'clearing' | 'done' | 'error';

export function CalendarClear({ onClear }: CalendarClearProps) {
  const [startDate, setStartDate] = useState(today);
  const [weeks, setWeeks] = useState(4);
  const [clearFlags, setClearFlags] = useState(true);
  const [clearSchedule, setClearSchedule] = useState(true);
  const [status, setStatus] = useState<ClearStatus>('idle');
  const [result, setResult] = useState<ClearResult | null>(null);

  const canClear = (clearFlags || clearSchedule) && status !== 'clearing';

  const handleClear = useCallback(async () => {
    if (status === 'idle') {
      setStatus('confirm');
      return;
    }
    if (status !== 'confirm') return;

    setStatus('clearing');
    setResult(null);

    try {
      const r = await onClear({ startDate, weeks, clearFlags, clearSchedule });
      setResult(r);
      setStatus(r.errors.length > 0 ? 'error' : 'done');
    } catch (err) {
      setResult({
        flagsCleared: 0,
        scheduleCleared: 0,
        calendarEventsDeleted: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      });
      setStatus('error');
    }
  }, [status, startDate, weeks, clearFlags, clearSchedule, onClear]);

  const handleCancel = useCallback(() => {
    setStatus('idle');
  }, []);

  function buildSummary(r: ClearResult): string {
    const parts: string[] = [];
    if (r.flagsCleared > 0) parts.push(`${r.flagsCleared} flag${r.flagsCleared !== 1 ? 's' : ''}`);
    if (r.scheduleCleared > 0) parts.push(`${r.scheduleCleared} schedule entr${r.scheduleCleared !== 1 ? 'ies' : 'y'}`);
    if (r.calendarEventsDeleted > 0) parts.push(`${r.calendarEventsDeleted} calendar event${r.calendarEventsDeleted !== 1 ? 's' : ''}`);
    if (parts.length === 0) return 'Nothing to clear';
    return `Cleared ${parts.join(', ')}`;
  }

  // Compute the date range description
  const endDate = (() => {
    const [y, m, d] = startDate.split('-').map(Number);
    const end = new Date(y, m - 1, d + weeks * 7 - 1);
    return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  })();

  return (
    <section className="calendar-clear">
      <div className="calendar-push-header">
        <h3>Clear Schedule</h3>
      </div>

      {/* What to clear */}
      <div className="calendar-push-section">
        <label className="calendar-push-label">What to clear</label>
        <div className="calendar-clear-checks">
          <label className="calendar-clear-check">
            <input
              type="checkbox"
              checked={clearFlags}
              onChange={(e) => {
                setClearFlags(e.target.checked);
                if (status === 'confirm') setStatus('idle');
              }}
            />
            Day flags
          </label>
          <label className="calendar-clear-check">
            <input
              type="checkbox"
              checked={clearSchedule}
              onChange={(e) => {
                setClearSchedule(e.target.checked);
                if (status === 'confirm') setStatus('idle');
              }}
            />
            Workout schedule &amp; calendar events
          </label>
        </div>
      </div>

      {/* Start date */}
      <div className="calendar-push-section">
        <label className="calendar-push-label" htmlFor="clear-start-date">
          Start date
        </label>
        <input
          id="clear-start-date"
          type="date"
          className="calendar-push-input"
          value={startDate}
          onChange={(e) => {
            setStartDate(e.target.value);
            if (status === 'confirm') setStatus('idle');
          }}
        />
      </div>

      {/* Number of weeks */}
      <div className="calendar-push-section">
        <label className="calendar-push-label" htmlFor="clear-weeks">
          Number of weeks
        </label>
        <select
          id="clear-weeks"
          className="calendar-push-select"
          value={weeks}
          onChange={(e) => {
            setWeeks(Number(e.target.value));
            if (status === 'confirm') setStatus('idle');
          }}
        >
          {[1, 2, 3, 4, 6, 8, 12].map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? 'week' : 'weeks'}
            </option>
          ))}
        </select>
      </div>

      {/* Date range preview */}
      <div className="calendar-push-section">
        <span className="calendar-clear-range">{startDate} → {endDate}</span>
      </div>

      {/* Confirm warning */}
      {status === 'confirm' && (
        <div className="calendar-push-feedback calendar-push-feedback-error">
          <AlertCircle size={16} />
          <span>This will permanently clear data in the selected range. Continue?</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="calendar-clear-actions">
        {status === 'confirm' && (
          <button className="calendar-push-btn calendar-clear-cancel-btn" onClick={handleCancel}>
            Cancel
          </button>
        )}
        <button
          className="calendar-push-btn calendar-clear-btn"
          onClick={handleClear}
          disabled={!canClear}
        >
          {status === 'clearing' ? (
            <>
              <Loader size={16} className="spin" /> Clearing…
            </>
          ) : status === 'confirm' ? (
            <>
              <Trash2 size={16} /> Confirm Clear
            </>
          ) : status === 'done' ? (
            <>
              <CheckCircle size={16} /> Cleared
            </>
          ) : (
            <>
              <Trash2 size={16} /> Clear
            </>
          )}
        </button>
      </div>

      {/* Result feedback */}
      {result && status === 'done' && (
        <div className="calendar-push-feedback calendar-push-feedback-success">
          <CheckCircle size={16} />
          {buildSummary(result)}
        </div>
      )}
      {result && status === 'error' && (
        <div className="calendar-push-feedback calendar-push-feedback-error">
          <AlertCircle size={16} />
          <div>
            <p>{buildSummary(result)}</p>
            {result.errors.slice(0, 3).map((err, i) => (
              <p key={i} className="calendar-push-error-detail">{err}</p>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
