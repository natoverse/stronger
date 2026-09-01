import { describe, expect, it } from 'vitest';
import type { WorkoutDefinition } from '../sample-workouts.js';
import {
	decodeSharedWorkout,
	encodeSharedWorkout,
	getImportedWorkoutName,
} from '../workout-sharing.js';

const workout: WorkoutDefinition = {
	id: 'source-id',
	name: 'Développé 💪',
	favorite: true,
	templates: [
		{
			liftId: 'press',
			name: 'Press',
			role: 'primary',
			sets: [
				{
					setType: 'warmup',
					percentage: 0.5,
					weightBasis: { kind: 'barWeight' },
					minReps: 5,
					maxReps: 5,
					amrap: false,
				},
				{
					setType: 'work',
					percentage: 1,
					weightBasis: { kind: 'crossReference', liftId: 'bench' },
					minReps: 3,
					maxReps: 5,
					amrap: true,
					comment: 'Keep 1 rep in reserve',
				},
				{
					setType: 'backoff',
					percentage: 1,
					weightBasis: { kind: 'fixed', weight: 45 },
					minReps: 8,
					maxReps: 10,
					amrap: false,
				},
				{
					setType: 'joker',
					percentage: 1,
					weightBasis: { kind: 'relative', reference: 'topSet', offset: 5 },
					minReps: 1,
					maxReps: 1,
					amrap: false,
				},
			],
		},
	],
};

describe('workout sharing', () => {
	it('round-trips a portable workout definition without its source ID', () => {
		const encoded = encodeSharedWorkout(workout);

		expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(decodeSharedWorkout(encoded)).toEqual({
			name: workout.name,
			favorite: true,
			templates: workout.templates,
		});
		expect(atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))).not.toContain('source-id');
	});

	it('rejects malformed, unsupported, and structurally invalid payloads', () => {
		expect(decodeSharedWorkout('not_base64!')).toBeNull();
		expect(decodeSharedWorkout(encodePayload({ v: 2, workout: {} }))).toBeNull();
		expect(decodeSharedWorkout(encodePayload({
			v: 1,
			workout: { name: 'Invalid', templates: [] },
		}))).toBeNull();
	});

	it('appends copy and a number until the imported name is unique', () => {
		expect(getImportedWorkoutName('Push', ['Pull'])).toBe('Push');
		expect(getImportedWorkoutName('Push', ['Push'])).toBe('Push copy');
		expect(getImportedWorkoutName('Push', ['Push', 'Push copy'])).toBe('Push copy 2');
	});
});

function encodePayload(payload: unknown): string {
	const bytes = new TextEncoder().encode(JSON.stringify(payload));
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
