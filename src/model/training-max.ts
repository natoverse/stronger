import type { LiftConfig } from './types.js';

export function getTrainingMax(config: Pick<LiftConfig, 'trainingMax' | 'topSetWeight'>): number {
	return config.trainingMax ?? config.topSetWeight;
}

export function getTrainingMaxIncrement(config: Pick<LiftConfig, 'id' | 'name' | 'trainingMaxIncrement'>): number {
	if (config.trainingMaxIncrement != null) return config.trainingMaxIncrement;
	const names = [config.id, config.name].map((value) => value.trim().toLowerCase().replace(/[\s_]+/g, '-'));
	if (names.some((value) => value === 'squat' || value === 'deadlift')) return 10;
	if (names.some((value) => ['bench', 'bench-press', 'press', 'overhead-press'].includes(value))) return 5;
	return 1;
}
