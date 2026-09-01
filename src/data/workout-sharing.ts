import type { ExerciseTemplate, SetTemplate, WeightBasis } from '../model/index.js';
import type { WorkoutDefinition } from './sample-workouts.js';

export interface SharedWorkout {
	name: string;
	favorite?: boolean;
	templates: ExerciseTemplate[];
}

interface SharedWorkoutPayload {
	v: 1;
	workout: SharedWorkout;
}

export function encodeSharedWorkout(definition: WorkoutDefinition): string {
	const payload: SharedWorkoutPayload = {
		v: 1,
		workout: {
			name: definition.name,
			...(definition.favorite === undefined ? {} : { favorite: definition.favorite }),
			templates: definition.templates,
		},
	};
	const bytes = new TextEncoder().encode(JSON.stringify(payload));
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

export function decodeSharedWorkout(data: string): SharedWorkout | null {
	try {
		if (!data || !/^[A-Za-z0-9_-]+$/.test(data)) return null;
		const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
		const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
		const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
		const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
		if (!isRecord(parsed) || parsed.v !== 1 || !isSharedWorkout(parsed.workout)) return null;
		return parsed.workout;
	} catch {
		return null;
	}
}

export function getImportedWorkoutName(name: string, existingNames: string[]): string {
	const names = new Set(existingNames);
	if (!names.has(name)) return name;
	const copiedName = `${name} copy`;
	if (!names.has(copiedName)) return copiedName;
	let suffix = 2;
	while (names.has(`${copiedName} ${suffix}`)) suffix += 1;
	return `${copiedName} ${suffix}`;
}

function isSharedWorkout(value: unknown): value is SharedWorkout {
	return isRecord(value)
		&& typeof value.name === 'string'
		&& value.name.trim().length > 0
		&& (value.favorite === undefined || typeof value.favorite === 'boolean')
		&& Array.isArray(value.templates)
		&& value.templates.length > 0
		&& value.templates.every(isExerciseTemplate);
}

function isExerciseTemplate(value: unknown): value is ExerciseTemplate {
	return isRecord(value)
		&& typeof value.liftId === 'string'
		&& value.liftId.trim().length > 0
		&& typeof value.name === 'string'
		&& value.name.trim().length > 0
		&& (value.role === 'primary' || value.role === 'secondary' || value.role === 'assistance')
		&& Array.isArray(value.sets)
		&& value.sets.length > 0
		&& value.sets.every(isSetTemplate);
}

function isSetTemplate(value: unknown): value is SetTemplate {
	return isRecord(value)
		&& (value.setType === 'warmup' || value.setType === 'work' || value.setType === 'backoff' || value.setType === 'joker')
		&& isNonNegativeNumber(value.percentage)
		&& isWeightBasis(value.weightBasis)
		&& isNonNegativeNumber(value.minReps)
		&& isNonNegativeNumber(value.maxReps)
		&& value.maxReps >= value.minReps
		&& typeof value.amrap === 'boolean'
		&& (value.comment === undefined || typeof value.comment === 'string');
}

function isWeightBasis(value: unknown): value is WeightBasis {
	if (!isRecord(value) || typeof value.kind !== 'string') return false;
	if (value.kind === 'topSet' || value.kind === 'backoff' || value.kind === 'barWeight') return true;
	if (value.kind === 'crossReference') {
		return typeof value.liftId === 'string' && value.liftId.trim().length > 0;
	}
	if (value.kind === 'fixed') return isNonNegativeNumber(value.weight);
	return value.kind === 'relative'
		&& (value.reference === 'topSet' || value.reference === 'backoff')
		&& typeof value.offset === 'number'
		&& Number.isFinite(value.offset);
}

function isNonNegativeNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
