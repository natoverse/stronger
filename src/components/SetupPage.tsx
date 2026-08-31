import { useState, useCallback } from 'react';
import type { LiftConfig } from '../model/index.js';
import { roundToNearest } from '../model/index.js';
import exercisesJson from '../../lib/exercises.json';

/** All lift configs sourced from the JSON library. */
const libraryDefaults: LiftConfig[] = exercisesJson as LiftConfig[];

/** The four barbell lift IDs shown on the setup page. */
const BARBELL_LIFT_IDS = ['squat', 'bench', 'press', 'deadlift'] as const;

/** Barbell lifts pulled from the JSON library for display. */
const barbellDefaults = libraryDefaults.filter((c) =>
  (BARBELL_LIFT_IDS as readonly string[]).includes(c.id),
);

/** Backoff weight = 85% of top-set, rounded to the lift's rounding factor. */
function deriveBackoff(topSetWeight: number, roundingFactor: number): number {
  return roundToNearest(topSetWeight * 0.85, roundingFactor);
}

interface Props {
  /** Called with the final configs (all lifts) when the user confirms. */
  onConfirm: (configs: LiftConfig[]) => void;
}

export function SetupPage({ onConfirm }: Props) {

  // Local state: top-set weight per barbell lift
  const [weights, setWeights] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const c of barbellDefaults) {
      init[c.id] = c.topSetWeight;
    }
    return init;
  });

  const handleWeightChange = useCallback(
    (liftId: string, value: string) => {
      const num = parseFloat(value);
      setWeights((prev) => ({ ...prev, [liftId]: isNaN(num) ? 0 : num }));
    },
    [],
  );

  const handleConfirm = useCallback(() => {
    // Build the final configs: barbell lifts use user-entered weights,
    // everything else uses the library defaults unchanged.
    const configs = libraryDefaults.map((c) => {
      if (!(BARBELL_LIFT_IDS as readonly string[]).includes(c.id)) return c;
      const topSetWeight = weights[c.id] ?? c.topSetWeight;
      const backoffWeight = deriveBackoff(topSetWeight, c.roundingFactor);
      return { ...c, topSetWeight, backoffWeight };
    });
    onConfirm(configs);
  }, [weights, onConfirm]);

  return (
    <div className="setup-page">
      <h1 className="setup-title">Set Your Working Weights</h1>
      <p className="setup-subtitle">
        Enter your current top-set weight for each lift. You can always adjust
        these later.
      </p>

      <div className="setup-list">
        {barbellDefaults.map((lift) => {
          const topSet = weights[lift.id] ?? lift.topSetWeight;
          const backoff = deriveBackoff(topSet, lift.roundingFactor);
          return (
            <div className="setup-card" key={lift.id}>
              <div className="setup-lift-name">{lift.name}</div>
              <div className="setup-field">
                <label className="setup-label" htmlFor={`setup-${lift.id}`}>
                  Top set
                </label>
                <div className="setup-input-row">
                  <input
                    id={`setup-${lift.id}`}
                    className="setup-input"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={lift.roundingFactor}
                    value={topSet}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => handleWeightChange(lift.id, e.target.value)}
                  />
                  <span className="setup-unit">lbs</span>
                </div>
              </div>
              <div className="setup-derived">
                Backoff: {backoff} lbs
              </div>
            </div>
          );
        })}
      </div>

      <div className="setup-actions">
        <button className="btn-primary setup-confirm" onClick={handleConfirm}>
          Start Training
        </button>
      </div>
    </div>
  );
}
