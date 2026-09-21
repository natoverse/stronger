import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { loadDraft, saveDraft, clearDraft } from '../../hooks/useWorkoutDraft.js';
import type { WorkoutDraft } from '../../hooks/useWorkoutDraft.js';
import type { CycleSessionSnapshot } from '../../model/types.js';

function makeDraft(overrides?: Partial<WorkoutDraft>): WorkoutDraft {
	return {
		workoutId: 'rss-bench',
		startTime: '2026-04-06T10:00:00.000Z',
		results: [
			[
				{ actualWeight: 135, actualReps: 5, completed: true, actualSetType: 'warmup' },
				{ actualWeight: 200, actualReps: 3, completed: false, actualSetType: 'work' },
			],
		],
		...overrides,
	};
}

// Minimal localStorage mock (vitest runs without a DOM by default)
function mockLocalStorage() {
	const store = new Map<string, string>();
	const mock = {
		getItem: vi.fn((key: string) => store.get(key) ?? null),
		setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
		removeItem: vi.fn((key: string) => { store.delete(key); }),
		clear: vi.fn(() => { store.clear(); }),
		get length() { return store.size; },
		key: vi.fn((_i: number) => null),
	};
	Object.defineProperty(globalThis, 'localStorage', { value: mock, writable: true, configurable: true });
	return mock;
}

describe('workout draft persistence', () => {
	let storage: ReturnType<typeof mockLocalStorage>;

	beforeEach(() => {
		storage = mockLocalStorage();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns null when no draft exists', () => {
		expect(loadDraft()).toBeNull();
	});

	it('persists and retrieves a draft', () => {
		const draft = makeDraft();
		saveDraft(draft);
		expect(loadDraft()).toEqual(draft);
	});

	it('clears the draft', () => {
		saveDraft(makeDraft());
		clearDraft();
		expect(loadDraft()).toBeNull();
	});

	it('overwrites a previous draft', () => {
		saveDraft(makeDraft({ workoutId: 'old-workout' }));
		const newDraft = makeDraft({ workoutId: 'new-workout' });
		saveDraft(newDraft);
		expect(loadDraft()).toEqual(newDraft);
	});

	it('returns null for corrupt JSON', () => {
		localStorage.setItem('stronger_workout_draft', '{bad json');
		expect(loadDraft()).toBeNull();
	});

	it('returns null for a non-object value', () => {
		localStorage.setItem('stronger_workout_draft', '"just a string"');
		expect(loadDraft()).toBeNull();
	});

	it('returns null when workoutId is missing', () => {
		localStorage.setItem(
			'stronger_workout_draft',
			JSON.stringify({ startTime: '2026-01-01T00:00:00Z', results: [] }),
		);
		expect(loadDraft()).toBeNull();
	});

	it('returns null when results contains invalid set data', () => {
		localStorage.setItem(
			'stronger_workout_draft',
			JSON.stringify({
				workoutId: 'x',
				startTime: '2026-01-01T00:00:00Z',
				results: [[{ actualWeight: 100 }]], // missing fields
			}),
		);
		expect(loadDraft()).toBeNull();
	});

	it('accepts a draft with empty results array', () => {
		const draft = makeDraft({ results: [] });
		saveDraft(draft);
		expect(loadDraft()).toEqual(draft);
	});

	it('preserves multiple exercises with multiple sets', () => {
		const draft = makeDraft({
			results: [
				[
					{ actualWeight: 100, actualReps: 5, completed: true, actualSetType: 'warmup' },
					{ actualWeight: 200, actualReps: 3, completed: true, actualSetType: 'work' },
				],
				[
					{ actualWeight: 50, actualReps: 10, completed: false, actualSetType: 'backoff' },
				],
			],
		});
		saveDraft(draft);
		expect(loadDraft()).toEqual(draft);
	});

	it('isolates each user and unfinished workout without reading the legacy draft', () => {
		saveDraft(makeDraft());
		expect(loadDraft('alice', 'rss-bench')).toBeNull();
		saveDraft(makeDraft(), 'alice');
		saveDraft(makeDraft({ workoutId: 'squat' }), 'alice');
		saveDraft(makeDraft({ startTime: 'bob-start' }), 'bob');
		expect(loadDraft('alice', 'rss-bench')?.startTime).toBe(makeDraft().startTime);
		expect(loadDraft('bob', 'rss-bench')?.startTime).toBe('bob-start');
		clearDraft('alice', 'rss-bench');
		expect(loadDraft('alice', 'rss-bench')).toBeNull();
		expect(loadDraft('alice', 'squat')?.workoutId).toBe('squat');
		expect(loadDraft('bob', 'rss-bench')).not.toBeNull();
		expect(loadDraft()).not.toBeNull();
		expect(loadDraft('alice')).toBeNull();
	});

	it('preserves frozen snapshots when the workout view saves only results', () => {
		const snapshot: CycleSessionSnapshot = {
			id: 'session-1',
			workout: { id: 'rss-bench', name: 'Bench', favorite: false, exercises: [] },
			templates: [],
			progress: { workoutId: 'rss-bench', revision: 1, exercises: [] },
		};
		saveDraft(makeDraft({ snapshot }), 'alice');
		snapshot.workout.name = 'Changed elsewhere';
		saveDraft(makeDraft({ results: [] }), 'alice');
		expect(loadDraft('alice', 'rss-bench')?.snapshot?.workout.name).toBe('Bench');
		saveDraft(makeDraft({ startTime: 'new-session', results: [] }), 'alice');
		expect(loadDraft('alice', 'rss-bench')?.snapshot).toBeUndefined();
	});

	it('rejects corrupt snapshots rather than resuming a newly resolved prescription', () => {
		saveDraft(makeDraft({ snapshot: { id: 'bad' } as CycleSessionSnapshot }), 'alice');
		expect(loadDraft('alice', 'rss-bench')).toBeNull();
	});

	it('retains ad-hoc exercise/set structure with its results but never carries it into a new session', () => {
		const executionWorkout = { id: 'rss-bench', name: 'Bench', favorite: false, exercises: [
			{ liftId: 'added', name: 'Added', role: 'assistance' as const, sets: [
				{ setType: 'work' as const, weight: 10, minReps: 5, maxReps: 5, amrap: false },
			] },
		] };
		saveDraft(makeDraft({ executionWorkout }), 'alice');
		saveDraft(makeDraft({ results: [] }), 'alice');
		expect(loadDraft('alice', 'rss-bench')?.executionWorkout).toEqual(executionWorkout);
		saveDraft(makeDraft({ startTime: 'new-session' }), 'alice');
		expect(loadDraft('alice', 'rss-bench')?.executionWorkout).toBeUndefined();
	});
});
