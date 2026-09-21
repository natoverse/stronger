import type { SetResult } from '../model/index.js';
import type { CycleSessionSnapshot, Workout } from '../model/types.js';

/**
 * localStorage key for in-progress workout data.
 * Stores workoutId, startTime, and set results so the user
 * can refresh without losing progress.
 */
const DRAFT_KEY = 'stronger_workout_draft';

/** Shape of the persisted draft. */
export interface WorkoutDraft {
	workoutId: string;
	startTime: string;
	results: SetResult[][];
	snapshot?: CycleSessionSnapshot;
	executionWorkout?: Workout;
	draftVersion?: number;
}

function draftKey(uid?: string, workoutId?: string): string {
	return uid
		? `${DRAFT_KEY}:${encodeURIComponent(uid)}:${encodeURIComponent(workoutId ?? '')}`
		: DRAFT_KEY;
}

/** Read the draft from localStorage (returns null if absent or corrupt). */
export function loadDraft(uid?: string, workoutId?: string): WorkoutDraft | null {
	try {
		if (uid && !workoutId) return null;
		const raw = localStorage.getItem(draftKey(uid, workoutId));
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!isDraft(parsed) || (workoutId && parsed.workoutId !== workoutId)) return null;
		return parsed;
	} catch {
		return null;
	}
}

/** Persist the current workout state to localStorage. */
export function saveDraft(draft: WorkoutDraft, uid?: string): number {
	let draftVersion = draft.draftVersion ?? 1;
	try {
		const previous = loadDraft(uid, uid ? draft.workoutId : undefined);
		const snapshot = draft.snapshot ?? (
			previous?.workoutId === draft.workoutId && previous.startTime === draft.startTime
				? previous.snapshot
				: undefined
		);
		draftVersion = draft.draftVersion ?? (
			previous?.snapshot?.id === snapshot?.id ? previous?.draftVersion ?? 0 : 0
		) + 1;
		localStorage.setItem(draftKey(uid, draft.workoutId), JSON.stringify({
			...draft,
			...(snapshot ? { snapshot, draftVersion } : {}),
			...(draft.executionWorkout ? { executionWorkout: draft.executionWorkout }
				: previous?.startTime === draft.startTime && previous?.executionWorkout
					? { executionWorkout: previous.executionWorkout } : {}),
		}));
	} catch {
		// Quota exceeded or private browsing — silently ignore
	}
	return draftVersion;
}

/** Remove the draft from localStorage. */
export function clearDraft(uid?: string, workoutId?: string): void {
	try {
		if (uid && !workoutId) return;
		localStorage.removeItem(draftKey(uid, workoutId));
	} catch {
		// Ignore
	}
}

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

function isSetResult(v: unknown): v is SetResult {
	if (typeof v !== 'object' || v === null) return false;
	const o = v as Record<string, unknown>;
	return (
		typeof o.actualWeight === 'number' &&
		typeof o.actualReps === 'number' &&
		typeof o.completed === 'boolean' &&
		typeof o.actualSetType === 'string'
	);
}

function isDraft(v: unknown): v is WorkoutDraft {
	if (typeof v !== 'object' || v === null) return false;
	const o = v as Record<string, unknown>;
	if (typeof o.workoutId !== 'string' || typeof o.startTime !== 'string') return false;
	if (!Array.isArray(o.results)) return false;
	if (o.draftVersion !== undefined && (
		typeof o.draftVersion !== 'number' || !Number.isSafeInteger(o.draftVersion) || o.draftVersion < 0
	)) return false;
	if (o.snapshot !== undefined) {
		if (typeof o.snapshot !== 'object' || o.snapshot === null) return false;
		const snapshot = o.snapshot as Partial<CycleSessionSnapshot>;
		if (typeof snapshot.id !== 'string' || snapshot.workout?.id !== o.workoutId
			|| snapshot.progress?.workoutId !== o.workoutId
			|| !Number.isInteger(snapshot.progress?.revision)
			|| !Array.isArray(snapshot.templates)
			|| !Array.isArray(snapshot.workout?.exercises)
			|| !Array.isArray(snapshot.progress?.exercises)) return false;
	}
	return (o.results as unknown[]).every(
		(ex) => Array.isArray(ex) && (ex as unknown[]).every(isSetResult),
	);
}
