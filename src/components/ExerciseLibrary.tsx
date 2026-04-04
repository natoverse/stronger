import { useMemo, useState } from 'react';
import type { LiftConfig, GearType } from '../model/index.js';
import { Activity, BicepsFlexed, Pencil, Plus, ChevronDown } from 'lucide-react';

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
	barWeight: 45,
	gear: 'barbell' as GearType,
};

/** Check whether a LiftConfig represents a cardio exercise.
 * All exercises in the Exercises sheet are strength exercises —
 * cardio is a workout-level category, not an exercise-level one.
 */
export function isCardioExercise(_config: LiftConfig): boolean {
	return false;
}

interface ExerciseLibraryProps {
	configs: LiftConfig[];
	onEdit: (exerciseId: string) => void;
	onNew: () => void;
}

function ExerciseCard({
	config,
	onEdit,
	cardio,
}: {
	config: LiftConfig;
	onEdit: (id: string) => void;
	cardio: boolean;
}) {
	return (
		<div className="exercise-card-wrapper">
			<button
				className={`exercise-card${cardio ? ' exercise-card-cardio' : ''}`}
				onClick={() => onEdit(config.id)}
			>
				{cardio ? (
					<span className="cardio-badge"><Activity size={24} /></span>
				) : (
					<span className="strength-badge"><BicepsFlexed size={24} /></span>
				)}
				<div className="exercise-card-info">
					<span className="exercise-name">{config.name}</span>
					{!cardio && (
						<span className="exercise-detail">
							{config.topSetWeight} lbs · {config.gear}
						</span>
					)}
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
	const { strength, cardio } = useMemo(() => {
		const strength: LiftConfig[] = [];
		const cardio: LiftConfig[] = [];
		for (const c of configs) {
			if (isCardioExercise(c)) {
				cardio.push(c);
			} else {
				strength.push(c);
			}
		}
		// Sort alphabetically
		strength.sort((a, b) => a.name.localeCompare(b.name));
		cardio.sort((a, b) => a.name.localeCompare(b.name));
		return { strength, cardio };
	}, [configs]);

	const [cardioOpen, setCardioOpen] = useState(false);

	return (
		<div className="exercise-library">
			<h2 className="exercise-library-title">Exercises</h2>

			<div className="exercise-list">
				{strength.map((c) => (
					<ExerciseCard key={c.id} config={c} onEdit={onEdit} cardio={false} />
				))}

				{cardio.length > 0 && (
					<>
						<button
							className="btn-more-toggle"
							onClick={() => setCardioOpen(!cardioOpen)}
							aria-expanded={cardioOpen}
						>
							Cardio ({cardio.length})
							<ChevronDown size={16} className={`more-chevron${cardioOpen ? ' more-chevron-open' : ''}`} />
						</button>
						{cardioOpen && cardio.map((c) => (
							<ExerciseCard key={c.id} config={c} onEdit={onEdit} cardio={true} />
						))}
					</>
				)}

				<button className="btn-new-workout" onClick={onNew}>
					<Plus size={20} /> New Exercise
				</button>
			</div>
		</div>
	);
}
