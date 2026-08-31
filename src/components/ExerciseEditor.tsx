import { useState, useCallback, useMemo } from 'react';
import type { LiftConfig, GearType } from '../model/index.js';
import { ArrowLeft } from 'lucide-react';
import { nameToId, DEFAULT_STRENGTH_CONFIG } from './ExerciseLibrary.js';

const GEAR_OPTIONS: GearType[] = ['barbell', 'dumbbell', 'band', 'bodyweight', 'other'];

interface ExerciseEditorProps {
	existing?: LiftConfig;
	allConfigs: LiftConfig[];
	onSave: (config: LiftConfig) => void;
	onCancel: () => void;
}

export function ExerciseEditor({ existing, allConfigs, onSave, onCancel }: ExerciseEditorProps) {
	const isNew = !existing;

	const [name, setName] = useState(existing?.name ?? '');
	const [topSetWeight, setTopSetWeight] = useState(existing?.topSetWeight ?? DEFAULT_STRENGTH_CONFIG.topSetWeight);
	const [backoffWeight, setBackoffWeight] = useState(existing?.backoffWeight ?? DEFAULT_STRENGTH_CONFIG.backoffWeight);
	const [increment, setIncrement] = useState(existing?.increment ?? DEFAULT_STRENGTH_CONFIG.increment);
	const [minimumWeight, setMinimumWeight] = useState(existing?.minimumWeight ?? DEFAULT_STRENGTH_CONFIG.minimumWeight);
	const [roundingFactor, setRoundingFactor] = useState(existing?.roundingFactor ?? DEFAULT_STRENGTH_CONFIG.roundingFactor);
	const [warmupRoundingFactor, setWarmupRoundingFactor] = useState(existing?.warmupRoundingFactor ?? DEFAULT_STRENGTH_CONFIG.warmupRoundingFactor);
	const [barWeight, setBarWeight] = useState(existing?.barWeight ?? DEFAULT_STRENGTH_CONFIG.barWeight);
	const [gear, setGear] = useState<GearType>(existing?.gear ?? DEFAULT_STRENGTH_CONFIG.gear);
	const [saving, setSaving] = useState(false);

	const autoId = nameToId(name);
	const effectiveId = existing?.id ?? autoId;

	const nameConflict = useMemo(() => {
		if (!isNew) return false;
		return allConfigs.some((c) => c.id === autoId);
	}, [isNew, allConfigs, autoId]);

	const isValid = name.trim().length > 0 && !nameConflict;

	const handleSave = useCallback(() => {
		if (!isValid || saving) return;
		setSaving(true);

		const config: LiftConfig = {
			id: effectiveId,
			name: name.trim(),
			topSetWeight,
			backoffWeight,
			increment,
			minimumWeight,
			roundingFactor,
			warmupRoundingFactor,
			barWeight,
			gear,
		};
		onSave(config);
	}, [isValid, saving, effectiveId, name, topSetWeight, backoffWeight, increment, minimumWeight, roundingFactor, warmupRoundingFactor, barWeight, gear, onSave]);

	return (
		<div className="exercise-editor">
			<header className="workout-header">
				<button className="btn-back" onClick={onCancel}>
					<ArrowLeft size={20} /> Cancel
				</button>
				<h1 className="workout-title">
					{isNew ? 'New Exercise' : `Edit ${existing?.name ?? ''}`}
				</h1>
				<button
					className="btn-finish"
					disabled={!isValid || saving}
					onClick={handleSave}
				>
					{saving ? 'Saving…' : 'Save'}
				</button>
			</header>

			<div className="exercise-editor-form">
				{/* Name */}
				<label className="editor-field">
					<span className="editor-label">Name</span>
					<input
						className="editor-input"
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="e.g. Bench Press"
						disabled={!isNew}
						autoFocus={isNew}
					/>
					{nameConflict && (
						<span className="editor-error">An exercise with this name already exists</span>
					)}
				</label>

				{/* Weight parameters */}
				<label className="editor-field">
					<span className="editor-label">Top Set Weight (lbs)</span>
					<input
						className="editor-input"
						type="number"
						min="0"
						step="any"
						value={topSetWeight}
						onFocus={(e) => e.target.select()}
						onChange={(e) => setTopSetWeight(Number(e.target.value) || 0)}
					/>
				</label>

				<label className="editor-field">
					<span className="editor-label">Backoff Weight (lbs)</span>
					<input
						className="editor-input"
						type="number"
						min="0"
						step="any"
						value={backoffWeight}
						onFocus={(e) => e.target.select()}
						onChange={(e) => setBackoffWeight(Number(e.target.value) || 0)}
					/>
				</label>

				<label className="editor-field">
					<span className="editor-label">Increment (lbs)</span>
					<input
						className="editor-input"
						type="number"
						min="0"
						step="any"
						value={increment}
						onFocus={(e) => e.target.select()}
						onChange={(e) => setIncrement(Number(e.target.value) || 0)}
					/>
				</label>

				<label className="editor-field">
					<span className="editor-label">Minimum Weight (lbs)</span>
					<input
						className="editor-input"
						type="number"
						min="0"
						step="any"
						value={minimumWeight}
						onFocus={(e) => e.target.select()}
						onChange={(e) => setMinimumWeight(Number(e.target.value) || 0)}
					/>
				</label>

				<label className="editor-field">
					<span className="editor-label">Rounding Factor</span>
					<input
						className="editor-input"
						type="number"
						min="0"
						step="any"
						value={roundingFactor}
						onFocus={(e) => e.target.select()}
						onChange={(e) => setRoundingFactor(Number(e.target.value) || 0)}
					/>
				</label>

				<label className="editor-field">
					<span className="editor-label">Warmup Rounding Factor</span>
					<input
						className="editor-input"
						type="number"
						min="0"
						step="any"
						value={warmupRoundingFactor}
						onFocus={(e) => e.target.select()}
						onChange={(e) => setWarmupRoundingFactor(Number(e.target.value) || 0)}
					/>
				</label>

				<label className="editor-field">
					<span className="editor-label">Bar Weight (lbs)</span>
					<input
						className="editor-input"
						type="number"
						min="0"
						step="any"
						value={barWeight}
						onFocus={(e) => e.target.select()}
						onChange={(e) => setBarWeight(Number(e.target.value) || 0)}
					/>
				</label>

				<div className="editor-field">
					<span className="editor-label">Gear Type</span>
					<select
						className="editor-select"
						value={gear}
						onChange={(e) => setGear(e.target.value as GearType)}
					>
						{GEAR_OPTIONS.map((g) => (
							<option key={g} value={g}>
								{g.charAt(0).toUpperCase() + g.slice(1)}
							</option>
						))}
					</select>
				</div>
			</div>
		</div>
	);
}
