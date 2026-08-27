import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { Workout, WorkoutScheduleEntry, SetType, CardioActivity, DayFlags, DayFlagEntry } from '../model/index.js';
import { REST_ID } from '../model/index.js';
import type { ParsedLogRow, CalendarSyncResult } from '../google/index.js';
import { CalendarPlus, X, ChevronRight, ChevronLeft, ChevronDown, Dumbbell, Save, Check, CalendarCog, HeartPulse, House, Palmtree, Plane, Users, Ban, RefreshCw, Loader, CheckCircle, AlertCircle, Trash2, Moon, Pencil } from 'lucide-react';
import { CalendarPush } from './CalendarPush.js';
import { CalendarSync } from './CalendarSync.js';
import { CalendarClear } from './CalendarClear.js';
import type { ClearOptions, ClearResult } from './CalendarClear.js';

interface CalendarViewProps {
	workouts: Workout[];
	cardioActivities: CardioActivity[];
	workoutSchedule: WorkoutScheduleEntry[];
	dayFlags: DayFlagEntry[];
	logRows: ParsedLogRow[];
	onAssign: (date: string, workoutId: string) => void;
	onRemove: (date: string, workoutId: string) => void;
	onUpdateLabel: (date: string, workoutId: string, label: string) => void;
	onOpenWorkout: (workoutId: string) => void;
	onUpdateLogRows: (
		sessionDate: string,
		sessionWorkoutId: string,
		sessionStartTime: string,
		updatedRows: ParsedLogRow[],
	) => void;
	onDeleteSession: (
		sessionDate: string,
		sessionWorkoutId: string,
		sessionStartTime: string,
	) => void;
	onBulkSchedule: (entries: WorkoutScheduleEntry[]) => void;
	onUpdateFlags: (date: string, flags: DayFlags) => void;
	onSyncCalendar: (calendarId: string) => Promise<CalendarSyncResult>;
	onClearSchedule: (options: ClearOptions) => Promise<ClearResult>;
}

export type CalendarPanel = 'plan' | 'sync' | 'clear' | 'monthly';

export function toggleCalendarPanel(current: CalendarPanel | null, selected: CalendarPanel): CalendarPanel | null {
	return current === selected ? null : selected;
}

/** Format a YYYY-MM-DD string for display. */
export function formatDate(dateStr: string): { weekday: string; display: string } {
	const [y, m, d] = dateStr.split('-').map(Number);
	const date = new Date(y, m - 1, d);
	const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
	const display = date.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
	});
	return { weekday, display };
}

/** Check if a date string falls on a weekend (Saturday or Sunday). */
function isWeekend(dateStr: string): boolean {
	const [y, m, d] = dateStr.split('-').map(Number);
	const day = new Date(y, m - 1, d).getDay();
	return day === 0 || day === 6;
}

