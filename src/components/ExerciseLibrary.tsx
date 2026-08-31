import { useMemo } from 'react';
import type { LiftConfig, GearType } from '../model/index.js';
import { BicepsFlexed, Pencil, Plus } from 'lucide-react';

/** Generate a kebab-case ID from a name. */
export function nameToId(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

/** Default values for a new strength exercise. */
export const DEFAULT_STRENGTH_CONFIG: Omit<LiftConfig, 'id' | 'name'> = {
	topSetWeight: 45,
	backoffWeight: 45,
	increment: 5,
	minimumWeight: 45,
	roundingFactor: 5,
	warmupRoundingFactor: 5,
	barWeight: 45,
	gear: 'barbell' as GearType,
};

interface ExerciseLibraryProps {
	configs: LiftConfig[];
	onEdit: (exerciseId: string) => void;
	onNew: () => void;
}

function ExerciseCard({
	config,
	onEdit,
}: {
	config: LiftConfig;
	onEdit: (id: string) => void;
}) {
	return (
		<div className="exercise-card-wrapper">
			<button
				className="exercise-card"
				onClick={() => onEdit(config.id)}
			>
				<span className="strength-badge"><BicepsFlexed size={24} /></span>
				<div className="exercise-card-info">
					<span className="exercise-name">{config.name}</span>
					<span className="exercise-detail">
						{config.topSetWeight} lbs · {config.gear}
					</span>
				</div>
			</button>
			<button
				className="btn-edit-exercise"
				aria-label={`Edit ${config.name}`}
				onClick={() => onEdit(config.id)}
			>
				<Pencil size={16} />
			</button>
		</div>
	);
}

export function ExerciseLibrary({ configs, onEdit, onNew }: ExerciseLibraryProps) {
	const sorted = useMemo(() => {
		return [...configs].sort((a, b) => a.name.localeCompare(b.name));
	}, [configs]);

	return (
		<div className="exercise-library">
			<h2 className="exercise-library-title">Exercises</h2>

			<div className="exercise-list">
				{sorted.map((c) => (
					<ExerciseCard key={c.id} config={c} onEdit={onEdit} />
				))}

				<button className="btn-new-workout" onClick={onNew}>
					<Plus size={20} /> New Exercise
				</button>
			</div>
		</div>
	);
}
