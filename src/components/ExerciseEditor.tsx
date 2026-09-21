import { useState, useCallback, useMemo } from 'react';
import type { LiftConfig, GearType } from '../model/index.js';
import { ArrowLeft } from 'lucide-react';
import { nameToId, DEFAULT_STRENGTH_CONFIG } from './ExerciseLibrary.js';
import { getTrainingMaxIncrement, trainingMaxFromOneRepMax } from '../model/training-max.js';

const GEAR_OPTIONS: GearType[] = ['barbell', 'dumbbell', 'band', 'bodyweight', 'other'];

export function parseTrainingMaxFields(trainingMax: string, trainingMaxIncrement: string) {
	const fields: Pick<LiftConfig, 'trainingMax' | 'trainingMaxIncrement'> = {};
	const errors: string[] = [];
	if (trainingMax.trim()) {
		const value = Number(trainingMax);
		if (!Number.isFinite(value) || value <= 0) errors.push('Training Max (TM) must be a finite weight greater than zero, or left blank.');
		else fields.trainingMax = value;
	}
	if (trainingMaxIncrement.trim()) {
		const value = Number(trainingMaxIncrement);
		if (!Number.isFinite(value) || value < 0) errors.push('TM increment must be a finite, nonnegative weight, or left blank. Enter 0 for no increase.');
		else fields.trainingMaxIncrement = value;
	}
	return { fields, errors };
}

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
	const [trainingMax, setTrainingMax] = useState(existing?.trainingMax === undefined ? '' : String(existing.trainingMax));
	const [trainingMaxIncrement, setTrainingMaxIncrement] = useState(existing?.trainingMaxIncrement === undefined ? '' : String(existing.trainingMaxIncrement));
	const [oneRepMax, setOneRepMax] = useState('');
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

	const trainingMaxFields = useMemo(() => parseTrainingMaxFields(trainingMax, trainingMaxIncrement), [trainingMax, trainingMaxIncrement]);
	const validOneRepMax = oneRepMax.trim() !== '' && Number.isFinite(Number(oneRepMax)) && Number(oneRepMax) > 0;
	const isValid = name.trim().length > 0 && !nameConflict && trainingMaxFields.errors.length === 0;

	const handleSave = useCallback(() => {
		if (!isValid || saving) return;
		setSaving(true);

		const config: LiftConfig = {
			id: effectiveId,
			name: name.trim(),
			topSetWeight,
			backoffWeight,
			increment,
			...trainingMaxFields.fields,
			minimumWeight,
			roundingFactor,
			warmupRoundingFactor,
			barWeight,
			gear,
		};
		onSave(config);
	}, [isValid, saving, effectiveId, name, topSetWeight, backoffWeight, increment, trainingMaxFields, minimumWeight, roundingFactor, warmupRoundingFactor, barWeight, gear, onSave]);

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
					<span className="editor-label">Training Max (TM, lbs) — optional</span>
					<input
						className="editor-input"
						type="text"
						inputMode="decimal"
						value={trainingMax}
						placeholder={`Default: ${topSetWeight} lbs (top set)`}
						aria-describedby="training-max-help training-max-errors"
						onFocus={(e) => e.target.select()}
						onChange={(e) => setTrainingMax(e.target.value)}
					/>
				</label>
				<label className="editor-field">
					<span className="editor-label">TM Increment (lbs) — optional</span>
					<input
						className="editor-input"
						type="text"
						inputMode="decimal"
						value={trainingMaxIncrement}
						placeholder={`Default: ${getTrainingMaxIncrement({ id: effectiveId, name })} lbs`}
						aria-describedby="training-max-help training-max-errors"
						onFocus={(e) => e.target.select()}
						onChange={(e) => setTrainingMaxIncrement(e.target.value)}
					/>
				</label>
				<p id="training-max-help" className="cycle-editor-hint">
					Leave TM blank to use top-set weight. Leave TM increment blank to use
					10 lbs for squat/deadlift, 5 lbs for bench/press, or 1 lb for other exercises.
					Explicit values override these defaults; a TM increment of 0 means no increase.
					The normal increment above is unchanged.
				</p>
				<div id="training-max-errors" role="alert">
					{trainingMaxFields.errors.map((error) => <p className="editor-error" key={error}>{error}</p>)}
				</div>
				<details className="tm-calculator">
					<summary>Set starting TM from 1RM (90%)</summary>
					<label className="editor-field">
						<span className="editor-label">One-rep max (lbs)</span>
						<input
							className="editor-input"
							type="text"
							inputMode="decimal"
							value={oneRepMax}
							onChange={(event) => setOneRepMax(event.target.value)}
						/>
					</label>
					<button
						type="button"
						className="btn-secondary"
						disabled={!validOneRepMax}
						onClick={() => setTrainingMax(String(trainingMaxFromOneRepMax(Number(oneRepMax))))}
					>
						Use 90% as TM
					</button>
					{oneRepMax.trim() && !validOneRepMax && <p className="editor-error" role="alert">Enter a positive, finite one-rep max.</p>}
					<p className="cycle-editor-hint">
						Classic 5/3/1 starts with TM = 90% of 1RM. Set percentages then use TM,
						without another 90% reduction. This fills the TM field; Save applies it.
						Top-set weight is not assumed to be your 1RM.
					</p>
				</details>
				<p className="cycle-editor-hint">
					Shared input changes apply when each exercise begins its next iteration. Pending prescriptions and unfinished sessions stay frozen.
				</p>

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
