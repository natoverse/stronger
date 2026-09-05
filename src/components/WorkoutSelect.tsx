import { useMemo, useState, useRef, useEffect } from 'react';
import type { Workout, WorkoutScheduleEntry, CardioActivity } from '../model/index.js';
import { REST_ID, BLOCKER_ID } from '../model/index.js';
import type { ParsedLogRow } from '../google/index.js';
import type { LogSession } from './CalendarView.js';
import { groupLogByDate, scheduledWorkoutRank } from './CalendarView.js';
import { Banner } from './Banner.js';
import { MotivationalQuote } from './MotivationalQuote.js';
import { BicepsFlexed, ChevronDown, Pencil, Plus, Star, Bike, Trash2, Check, X, Copy, MoreVertical, Share2, HeartPulse, Moon, Ban } from 'lucide-react';

interface WorkoutSelectProps {
	workouts: Workout[];
	missingLiftIds?: string[];
	workoutSchedule?: WorkoutScheduleEntry[];
	logRows?: ParsedLogRow[];
	showDefaultWorkoutImportPrompt?: boolean;
	defaultWorkoutImportError?: string | null;
	onImportDefaultWorkouts?: () => void;
	onShowDefaultWorkoutImportPrompt?: () => void;
	onDismissDefaultWorkoutImportPrompt?: () => void;
	onSelect: (workout: Workout) => void;
	onViewSession?: (session: LogSession) => void;
	onEdit?: (workoutId: string) => void;
	onDuplicate?: (workoutId: string) => void;
	onShare?: (workoutId: string) => void;
	onDelete?: (workoutId: string) => void;
	onNew?: () => void;
	onToggleFavorite?: (workoutId: string, favorite: boolean) => void;
	cardioActivities?: CardioActivity[];
	onCardioSave?: (activities: CardioActivity[]) => void;
}

