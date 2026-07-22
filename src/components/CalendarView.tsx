import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { Workout, WorkoutScheduleEntry, SetType, CardioActivity, DayFlags, DayFlagEntry } from '../model/index.js';
import { REST_ID } from '../model/index.js';
import type { ParsedLogRow, CalendarSyncResult } from '../google/index.js';
import { CalendarPlus, X, ChevronRight, ChevronLeft, Dumbbell, History, Save, Check, CalendarCog, HeartPulse, House, Palmtree, Plane, Users, Martini, Ban, RefreshCw, Loader, CheckCircle, AlertCircle, Trash2, Moon } from 'lucide-react';
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
}

export function buildDayInfos(
	dates: string[],
	scheduleMap: Map<string, string[]>,
	logByDate: Map<string, LogSession[]>,
	flagsMap?: Map<string, DayFlags>,
): DayInfo[] {
	return dates.map((date) => ({
		date,
		scheduled: scheduleMap.get(date) ?? [],
		sessions: logByDate.get(date) ?? [],
		flags: flagsMap?.get(date),
	}));
}

const SET_TYPES: SetType[] = ['warmup', 'work', 'backoff', 'joker'];

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
	onOpenWorkout,
	onUpdateLogRows,
	onDeleteSession,
	onBulkSchedule,
	onUpdateFlags,
	onSyncCalendar,
	onClearSchedule,
}: CalendarViewProps) {
	const [addingForDate, setAddingForDate] = useState<string | null>(null);
	const [showPush, setShowPush] = useState(false);
	const [showSync, setShowSync] = useState(false);
	const [showClear, setShowClear] = useState(false);
	const [historyMode, setHistoryMode] = useState(false);
	const [pastDays, setPastDays] = useState<string[]>([]);
	const [activeSession, setActiveSession] = useState<LogSession | null>(null);
	const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
	const historyTopRef = useRef<HTMLDivElement>(null);
	const todayRef = useRef<HTMLDivElement>(null);

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

	// Set of cardio schedule IDs for icon differentiation
	const cardioIds = useMemo(
		() => new Set(cardioActivities.map((c) => `cardio:${c.id}`)),
		[cardioActivities],
	);

	// Build log sessions grouped by date, using workout names for display
	const logByDate = useMemo(() => groupLogByDate(logRows, workoutNames), [logRows, workoutNames]);

	const handleAssign = useCallback(
		(workoutId: string) => {
			if (addingForDate) {
				onAssign(addingForDate, workoutId);
				setAddingForDate(null);
			}
		},
		[addingForDate, onAssign],
	);

	// Toggle history mode — load initial batch of past days
	const handleToggleHistory = useCallback(() => {
		if (historyMode) {
			setHistoryMode(false);
			setPastDays([]);
		} else {
			const today = todayStr();
			// Load 7 days of history initially
			setPastDays(generatePastDays(today, 7));
			setHistoryMode(true);
		}
	}, [historyMode]);

	// Load more past days
	const handleLoadMore = useCallback(() => {
		if (pastDays.length === 0) return;
		const oldest = pastDays[pastDays.length - 1];
		const moreDays = generatePastDays(oldest, 7);
		setPastDays((prev) => [...prev, ...moreDays]);
	}, [pastDays]);

	// Load more future days
	const handleLoadMoreFuture = useCallback(() => {
		setFutureDayCount((prev) => prev + 30);
	}, []);

	// Scroll to today when history mode is activated
	useEffect(() => {
		if (historyMode && todayRef.current) {
			// Small delay to let DOM render
			setTimeout(() => {
				todayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
			}, 100);
		}
	}, [historyMode]);

	// Build day infos for both past and future
	const allDays = useMemo(() => {
		const combined = historyMode
			? [...pastDays.slice().reverse(), ...futureDays]
			: futureDays;
		return buildDayInfos(combined, scheduleMap, logByDate, flagsMap);
	}, [historyMode, pastDays, futureDays, scheduleMap, logByDate, flagsMap]);

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

	const handleTogglePush = () => {
		const opening = !showPush;
		setShowPush(opening);
		if (opening) { setShowSync(false); setShowClear(false); }
	};

	const handleToggleSync = () => {
		const opening = !showSync;
		setShowSync(opening);
		if (opening) { setShowPush(false); setShowClear(false); }
	};

	const handleToggleClear = () => {
		const opening = !showClear;
		setShowClear(opening);
		if (opening) { setShowPush(false); setShowSync(false); }
	};

	return (
		<div className="calendar-view">
			<div className="calendar-toolbar">
				<button
					className={`calendar-toolbar-btn${showPush ? ' calendar-toolbar-btn-active' : ''}`}
					onClick={handleTogglePush}
				>
					<CalendarCog size={16} /> Plan
				</button>
				<button
					className={`calendar-toolbar-btn${showSync ? ' calendar-toolbar-btn-active' : ''}`}
					onClick={handleToggleSync}
				>
					<RefreshCw size={16} /> Sync
				</button>
				<button
					className={`calendar-toolbar-btn${historyMode ? ' calendar-toolbar-btn-active' : ''}`}
					onClick={handleToggleHistory}
				>
					<History size={16} />
					{historyMode ? 'Hide History' : 'History'}
				</button>
				<button
					className={`calendar-toolbar-btn${showClear ? ' calendar-toolbar-btn-active' : ''}`}
					onClick={handleToggleClear}
				>
					<Trash2 size={16} /> Clear
				</button>
			</div>
			{showPush && (
				<CalendarPush
					workouts={workouts}
					cardioActivities={cardioActivities}
					onClose={() => setShowPush(false)}
					onUpdateSchedule={onBulkSchedule}
				/>
			)}
			{showSync && (
				<CalendarSync
					onSync={onSyncCalendar}
					onClose={() => setShowSync(false)}
				/>
			)}
			{showClear && (
				<CalendarClear
					onClear={onClearSchedule}
					onClose={() => setShowClear(false)}
				/>
			)}

			{/* Load more button at top of history */}
			{historyMode && pastDays.length > 0 && (
				<div className="calendar-load-more" ref={historyTopRef}>
					<button className="calendar-load-more-btn" onClick={handleLoadMore}>
						Load earlier days
					</button>
				</div>
			)}

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
							ref={today ? todayRef : undefined}
							className={`calendar-day${today ? ' calendar-day-today' : ''}${weekend ? ' calendar-day-weekend' : ''}`}
						>
							<div className="calendar-day-header">
								<div className="calendar-day-date">
									<span className="calendar-weekday">{weekday}</span>
									<span className={`calendar-display-date${today ? ' calendar-display-date-today' : ''}`}>{display}</span>
								</div>
								<div className="calendar-day-actions">
									{([
										['home', House],
										['elsewhere', Palmtree],
										['travel', Plane],
										['visitors', Users],
										['alcohol', Martini],
										['blocked', Ban],
									] as [keyof DayFlags, typeof House][]).map(([key, Icon]) => {
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

										if (isRest) {
											return (
												<div key={`sched-${wid}-${idx}`} className="calendar-workout-item">
													<span className="calendar-workout-link calendar-workout-link-rest">
														<Icon size={14} />
														<span className="calendar-workout-name">
															{workoutNames.get(wid) ?? wid}
														</span>
													</span>
													{!isPast && (
														<button
															className="calendar-remove-btn"
															onClick={() => onRemove(dayInfo.date, wid)}
															aria-label={`Remove ${workoutNames.get(wid) ?? wid}`}
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
															{workoutNames.get(wid) ?? wid}
														</span>
													</span>
													{!isPast && (
														<button
															className="calendar-remove-btn"
															onClick={() => onRemove(dayInfo.date, wid)}
															aria-label={`Remove ${workoutNames.get(wid) ?? wid}`}
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
															{workoutNames.get(wid) ?? wid}
														</span>
														<ChevronRight size={14} />
													</button>
												) : isPast ? (
													<span className="calendar-workout-link">
														<Icon size={14} />
														<span className="calendar-workout-name">
															{workoutNames.get(wid) ?? wid}
														</span>
													</span>
												) : (
													<button
														className="calendar-workout-link calendar-workout-link-strength"
														onClick={() => onOpenWorkout(wid)}
													>
														<Icon size={14} />
														<span className="calendar-workout-name">
															{workoutNames.get(wid) ?? wid}
														</span>
														<ChevronRight size={14} />
													</button>
												)}
												{hasLog && session && !isConfirming && (
													<button
														className="calendar-delete-btn"
														onClick={() => setConfirmDeleteKey(deleteKey)}
														aria-label={`Delete session ${workoutNames.get(wid) ?? wid}`}
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
														aria-label={`Remove ${workoutNames.get(wid) ?? wid}`}
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
	);
}

