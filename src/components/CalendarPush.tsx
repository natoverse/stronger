import { useState, useCallback } from 'react';
import type { Workout, WorkoutScheduleEntry, CardioActivity } from '../model/index.js';
import { REST_ID } from '../model/index.js';
import { CheckCircle, X, CalendarCheck } from 'lucide-react';

interface CalendarPushProps {
  workouts: Workout[];
  cardioActivities: CardioActivity[];
  onClose: () => void;
  onUpdateSchedule: (entries: WorkoutScheduleEntry[]) => void;
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Return today's date as YYYY-MM-DD. */
function today(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function CalendarPush({ workouts, cardioActivities, onClose, onUpdateSchedule }: CalendarPushProps) {
  // Weekly day → activity mapping (7 entries)
  // '' = no action (skip), '__rest__' = clear workouts, REST_ID = plan a Rest day, otherwise = workout/cardio id
  const [daySlots, setDaySlots] = useState<string[]>(Array(7).fill(''));
  const [weeks, setWeeks] = useState(4);
  const [startDate, setStartDate] = useState(today);

  const handleDayChange = useCallback((dayIndex: number, workoutId: string) => {
    setDaySlots((prev) => {
      const next = [...prev];
      next[dayIndex] = workoutId;
      return next;
    });
  }, []);

  const hasSlots = daySlots.some((id) => id !== '');

  // Generate WorkoutScheduleEntry[] from the weekly planner.
  // Additive: only emits entries for days with a selection (skips empty/no-action days).
  // __rest__ signals clearing all workouts for that date.
  // Aligns each day-of-week to its correct calendar date regardless of start date.
  const generateScheduleEntries = useCallback((): WorkoutScheduleEntry[] => {
    const entries: WorkoutScheduleEntry[] = [];
    const [sy, sm, sd] = startDate.split('-').map(Number);
    const start = new Date(sy, sm - 1, sd);
    const startDow = start.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    for (let week = 0; week < weeks; week++) {
      for (let day = 0; day < 7; day++) {
        const wid = daySlots[day];
        if (!wid) continue; // No action — skip this day
        // day 0=Monday(JS 1), 1=Tuesday(JS 2), ..., 6=Sunday(JS 0)
        const targetDow = (day + 1) % 7;
        const offset = (targetDow - startDow + 7) % 7;
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset + week * 7);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        entries.push({ date: dateStr, workoutId: wid });
      }
    }
    return entries;
  }, [daySlots, startDate, weeks]);

  const [scheduleUpdated, setScheduleUpdated] = useState(false);

  const handleUpdateSchedule = useCallback(() => {
    const entries = generateScheduleEntries();
    onUpdateSchedule(entries);
    setScheduleUpdated(true);
    setTimeout(() => setScheduleUpdated(false), 2000);
  }, [generateScheduleEntries, onUpdateSchedule]);

  return (
    <div className="calendar-push">
      <div className="calendar-push-header">
        <h3>Plan</h3>
        <button className="calendar-push-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </div>

      {/* Weekly schedule */}
      <div className="calendar-push-section">
        <label className="calendar-push-label">Weekly schedule</label>
        <div className="calendar-push-days">
          {DAY_NAMES.map((name, i) => (
            <div key={name} className="calendar-push-day-row">
              <span className="calendar-push-day-name">{name}</span>
              <select
                className="calendar-push-select"
                value={daySlots[i]}
                onChange={(e) => handleDayChange(i, e.target.value)}
              >
                <option value="">—</option>
                <option value="__rest__">— Clear —</option>
                <option value={REST_ID}>Rest</option>
                <optgroup label="Strength">
                  {workouts.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </optgroup>
                {cardioActivities.length > 0 && (
                  <optgroup label="Cardio">
                    {cardioActivities.map((c) => (
                      <option key={c.id} value={`cardio:${c.id}`}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* Start date */}
      <div className="calendar-push-section">
        <label className="calendar-push-label" htmlFor="push-start-date">
          Start date
        </label>
        <input
          id="push-start-date"
          type="date"
          className="calendar-push-input"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
      </div>

      {/* Number of weeks */}
      <div className="calendar-push-section">
        <label className="calendar-push-label" htmlFor="push-weeks">
          Number of weeks
        </label>
        <select
          id="push-weeks"
          className="calendar-push-select"
          value={weeks}
          onChange={(e) => setWeeks(Number(e.target.value))}
        >
          {[1, 2, 3, 4, 6, 8, 12].map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? 'week' : 'weeks'}
            </option>
          ))}
        </select>
      </div>

      {/* Update Schedule button */}
      <button
        className="calendar-push-btn"
        onClick={handleUpdateSchedule}
        disabled={!hasSlots}
      >
        {scheduleUpdated ? (
          <>
            <CheckCircle size={16} /> Updated
          </>
        ) : (
          <>
            <CalendarCheck size={16} /> Update Schedule
          </>
        )}
      </button>
    </div>
  );
}
