import { useMemo, useState, useRef, useEffect } from 'react';
import type { Workout, ScheduleEntry, CardioActivity } from '../model/index.js';
import type { ParsedLogRow } from '../google/index.js';
import type { LogSession } from './CalendarView.js';
import { groupLogByDate } from './CalendarView.js';
import { Banner } from './Banner.js';
import { MotivationalQuote } from './MotivationalQuote.js';
import { BicepsFlexed, ChevronDown, Pencil, Plus, Star, Bike, Trash2, Check, X, Copy, MoreVertical } from 'lucide-react';

interface WorkoutSelectProps {
	workouts: Workout[];
	missingLiftIds?: string[];
	schedule?: ScheduleEntry[];
	logRows?: ParsedLogRow[];
	onSelect: (workout: Workout) => void;
	onViewSession?: (session: LogSession) => void;
	onEdit?: (workoutId: string) => void;
	onDuplicate?: (workoutId: string) => void;
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
	onDelete,
	onToggleFavorite,
	done,
}: {
	w: Workout;
	onSelect: (w: Workout) => void;
	onEdit?: (id: string) => void;
	onDuplicate?: (id: string) => void;
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

	const hasMenu = onEdit || onDuplicate || onDelete;

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

export function WorkoutSelect({ workouts, missingLiftIds, schedule, logRows, onSelect, onViewSession, onEdit, onDuplicate, onDelete, onNew, onToggleFavorite, cardioActivities, onCardioSave }: WorkoutSelectProps) {
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

	/** Workouts scheduled for today, with completion status. */
	const todaysPlan = useMemo(() => {
		if (!schedule) return [];
		const todayEntries = schedule.filter((e) => e.date === today);
		if (todayEntries.length === 0) return [];

		const workoutMap = new Map(workouts.map((w) => [w.id, w]));

		// Build a set of workoutIds that have log entries for today
		const completedIds = new Set<string>();
		if (logRows) {
			for (const row of logRows) {
				if (row.date === today) {
					completedIds.add(row.workoutId);
				}
			}
		}

		return todayEntries
			.map((e) => {
				const workout = workoutMap.get(e.workoutId);
				if (!workout) return null;
				return { workout, done: completedIds.has(e.workoutId) };
			})
			.filter((x): x is { workout: Workout; done: boolean } => x !== null);
	}, [schedule, logRows, workouts, today]);

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

	return (
		<div className="workout-select">
			<Banner />
			<MotivationalQuote />
			{todaysPlan.length > 0 && (
				<div className="todays-plan">
					<div className="workout-list">
						{todaysPlan.map(({ workout: w, done }) => (
							<WorkoutCard
								key={w.id}
								w={w}
								onSelect={() => handleTodayCardClick(w, done)}
								done={done}
							/>
						))}
					</div>
				</div>
			)}
			{workouts.length === 0 ? (
				<p className="auth-error">
					No workouts available. Check that your sheet has valid lift
					configurations with numeric values for all weight fields.
				</p>
			) : (
				<div className="workout-list">
					{favorites.map((w) => (
						<WorkoutCard key={w.id} w={w} onSelect={onSelect} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={onDelete} onToggleFavorite={onToggleFavorite} />
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
								<WorkoutCard key={w.id} w={w} onSelect={onSelect} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={onDelete} onToggleFavorite={onToggleFavorite} />
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
			<a
				className="github-link"
				href="https://github.com/natoverse/stronger"
				target="_blank"
				rel="noopener noreferrer"
			>
				<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
					<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
				</svg>
				GitHub
			</a>
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