function WorkoutCard({
	w,
	onSelect,
	onEdit,
	onDuplicate,
	onShare,
	onDelete,
	onToggleFavorite,
	done,
}: {
	w: Workout;
	onSelect: (w: Workout) => void;
	onEdit?: (id: string) => void;
	onDuplicate?: (id: string) => void;
	onShare?: (id: string) => void;
	onDelete?: (id: string) => void;
	onToggleFavorite?: (id: string, fav: boolean) => void;
	done?: boolean;
}) {
	const [menuOpen, setMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!menuOpen) return;
		const handleClick = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				setMenuOpen(false);
			}
		};
		document.addEventListener('mousedown', handleClick);
		return () => document.removeEventListener('mousedown', handleClick);
	}, [menuOpen]);

	const hasMenu = onEdit || onDuplicate || onShare || onDelete;

	return (
		<div className={`workout-card-wrapper${done ? ' workout-card-wrapper-done' : ''}`}>
			{onToggleFavorite && (
				<button
					className={`btn-fav-workout${w.favorite ? ' btn-fav-active' : ''}`}
					aria-label={w.favorite ? `Remove ${w.name} from favorites` : `Add ${w.name} to favorites`}
					onClick={() => onToggleFavorite(w.id, !w.favorite)}
				>
					<Star size={16} fill={w.favorite ? 'currentColor' : 'none'} />
				</button>
			)}
			<button
				className={`workout-card${done ? ' workout-card-done' : ''}`}
				onClick={() => onSelect(w)}
			>
				<span className="strength-badge"><BicepsFlexed size={24} /></span>
				<span className="workout-name">{w.name}</span>
			</button>
			{hasMenu && (
				<div className="workout-menu-container" ref={menuRef}>
					<button
						className="btn-edit-workout"
						aria-label={`Actions for ${w.name}`}
						onClick={() => setMenuOpen(!menuOpen)}
					>
						<MoreVertical size={16} />
					</button>
					{menuOpen && (
						<div className="workout-dropdown-menu">
							{onEdit && (
								<button className="workout-dropdown-item" onClick={() => { setMenuOpen(false); onEdit(w.id); }}>
									<Pencil size={14} /> Edit
								</button>
							)}
							{onDuplicate && (
								<button className="workout-dropdown-item" onClick={() => { setMenuOpen(false); onDuplicate(w.id); }}>
									<Copy size={14} /> Duplicate
								</button>
							)}
							{onShare && (
								<button className="workout-dropdown-item" onClick={() => { setMenuOpen(false); onShare(w.id); }}>
									<Share2 size={14} /> Share
								</button>
							)}
							{onDelete && (
								<button className="workout-dropdown-item workout-dropdown-item-danger" onClick={() => { setMenuOpen(false); onDelete(w.id); }}>
									<Trash2 size={14} /> Delete
								</button>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

/** Get today's date in YYYY-MM-DD format using local time. */
function todayDateString(): string {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A single item in today's plan, shown on the home page. */
export type TodayPlanItem =
	| { kind: 'strength'; workoutId: string; workout: Workout; done: boolean }
	| { kind: 'cardio' | 'rest' | 'blocker'; workoutId: string; name: string };

/**
 * Build the ordered list of items scheduled for a given date: blockers first,
 * then cardio, then strength workouts, then rest — matching the calendar's
 * ordering. Strength entries whose workout is unknown are dropped.
 */
export function buildTodaysPlan({
	date,
	workoutSchedule,
	workouts,
	cardioActivities,
	logRows,
}: {
	date: string;
	workoutSchedule?: WorkoutScheduleEntry[];
	workouts: Workout[];
	cardioActivities?: CardioActivity[];
	logRows?: ParsedLogRow[];
}): TodayPlanItem[] {
	if (!workoutSchedule) return [];
	const entries = workoutSchedule.filter((e) => e.date === date && e.workoutId);
	if (entries.length === 0) return [];

	const workoutMap = new Map(workouts.map((w) => [w.id, w]));
	const cardioNameByWorkoutId = new Map((cardioActivities ?? []).map((c) => [`cardio:${c.id}`, c.name]));

	const completedIds = new Set<string>();
	for (const row of logRows ?? []) {
		if (row.date === date) completedIds.add(row.workoutId);
	}

	const items: TodayPlanItem[] = [];
	for (const e of entries) {
		const wid = e.workoutId;
		if (wid === BLOCKER_ID) {
			items.push({ kind: 'blocker', workoutId: wid, name: e.label || 'Blocker' });
		} else if (wid === REST_ID) {
			items.push({ kind: 'rest', workoutId: wid, name: 'Rest' });
		} else if (wid.startsWith('cardio:')) {
			const defaultName = cardioNameByWorkoutId.get(wid) ?? wid.slice('cardio:'.length);
			items.push({ kind: 'cardio', workoutId: wid, name: e.label || defaultName });
		} else {
			const workout = workoutMap.get(wid);
			if (!workout) continue;
			items.push({ kind: 'strength', workoutId: wid, workout, done: completedIds.has(wid) });
		}
	}

	return items
		.map((item, index) => ({ item, index }))
		.sort((a, b) =>
			scheduledWorkoutRank(a.item.workoutId) - scheduledWorkoutRank(b.item.workoutId)
			|| a.index - b.index,
		)
		.map(({ item }) => item);
}

const PLAN_ITEM_ICONS = {
	cardio: HeartPulse,
	rest: Moon,
	blocker: Ban,
} as const;

/** Non-interactive card for a scheduled cardio, rest or blocker item. */
function PlanInfoCard({ kind, name }: { kind: 'cardio' | 'rest' | 'blocker'; name: string }) {
	const Icon = PLAN_ITEM_ICONS[kind];
	return (
		<div className={`workout-card-wrapper plan-info-card plan-info-card-${kind}`}>
			<div className="workout-card plan-info-card-body">
				<span className="strength-badge"><Icon size={24} /></span>
				<span className="workout-name">{name}</span>
			</div>
		</div>
	);
}

export function WorkoutSelect({
	workouts,
	missingLiftIds,
	workoutSchedule,
	logRows,
	showDefaultWorkoutImportPrompt,
	defaultWorkoutImportError,
	onImportDefaultWorkouts,
	onShowDefaultWorkoutImportPrompt,
	onDismissDefaultWorkoutImportPrompt,
	onSelect,
	onViewSession,
	onEdit,
	onDuplicate,
	onShare,
	onDelete,
	onNew,
	onToggleFavorite,
	cardioActivities,
	onCardioSave,
}: WorkoutSelectProps) {
	const { favorites, others } = useMemo(() => {
		const favorites: Workout[] = [];
		const others: Workout[] = [];
		for (const w of workouts) {
			if (w.favorite) favorites.push(w);
			else others.push(w);
		}
		return { favorites, others };
	}, [workouts]);

	const today = useMemo(() => todayDateString(), []);

	/** Items scheduled for today (blockers, cardio, strength, rest). */
	const todaysPlan = useMemo(
		() => buildTodaysPlan({ date: today, workoutSchedule, workouts, cardioActivities, logRows }),
		[workoutSchedule, logRows, workouts, cardioActivities, today],
	);

	/** Build a map of today's sessions for completed workouts. */
	const todaySessions = useMemo(() => {
		if (!logRows) return new Map<string, LogSession>();
		const workoutNames = new Map(workouts.map((w) => [w.id, w.name]));
		const byDate = groupLogByDate(logRows, workoutNames);
		const todayList = byDate.get(today) ?? [];
		const map = new Map<string, LogSession>();
		for (const session of todayList) {
			// Keep the latest session per workoutId
			map.set(session.key.workoutId, session);
		}
		return map;
	}, [logRows, workouts, today]);

	const handleTodayCardClick = (workout: Workout, done: boolean) => {
		if (done && onViewSession) {
			const session = todaySessions.get(workout.id);
			if (session) {
				onViewSession(session);
				return;
			}
		}
		onSelect(workout);
	};

	const [moreOpen, setMoreOpen] = useState(false);
	const canImportDefaultWorkouts = !!showDefaultWorkoutImportPrompt && !!onImportDefaultWorkouts;
	const canOfferImportDefaultWorkouts = !!onShowDefaultWorkoutImportPrompt && !!onImportDefaultWorkouts;

	return (
		<div className="workout-select">
			<Banner />
			<MotivationalQuote />
			{todaysPlan.length > 0 && (
				<div className="todays-plan">
					<div className="workout-list">
						{todaysPlan.map((item, idx) => (
							item.kind === 'strength' ? (
								<WorkoutCard
									key={`plan-${item.workoutId}-${idx}`}
									w={item.workout}
									onSelect={() => handleTodayCardClick(item.workout, item.done)}
									done={item.done}
								/>
							) : (
								<PlanInfoCard key={`plan-${item.workoutId}-${idx}`} kind={item.kind} name={item.name} />
							)
						))}
					</div>
				</div>
			)}
			{workouts.length === 0 ? (
				<div>
					{!canImportDefaultWorkouts && (
						<p className="auth-error">
							{canOfferImportDefaultWorkouts
								? 'No workouts available. You can import the default workouts or check your sheet data.'
								: 'No workouts available. Check that your sheet has valid lift configurations with numeric values for all weight fields.'}
						</p>
					)}
					{!canImportDefaultWorkouts && canOfferImportDefaultWorkouts && (
						<button className="btn-link" onClick={onShowDefaultWorkoutImportPrompt}>
							Show default workout import
						</button>
					)}
					{canImportDefaultWorkouts && (
						<div className="workout-import-defaults-prompt">
							<p>No workouts were found in your sheet. Import the default starter workouts?</p>
							<button className="btn-primary" onClick={onImportDefaultWorkouts}>
								Import default workouts
							</button>
							{defaultWorkoutImportError && (
								<p className="auth-error">{defaultWorkoutImportError}</p>
							)}
							{onDismissDefaultWorkoutImportPrompt && (
								<button
									className="btn-link"
									onClick={onDismissDefaultWorkoutImportPrompt}
								>
									Not now
								</button>
							)}
						</div>
					)}
				</div>
			) : (
				<div className="workout-list">
					{favorites.map((w) => (
						<WorkoutCard key={w.id} w={w} onSelect={onSelect} onEdit={onEdit} onDuplicate={onDuplicate} onShare={onShare} onDelete={onDelete} onToggleFavorite={onToggleFavorite} />
					))}
					{others.length > 0 && (
						<>
							<button
								className="btn-more-toggle"
								onClick={() => setMoreOpen(!moreOpen)}
								aria-expanded={moreOpen}
							>
								More…
								<ChevronDown size={16} className={`more-chevron${moreOpen ? ' more-chevron-open' : ''}`} />
							</button>
							{moreOpen && others.map((w) => (
								<WorkoutCard key={w.id} w={w} onSelect={onSelect} onEdit={onEdit} onDuplicate={onDuplicate} onShare={onShare} onDelete={onDelete} onToggleFavorite={onToggleFavorite} />
							))}
						</>
					)}
					{onNew && (
						<button className="btn-new-workout" onClick={onNew}>
							<Plus size={20} /> New Workout
						</button>
					)}
				</div>
			)}
			{cardioActivities && onCardioSave && (
				<CardioSection activities={cardioActivities} onSave={onCardioSave} />
			)}
			{missingLiftIds && missingLiftIds.length > 0 && (
				<p className="config-warning">
					Missing lift configs: {missingLiftIds.join(', ')}
				</p>
			)}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/*  Cardio section                                                     */
/* ------------------------------------------------------------------ */

/** Generate a kebab-case id from a name. */
function nameToCardioId(name: string): string {
	return name.trim().toLowerCase().replace(/\s+/g, '-');
}

function CardioSection({ activities, onSave }: { activities: CardioActivity[]; onSave: (a: CardioActivity[]) => void }) {
	const [open, setOpen] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editName, setEditName] = useState('');
	const [adding, setAdding] = useState(false);
	const [newName, setNewName] = useState('');

	const handleEdit = (a: CardioActivity) => {
		setEditingId(a.id);
		setEditName(a.name);
		setAdding(false);
	};

	const handleEditSave = () => {
		const trimmed = editName.trim();
		if (!trimmed || !editingId) return;
		const newId = nameToCardioId(trimmed);
		const updated = activities
			.map((a) => a.id === editingId ? { id: newId, name: trimmed } : a)
			.sort((a, b) => a.name.localeCompare(b.name));
		onSave(updated);
		setEditingId(null);
		setEditName('');
	};

	const handleEditCancel = () => {
		setEditingId(null);
		setEditName('');
	};

	const handleDelete = (id: string) => {
		onSave(activities.filter((a) => a.id !== id));
	};

	const handleAddStart = () => {
		setAdding(true);
		setNewName('');
		setEditingId(null);
	};

	const handleAddSave = () => {
		const trimmed = newName.trim();
		if (!trimmed) return;
		const id = nameToCardioId(trimmed);
		if (activities.some((a) => a.id === id)) return;
		onSave([...activities, { id, name: trimmed }].sort((a, b) => a.name.localeCompare(b.name)));
		setAdding(false);
		setNewName('');
	};

	const handleAddCancel = () => {
		setAdding(false);
		setNewName('');
	};

	return (
		<div className="cardio-section">
			<button
				className="btn-cardio-toggle"
				onClick={() => setOpen(!open)}
				aria-expanded={open}
			>
				<Bike size={18} />
				Cardio
				<ChevronDown size={16} className={`more-chevron${open ? ' more-chevron-open' : ''}`} />
			</button>
			{open && (
				<div className="cardio-list">
					{activities.map((a) => (
						<div key={a.id} className="cardio-item">
							{editingId === a.id ? (
								<div className="cardio-edit-row">
									<input
										className="cardio-edit-input"
										value={editName}
										onChange={(e) => setEditName(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === 'Enter') handleEditSave();
											if (e.key === 'Escape') handleEditCancel();
										}}
										autoFocus
									/>
									<button className="btn-cardio-action btn-cardio-confirm" onClick={handleEditSave} aria-label="Save"><Check size={14} /></button>
									<button className="btn-cardio-action btn-cardio-cancel" onClick={handleEditCancel} aria-label="Cancel"><X size={14} /></button>
								</div>
							) : (
								<>
									<span className="cardio-name">{a.name}</span>
									<button className="btn-cardio-action" onClick={() => handleEdit(a)} aria-label={`Edit ${a.name}`}><Pencil size={14} /></button>
									<button className="btn-cardio-action btn-cardio-delete" onClick={() => handleDelete(a.id)} aria-label={`Delete ${a.name}`}><Trash2 size={14} /></button>
								</>
							)}
						</div>
					))}
					{adding ? (
						<div className="cardio-edit-row cardio-add-row">
							<input
								className="cardio-edit-input"
								value={newName}
								onChange={(e) => setNewName(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === 'Enter') handleAddSave();
									if (e.key === 'Escape') handleAddCancel();
								}}
								placeholder="Activity name"
								autoFocus
							/>
							<button className="btn-cardio-action btn-cardio-confirm" onClick={handleAddSave} aria-label="Save"><Check size={14} /></button>
							<button className="btn-cardio-action btn-cardio-cancel" onClick={handleAddCancel} aria-label="Cancel"><X size={14} /></button>
						</div>
					) : (
						<button className="btn-new-cardio" onClick={handleAddStart}>
							<Plus size={16} /> New Activity
						</button>
					)}
				</div>
			)}
		</div>
	);
}