/** Get today's YYYY-MM-DD string. */
function todayStr(): string {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Check if a date string is today. */
function isToday(dateStr: string): boolean {
	return dateStr === todayStr();
}

/** Generate an array of YYYY-MM-DD strings starting from today for `count` days. */
function generateFutureDays(count: number): string[] {
	const days: string[] = [];
	const now = new Date();
	for (let i = 0; i < count; i++) {
		const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
		days.push(
			`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
		);
	}
	return days;
}

/** Generate an array of YYYY-MM-DD strings going backward from a reference date. */
export function generatePastDays(beforeDate: string, count: number): string[] {
	const [y, m, d] = beforeDate.split('-').map(Number);
	const days: string[] = [];
	for (let i = 1; i <= count; i++) {
		const dt = new Date(y, m - 1, d - i);
		days.push(
			`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`,
		);
	}
	return days;
}

/** Key for grouping log rows into sessions. */
interface SessionKey {
	date: string;
	workoutId: string;
	startTime: string;
}

/** A grouped workout session for a single (date, workoutId, startTime). */
export interface LogSession {
	key: SessionKey;
	workoutName: string;
	rows: ParsedLogRow[];
}

/**
 * Group parsed log rows by (date, workoutId, startTime) to produce sessions.
 * Returns a map of date → LogSession[].
 */
export function groupLogByDate(logRows: ParsedLogRow[], workoutNames?: Map<string, string>): Map<string, LogSession[]> {
	const sessionMap = new Map<string, LogSession>();
	for (const row of logRows) {
		const key = `${row.date}|${row.workoutId}|${row.startTime}`;
		let session = sessionMap.get(key);
		if (!session) {
			session = {
				key: { date: row.date, workoutId: row.workoutId, startTime: row.startTime },
				workoutName: workoutNames?.get(row.workoutId) ?? row.workoutId,
				rows: [],
			};
			sessionMap.set(key, session);
		}
		session.rows.push(row);
	}

	// Group sessions by date
	const dateMap = new Map<string, LogSession[]>();
	for (const session of sessionMap.values()) {
		const existing = dateMap.get(session.key.date) ?? [];
		existing.push(session);
		dateMap.set(session.key.date, existing);
	}
	return dateMap;
}

/**
 * Merge schedule entries and log sessions for a list of dates.
 * Returns per-date info: scheduled workouts and completed sessions.
 */
export interface DayInfo {
	date: string;
	scheduled: string[]; // workoutIds from schedule
	sessions: LogSession[]; // completed workout sessions from log
	flags?: DayFlags; // day-level flags
	labels?: Record<string, string>; // workoutId -> custom label, for this date
}

export function buildDayInfos(
	dates: string[],
	scheduleMap: Map<string, string[]>,
	logByDate: Map<string, LogSession[]>,
	flagsMap?: Map<string, DayFlags>,
	labelsMap?: Map<string, Record<string, string>>,
): DayInfo[] {
	return dates.map((date) => ({
		date,
		scheduled: scheduleMap.get(date) ?? [],
		sessions: logByDate.get(date) ?? [],
		flags: flagsMap?.get(date),
		labels: labelsMap?.get(date),
	}));
}

/** Ensure a selected calendar date is available in the chronological detailed-day list. */
export function includeCalendarDate(dates: string[], date: string): string[] {
	return dates.includes(date) ? dates : [...dates, date].sort();
}

export interface MonthGrid {
	year: number;
	month: number;
	label: string;
	dates: (string | null)[];
}

/** Build a Sunday-first calendar grid for a month offset from the provided date. */
export function buildMonthGrid(from: Date, offset: number): MonthGrid {
	const first = new Date(from.getFullYear(), from.getMonth() + offset, 1);
	const year = first.getFullYear();
	const month = first.getMonth();
	const daysInMonth = new Date(year, month + 1, 0).getDate();
	const dates: (string | null)[] = Array(first.getDay()).fill(null);

	for (let day = 1; day <= daysInMonth; day++) {
		dates.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
	}
	while (dates.length % 7 !== 0) dates.push(null);

	return {
		year,
		month,
		label: first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
		dates,
	};
}

interface WorkoutTypeFilterProps {
	types: { id: string; name: string }[];
	selected: Set<string>;
	onChange: (selected: Set<string>) => void;
}

function WorkoutTypeFilter({ types, selected, onChange }: WorkoutTypeFilterProps) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const handleClick = (event: MouseEvent) => {
			if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener('mousedown', handleClick);
		return () => document.removeEventListener('mousedown', handleClick);
	}, [open]);

	const allSelected = selected.size === types.length;
	const label = selected.size === 0
		? 'No workouts'
		: allSelected
			? 'All workouts'
			: `${selected.size} workout${selected.size === 1 ? '' : 's'}`;

	return (
		<div className="activity-type-filter" ref={ref}>
			<button
				className="activity-type-filter-btn"
				onClick={() => setOpen((value) => !value)}
				aria-haspopup="listbox"
				aria-expanded={open}
			>
				<span>{label}</span>
				<ChevronDown size={14} />
			</button>
			{open && (
				<div className="activity-type-filter-menu" role="listbox">
					<div className="activity-type-filter-actions">
						<button onClick={() => onChange(new Set(types.map((type) => type.id)))} disabled={allSelected}>All</button>
						<button onClick={() => onChange(new Set())} disabled={selected.size === 0}>None</button>
					</div>
					{types.map((type) => (
						<label key={type.id} className="activity-type-filter-option">
							<input
								type="checkbox"
								checked={selected.has(type.id)}
								onChange={() => {
									const next = new Set(selected);
									if (next.has(type.id)) next.delete(type.id);
									else next.add(type.id);
									onChange(next);
								}}
							/>
							<span>{type.name}</span>
						</label>
					))}
				</div>
			)}
		</div>
	);
}

const SET_TYPES: SetType[] = ['warmup', 'work', 'backoff', 'joker'];
const DAY_FLAG_OPTIONS: [keyof DayFlags, string, typeof House][] = [
	['home', 'Home', House],
	['elsewhere', 'Elsewhere', Palmtree],
	['travel', 'Travel', Plane],
	['visitors', 'Visitors', Users],
	['blocked', 'Blocked', Ban],
];

/** Detail/edit view for a single past workout session. */
export function SessionDetail({
	session,
	workoutNames,
	onSave,
	onClose,
}: {
	session: LogSession;
	workoutNames: Map<string, string>;
	onSave: (updatedRows: ParsedLogRow[]) => void;
	onClose: () => void;
}) {
	const [editRows, setEditRows] = useState<ParsedLogRow[]>(() =>
		session.rows.map((r) => ({ ...r })),
	);
	const [saving, setSaving] = useState(false);
	const [dirty, setDirty] = useState(false);

	const { display } = formatDate(session.key.date);
	const name = workoutNames.get(session.key.workoutId) ?? session.workoutName;

	const updateRow = useCallback((index: number, patch: Partial<ParsedLogRow>) => {
		setEditRows((prev) => {
			const next = [...prev];
			next[index] = { ...next[index], ...patch };
			return next;
		});
		setDirty(true);
	}, []);

	const handleSave = useCallback(async () => {
		setSaving(true);
		onSave(editRows);
		// Brief delay for visual feedback
		await new Promise((r) => setTimeout(r, 300));
		setSaving(false);
		setDirty(false);
	}, [editRows, onSave]);

	// Group rows by exercise
	const exerciseOrder: string[] = [];
	const exerciseMap = new Map<string, number[]>();
	for (let i = 0; i < editRows.length; i++) {
		const eName = editRows[i].exerciseName;
		if (!exerciseMap.has(eName)) {
			exerciseOrder.push(eName);
			exerciseMap.set(eName, []);
		}
		exerciseMap.get(eName)!.push(i);
	}

	return (
		<div className="session-detail">
			<div className="session-detail-header">
				<button className="session-detail-back" onClick={onClose}>
					<ChevronLeft size={20} />
				</button>
				<div className="session-detail-title">
					<span className="session-detail-name">{name}</span>
					<span className="session-detail-date">{display}</span>
				</div>
				<button
					className={`session-detail-save${dirty ? ' session-detail-save-active' : ''}`}
					onClick={handleSave}
					disabled={!dirty || saving}
				>
					{saving ? <Check size={18} /> : <Save size={18} />}
				</button>
			</div>

			<div className="session-detail-exercises">
				{exerciseOrder.map((eName) => {
					const indices = exerciseMap.get(eName)!;
					return (
						<div key={eName} className="session-detail-exercise">
							<div className="session-detail-exercise-name">{eName}</div>
							<div className="session-detail-sets">
								<div className="session-detail-set-header">
									<span className="session-detail-set-num">#</span>
									<span className="session-detail-set-type">Type</span>
									<span className="session-detail-set-weight">Weight</span>
									<span className="session-detail-set-reps">Reps</span>
									<span className="session-detail-set-done">✓</span>
								</div>
								{indices.map((idx) => {
									const row = editRows[idx];
									return (
										<div key={idx} className={`session-detail-set-row session-detail-set-${row.setType}`}>
											<span className="session-detail-set-num">{row.setNumber}</span>
											<select
												className="session-detail-set-type-input"
												value={row.setType}
												onChange={(e) => updateRow(idx, { setType: e.target.value as SetType })}
											>
												{SET_TYPES.map((t) => (
													<option key={t} value={t}>{t}</option>
												))}
											</select>
											<input
												className="session-detail-set-weight-input"
												type="number"
												inputMode="decimal"
												value={row.actualWeight}
												onChange={(e) => updateRow(idx, { actualWeight: Number(e.target.value) || 0 })}
											/>
											<input
												className="session-detail-set-reps-input"
												type="number"
												inputMode="numeric"
												value={row.actualReps}
												onChange={(e) => updateRow(idx, { actualReps: Number(e.target.value) || 0 })}
											/>
											<button
												className={`session-detail-set-check${row.completed ? ' session-detail-set-checked' : ''}`}
												onClick={() => updateRow(idx, { completed: !row.completed })}
											>
												{row.completed ? <Check size={14} /> : ''}
											</button>
										</div>
									);
								})}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

export function CalendarView({
	workouts,
	cardioActivities,
	workoutSchedule,
	dayFlags,
	logRows,
	onAssign,
	onRemove,
	onUpdateLabel,
	onOpenWorkout,
	onUpdateLogRows,
	onDeleteSession,
	onBulkSchedule,
	onUpdateFlags,
	onSyncCalendar,
	onClearSchedule,
}: CalendarViewProps) {
	const [addingForDate, setAddingForDate] = useState<string | null>(null);
	const [activePanel, setActivePanel] = useState<CalendarPanel | null>('monthly');
	const [pastDays, setPastDays] = useState<string[]>([]);
	const [activeSession, setActiveSession] = useState<LogSession | null>(null);
	const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
	const [editingLabel, setEditingLabel] = useState<{ date: string; workoutId: string } | null>(null);
	const [labelDraft, setLabelDraft] = useState('');
	const [visibleMonthOffsets, setVisibleMonthOffsets] = useState([0]);
	const [monthDayScrollTarget, setMonthDayScrollTarget] = useState<{ date: string } | null>(null);
	const [showMonthFlags, setShowMonthFlags] = useState(true);
	const dayCardRefs = useRef(new Map<string, HTMLDivElement>());

	const [futureDayCount, setFutureDayCount] = useState(30);
	const futureDays = useMemo(() => generateFutureDays(futureDayCount), [futureDayCount]);

	// Build a map of date → workoutIds for fast lookup
	const scheduleMap = useMemo(() => {
		const map = new Map<string, string[]>();
		for (const entry of workoutSchedule) {
			if (!entry.workoutId) continue;
			const existing = map.get(entry.date) ?? [];
			existing.push(entry.workoutId);
			map.set(entry.date, existing);
		}
		return map;
	}, [workoutSchedule]);

	// Build a map of date → (workoutId → custom label) for fast lookup
	const labelsMap = useMemo(() => {
		const map = new Map<string, Record<string, string>>();
		for (const entry of workoutSchedule) {
			if (!entry.workoutId || !entry.label) continue;
			const existing = map.get(entry.date) ?? {};
			existing[entry.workoutId] = entry.label;
			map.set(entry.date, existing);
		}
		return map;
	}, [workoutSchedule]);

	// Build a map of date → DayFlags from the flags tab
	const flagsMap = useMemo(() => {
		const map = new Map<string, DayFlags>();
		for (const entry of dayFlags) {
			map.set(entry.date, entry.flags);
		}
		return map;
	}, [dayFlags]);

	// Build a map of workoutId → workout name for display
	const workoutNames = useMemo(() => {
		const map = new Map<string, string>();
		for (const w of workouts) {
			map.set(w.id, w.name);
		}
		for (const c of cardioActivities) {
			map.set(`cardio:${c.id}`, c.name);
		}
		map.set(REST_ID, 'Rest');
		return map;
	}, [workouts, cardioActivities]);
	const displayWorkoutName = useCallback(
		(workoutId: string) =>
			workoutNames.get(workoutId) ?? (workoutId.startsWith('cardio:') ? workoutId.slice('cardio:'.length) : workoutId),
		[workoutNames],
	);

	const scheduledTypes = useMemo(() => {
		const seen = new Set<string>();
		const types: { id: string; name: string }[] = [];
		for (const entry of workoutSchedule) {
			if (!entry.workoutId || seen.has(entry.workoutId)) continue;
			seen.add(entry.workoutId);
			types.push({ id: entry.workoutId, name: workoutNames.get(entry.workoutId) ?? entry.workoutId });
		}
		return types.sort((a, b) => a.name.localeCompare(b.name));
	}, [workoutSchedule, workoutNames]);
	const [selectedWorkoutTypes, setSelectedWorkoutTypes] = useState<Set<string>>(
		() => new Set(scheduledTypes.map((type) => type.id)),
	);
	const previousScheduledTypes = useRef(new Set(scheduledTypes.map((type) => type.id)));

	useEffect(() => {
		const current = new Set(scheduledTypes.map((type) => type.id));
		setSelectedWorkoutTypes((selected) => {
			const previous = previousScheduledTypes.current;
			const hadAllSelected = previous.size === selected.size && [...previous].every((id) => selected.has(id));
			return hadAllSelected
				? current
				: new Set([...selected].filter((id) => current.has(id)));
		});
		previousScheduledTypes.current = current;
	}, [scheduledTypes]);

	const months = useMemo(() => {
		const now = new Date();
		return visibleMonthOffsets.map((offset) => ({ ...buildMonthGrid(now, offset), offset }));
	}, [visibleMonthOffsets]);

	// Set of cardio schedule IDs for icon differentiation
	const cardioIds = useMemo(
		() => new Set(cardioActivities.map((c) => `cardio:${c.id}`)),
		[cardioActivities],
	);

	// Build log sessions grouped by date, using workout names for display
	const logByDate = useMemo(() => groupLogByDate(logRows, workoutNames), [logRows, workoutNames]);

	const handleStartEditLabel = useCallback((date: string, workoutId: string, currentLabel: string) => {
		setEditingLabel({ date, workoutId });
		setLabelDraft(currentLabel);
	}, []);

	const handleSaveLabel = useCallback(() => {
		if (editingLabel) {
			onUpdateLabel(editingLabel.date, editingLabel.workoutId, labelDraft);
		}
		setEditingLabel(null);
		setLabelDraft('');
	}, [editingLabel, labelDraft, onUpdateLabel]);

	const handleCancelEditLabel = useCallback(() => {
		setEditingLabel(null);
		setLabelDraft('');
	}, []);

	const handleAssign = useCallback(
		(workoutId: string) => {
			if (addingForDate) {
				onAssign(addingForDate, workoutId);
				setAddingForDate(null);
			}
		},
		[addingForDate, onAssign],
	);

	// Load the preceding week above the currently visible schedule cards.
	const handleLoadPreviousDays = useCallback(() => {
		setPastDays((prev) => {
			const oldest = prev[prev.length - 1] ?? todayStr();
			return [...prev, ...generatePastDays(oldest, 7)];
		});
	}, []);

	// Load more future days
	const handleLoadMoreFuture = useCallback(() => {
		setFutureDayCount((prev) => prev + 30);
	}, []);

	// Build day infos for both past and future
	const allDays = useMemo(() => {
		let combined = [...pastDays.slice().reverse(), ...futureDays];
		if (monthDayScrollTarget) {
			combined = includeCalendarDate(combined, monthDayScrollTarget.date);
		}
		return buildDayInfos(combined, scheduleMap, logByDate, flagsMap, labelsMap);
	}, [pastDays, futureDays, monthDayScrollTarget, scheduleMap, logByDate, flagsMap, labelsMap]);

	useEffect(() => {
		if (!monthDayScrollTarget) return;
		const timeout = setTimeout(() => {
			dayCardRefs.current.get(monthDayScrollTarget.date)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}, 0);
		return () => clearTimeout(timeout);
	}, [monthDayScrollTarget]);

	const handleOpenSession = useCallback((session: LogSession) => {
		setActiveSession(session);
	}, []);

	const handleCloseSession = useCallback(() => {
		setActiveSession(null);
	}, []);

	const handleSaveSession = useCallback(
		(updatedRows: ParsedLogRow[]) => {
			if (!activeSession) return;
			onUpdateLogRows(
				activeSession.key.date,
				activeSession.key.workoutId,
				activeSession.key.startTime,
				updatedRows,
			);
			// Update the active session with saved data
			setActiveSession((prev) =>
				prev ? { ...prev, rows: updatedRows } : null,
			);
		},
		[activeSession, onUpdateLogRows],
	);

	const sessionKeyStr = useCallback((session: LogSession) =>
		`${session.key.date}|${session.key.workoutId}|${session.key.startTime}`,
	[]);

	const handleDeleteSession = useCallback(
		(session: LogSession) => {
			onDeleteSession(session.key.date, session.key.workoutId, session.key.startTime);
			setConfirmDeleteKey(null);
		},
		[onDeleteSession],
	);

	// If a session detail is open, show it instead of the calendar
	if (activeSession) {
		return (
			<SessionDetail
				session={activeSession}
				workoutNames={workoutNames}
				onSave={handleSaveSession}
				onClose={handleCloseSession}
			/>
		);
	}

	return (
		<div className="calendar-view">
			<div className="calendar-fixed-section">
				<div className="calendar-toolbar">
					<button
						className={`calendar-toolbar-btn${activePanel === 'plan' ? ' calendar-toolbar-btn-active' : ''}`}
						onClick={() => setActivePanel((current) => toggleCalendarPanel(current, 'plan'))}
					>
						<CalendarCog size={16} /> Plan
					</button>
					<button
						className={`calendar-toolbar-btn${activePanel === 'sync' ? ' calendar-toolbar-btn-active' : ''}`}
						onClick={() => setActivePanel((current) => toggleCalendarPanel(current, 'sync'))}
					>
						<RefreshCw size={16} /> Sync
					</button>
					<button
						className={`calendar-toolbar-btn${activePanel === 'clear' ? ' calendar-toolbar-btn-active' : ''}`}
						onClick={() => setActivePanel((current) => toggleCalendarPanel(current, 'clear'))}
					>
						<Trash2 size={16} /> Clear
					</button>
					<button
						className={`calendar-toolbar-btn${activePanel === 'monthly' ? ' calendar-toolbar-btn-active' : ''}`}
						onClick={() => setActivePanel((current) => toggleCalendarPanel(current, 'monthly'))}
						aria-pressed={activePanel === 'monthly'}
					>
						Monthly
					</button>
				</div>
				{activePanel === 'plan' && (
					<CalendarPush
						workouts={workouts}
						cardioActivities={cardioActivities}
						onUpdateSchedule={onBulkSchedule}
					/>
				)}
				{activePanel === 'sync' && (
					<CalendarSync
						onSync={onSyncCalendar}
					/>
				)}
				{activePanel === 'clear' && (
					<CalendarClear
						onClear={onClearSchedule}
					/>
				)}

				{activePanel === 'monthly' && (
					<section className="calendar-month-section" aria-label="Monthly schedule">
				<div className="calendar-month-controls">
					<span className="calendar-month-controls-label">Monthly schedule</span>
					<div className="calendar-month-filter-controls">
						{scheduledTypes.length > 0 && (
							<WorkoutTypeFilter
								types={scheduledTypes}
								selected={selectedWorkoutTypes}
								onChange={setSelectedWorkoutTypes}
							/>
						)}
						<button
							className={`calendar-month-flags-toggle${showMonthFlags ? ' calendar-month-flags-toggle-active' : ''}`}
							onClick={() => setShowMonthFlags((show) => !show)}
							aria-pressed={showMonthFlags}
						>
							Flags
						</button>
					</div>
				</div>
				<div className="calendar-months">
					{months.map((month) => (
						<div className="calendar-month" key={`${month.year}-${month.month}`}>
							<div className="calendar-month-header">
								<h3 className="calendar-month-title">{month.label}</h3>
								{month.offset > 0 && (
									<button
										className="calendar-month-close"
										onClick={() => {
											setVisibleMonthOffsets((offsets) => offsets.filter((offset) => offset !== month.offset));
										}}
										aria-label={`Remove ${month.label}`}
									>
										<X size={15} />
									</button>
								)}
							</div>
							<div className="calendar-month-grid">
								{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
									<span className="calendar-month-weekday" key={day}>{day}</span>
								))}
								{month.dates.map((date, index) => {
									const scheduled = date
										? (scheduleMap.get(date) ?? []).filter((workoutId) => selectedWorkoutTypes.has(workoutId))
										: [];
									return date ? (
										<button
											type="button"
											className={`calendar-month-day${isToday(date) ? ' calendar-month-day-today' : ''}`}
											key={date}
											onClick={() => setMonthDayScrollTarget({ date })}
											aria-label={`${date}${scheduled.length > 0 ? `: ${scheduled.slice(0, 2).map(displayWorkoutName).join(', ')}` : ''}`}
										>
											<span className="calendar-month-day-number">{Number(date.slice(-2))}</span>
											<div className="calendar-month-tags">
												{scheduled.slice(0, 2).map((workoutId, tagIndex) => (
													<span
														className={`calendar-month-tag calendar-month-tag-${
															workoutId === REST_ID
																? 'rest'
																: workoutId.startsWith('cardio:')
																	? 'cardio'
																	: 'strength'
														}`}
														key={`${workoutId}-${tagIndex}`}
														title={displayWorkoutName(workoutId)}
														aria-label={displayWorkoutName(workoutId)}
													>
														{displayWorkoutName(workoutId)}
													</span>
												))}
											</div>
											{showMonthFlags && (
												<div className="calendar-month-flags" aria-label="Day flags">
													{DAY_FLAG_OPTIONS.map(([key, label]) => {
														const active = flagsMap.get(date)?.[key] ?? false;
														return (
														<span
															className={`calendar-month-flag calendar-month-flag-${key}${active ? ' calendar-month-flag-active' : ''}`}
															key={key}
															title={`${label}: ${active ? 'active' : 'inactive'}`}
															aria-label={`${label}: ${active ? 'active' : 'inactive'}`}
														/>
														);
													})}
												</div>
											)}
										</button>
									) : <div className="calendar-month-day calendar-month-day-empty" key={`empty-${index}`} />;
								})}
							</div>
						</div>
					))}
				</div>
				<div className="calendar-load-more">
					<button
						className="calendar-load-more-btn"
						onClick={() => setVisibleMonthOffsets((offsets) => [...offsets, Math.max(...offsets) + 1])}
					>
						Show next month
					</button>
				</div>
					</section>
				)}
			</div>

			<div className="calendar-days-scroll">
				<div className="calendar-load-more">
					<button className="calendar-load-more-btn" onClick={handleLoadPreviousDays}>
						Load previous days
					</button>
				</div>

				<div className="calendar-days">
				{allDays.map((dayInfo) => {
					const { weekday, display } = formatDate(dayInfo.date);
					const today = isToday(dayInfo.date);
					const weekend = isWeekend(dayInfo.date);
					const isPast = dayInfo.date < todayStr();

					// Deduplicate: collect all workout IDs that appear (scheduled + logged)
					const loggedWorkoutIds = new Set(dayInfo.sessions.map((s) => s.key.workoutId));
					// Map workoutId → session for quick lookup (use first matching session)
					const sessionByWorkoutId = new Map<string, LogSession>();
					for (const s of dayInfo.sessions) {
						if (!sessionByWorkoutId.has(s.key.workoutId)) {
							sessionByWorkoutId.set(s.key.workoutId, s);
						}
					}

					return (
						<div
							key={dayInfo.date}
							ref={(element) => {
								if (element) dayCardRefs.current.set(dayInfo.date, element);
								else dayCardRefs.current.delete(dayInfo.date);
							}}
							data-calendar-date={dayInfo.date}
							className={`calendar-day${today ? ' calendar-day-today' : ''}${weekend ? ' calendar-day-weekend' : ''}`}
						>
							<div className="calendar-day-header">
								<div className="calendar-day-date">
									<span className="calendar-weekday">{weekday}</span>
									<span className={`calendar-display-date${today ? ' calendar-display-date-today' : ''}`}>{display}</span>
								</div>
								<div className="calendar-day-actions">
									{DAY_FLAG_OPTIONS.map(([key, , Icon]) => {
										const currentFlags: DayFlags = dayInfo.flags ?? { home: false, elsewhere: false, travel: false, visitors: false, alcohol: false, blocked: false };
										const active = currentFlags[key];
										return (
											<button
												key={key}
												className={`calendar-flag-toggle calendar-flag-${key}${active ? ' calendar-flag-active' : ''}`}
												onClick={() => onUpdateFlags(dayInfo.date, { ...currentFlags, [key]: !active })}
												aria-label={`Toggle ${key}`}
											>
												<Icon size={18} />
											</button>
										);
									})}
									{!isPast && (
										<button
											className="calendar-add-btn"
											onClick={() => setAddingForDate(dayInfo.date)}
											aria-label={`Add workout to ${display}`}
										>
											<CalendarPlus size={18} />
										</button>
									)}
								</div>
							</div>

							{/* Scheduled workouts */}
							{dayInfo.scheduled.length > 0 && (
								<div className="calendar-workouts">
									{dayInfo.scheduled.map((wid, idx) => {
										const isCardio = cardioIds.has(wid);
										const isRest = wid === REST_ID;
										const hasLog = loggedWorkoutIds.has(wid);
										const session = sessionByWorkoutId.get(wid);
										const deleteKey = session ? sessionKeyStr(session) : null;
										const isConfirming = deleteKey !== null && confirmDeleteKey === deleteKey;
										const Icon = isRest ? Moon : isCardio ? HeartPulse : Dumbbell;
										const workoutName = workoutNames.get(wid) ?? wid;
										const customLabel = dayInfo.labels?.[wid];
										const displayName = customLabel || workoutName;
										const isEditingThisLabel = !isRest
											&& editingLabel?.date === dayInfo.date
											&& editingLabel.workoutId === wid;

										if (isEditingThisLabel) {
											return (
												<div key={`sched-${wid}-${idx}`} className="calendar-workout-item calendar-workout-item-editing">
													<Icon size={14} />
													<input
														type="text"
														className="calendar-label-input"
														value={labelDraft}
														placeholder={workoutName}
														autoFocus
														onChange={(e) => setLabelDraft(e.target.value)}
														onKeyDown={(e) => {
															if (e.key === 'Enter') handleSaveLabel();
															if (e.key === 'Escape') handleCancelEditLabel();
														}}
													/>
													<button
														className="calendar-label-save-btn"
														onClick={handleSaveLabel}
														aria-label={`Save label for ${workoutName}`}
													>
														<Check size={14} />
													</button>
													<button
														className="calendar-remove-btn"
														onClick={handleCancelEditLabel}
														aria-label="Cancel editing label"
													>
														<X size={14} />
													</button>
												</div>
											);
										}

										if (isRest) {
											return (
												<div key={`sched-${wid}-${idx}`} className="calendar-workout-item">
													<span className="calendar-workout-link calendar-workout-link-rest">
														<Icon size={14} />
														<span className="calendar-workout-name">
															{displayName}
														</span>
													</span>
													{!isPast && (
														<button
															className="calendar-remove-btn"
															onClick={() => onRemove(dayInfo.date, wid)}
															aria-label={`Remove ${workoutName}`}
														>
															<X size={14} />
														</button>
													)}
												</div>
											);
										}

										if (isCardio) {
											return (
												<div key={`sched-${wid}-${idx}`} className="calendar-workout-item">
													<span className="calendar-workout-link calendar-workout-link-cardio">
														<Icon size={14} />
														<span className="calendar-workout-name">
															{displayName}
														</span>
													</span>
													<button
														className="calendar-label-edit-btn"
														onClick={() => handleStartEditLabel(dayInfo.date, wid, customLabel ?? '')}
														aria-label={`Edit label for ${workoutName}`}
													>
														<Pencil size={14} />
													</button>
													{!isPast && (
														<button
															className="calendar-remove-btn"
															onClick={() => onRemove(dayInfo.date, wid)}
															aria-label={`Remove ${workoutName}`}
														>
															<X size={14} />
														</button>
													)}
												</div>
											);
										}

										return (
											<div key={`sched-${wid}-${idx}`} className="calendar-workout-item">
												{hasLog && <span className="calendar-completed-bar" />}
												{hasLog && session ? (
													<button
														className="calendar-workout-link"
														onClick={() => handleOpenSession(session)}
													>
														<Icon size={14} />
														<span className="calendar-workout-name">
															{displayName}
														</span>
														<ChevronRight size={14} />
													</button>
												) : isPast ? (
													<span className="calendar-workout-link">
														<Icon size={14} />
														<span className="calendar-workout-name">
															{displayName}
														</span>
													</span>
												) : (
													<button
														className="calendar-workout-link calendar-workout-link-strength"
														onClick={() => onOpenWorkout(wid)}
													>
														<Icon size={14} />
														<span className="calendar-workout-name">
															{displayName}
														</span>
														<ChevronRight size={14} />
													</button>
												)}
												<button
													className="calendar-label-edit-btn"
													onClick={() => handleStartEditLabel(dayInfo.date, wid, customLabel ?? '')}
													aria-label={`Edit label for ${workoutName}`}
												>
													<Pencil size={14} />
												</button>
												{hasLog && session && !isConfirming && (
													<button
														className="calendar-delete-btn"
														onClick={() => setConfirmDeleteKey(deleteKey)}
														aria-label={`Delete session ${workoutName}`}
													>
														<X size={14} />
													</button>
												)}
												{isConfirming && session && (
													<button
														className="calendar-delete-confirm-btn"
														onClick={() => handleDeleteSession(session)}
													>
														Delete
													</button>
												)}
												{!isPast && !hasLog && (
													<button
														className="calendar-remove-btn"
														onClick={() => onRemove(dayInfo.date, wid)}
														aria-label={`Remove ${workoutName}`}
													>
														<X size={14} />
													</button>
												)}
											</div>
										);
									})}
								</div>
							)}

							{/* Logged sessions not already shown via schedule */}
							{dayInfo.sessions.filter((s) => !dayInfo.scheduled.includes(s.key.workoutId)).length > 0 && (
								<div className="calendar-workouts">
									{dayInfo.sessions
										.filter((s) => !dayInfo.scheduled.includes(s.key.workoutId))
										.map((session, idx) => {
											const name = workoutNames.get(session.key.workoutId) ?? session.workoutName;
											const deleteKey = sessionKeyStr(session);
											const isConfirming = confirmDeleteKey === deleteKey;
											return (
												<div key={`log-${session.key.workoutId}-${idx}`} className="calendar-workout-item">
													<span className="calendar-completed-bar" />
													<button
														className="calendar-workout-link"
														onClick={() => handleOpenSession(session)}
													>
														<Dumbbell size={14} />
														<span className="calendar-workout-name">{name}</span>
														<ChevronRight size={14} />
													</button>
													{!isConfirming && (
														<button
															className="calendar-delete-btn"
															onClick={() => setConfirmDeleteKey(deleteKey)}
															aria-label={`Delete session ${name}`}
														>
															<X size={14} />
														</button>
													)}
													{isConfirming && (
														<button
															className="calendar-delete-confirm-btn"
															onClick={() => handleDeleteSession(session)}
														>
															Delete
														</button>
													)}
												</div>
											);
										})}
								</div>
							)}

							{/* Workout picker overlay for this day */}
							{addingForDate === dayInfo.date && (
								<div className="calendar-picker">
									<div className="calendar-picker-header">
										<span>Assign workout</span>
										<button
											className="calendar-picker-close"
											onClick={() => setAddingForDate(null)}
										>
											<X size={16} />
										</button>
									</div>
									<div className="calendar-picker-list">
										<button
											className="calendar-picker-item calendar-picker-item-rest"
											onClick={() => handleAssign(REST_ID)}
										>
											<Moon size={14} />
											Rest
										</button>
										{workouts.length > 0 && (
											<div className="calendar-picker-divider">Strength</div>
										)}
										{workouts.map((w) => (
											<button
												key={w.id}
												className="calendar-picker-item calendar-picker-item-strength"
												onClick={() => handleAssign(w.id)}
											>
												<Dumbbell size={14} />
												{w.name}
											</button>
										))}
										{cardioActivities.length > 0 && (
											<>
												<div className="calendar-picker-divider">Cardio</div>
												{cardioActivities.map((c) => (
													<button
														key={c.id}
														className="calendar-picker-item calendar-picker-item-cardio"
														onClick={() => handleAssign(`cardio:${c.id}`)}
													>
														<HeartPulse size={14} />
														{c.name}
													</button>
												))}
											</>
										)}
									</div>
								</div>
							)}
						</div>
					);
				})}
				</div>

				{/* Load more future days */}
				<div className="calendar-load-more">
					<button className="calendar-load-more-btn" onClick={handleLoadMoreFuture}>
						Load more days
					</button>
				</div>
			</div>
		</div>
	);
}
