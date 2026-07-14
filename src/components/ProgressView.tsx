import { useState, useMemo, useEffect } from 'react';
import type { ParsedLogRow } from '../google/sheets.js';
import type { LiftGoal } from '../google/sheets.js';
import type { ProgressMetric, ProgressDataPoint } from '../model/progress.js';
import {
  getLiftsWithData,
  buildProgressData,
  filterDips,
} from '../model/progress.js';
import type { StravaTimeRange } from '../model/strava.js';
import { useChartTooltip } from '../hooks/useChartTooltip.js';
import { Target } from 'lucide-react';

interface Props {
  logRows: ParsedLogRow[];
  liftGoals?: LiftGoal[];
  onLiftGoalChange?: (liftId: string, weight: number | null) => void;
  dipThresholdPercent?: number;
  skipDips?: boolean;
  range: StravaTimeRange;
}

const METRIC_LABELS: Record<ProgressMetric, string> = {
  volume: 'Total Volume',
  heaviest: 'Heaviest Weight',
  e1rm: 'Est. 1RM',
};

/** The four main barbell lifts shown prominently at the top. */
const BIG_FOUR = ['squat', 'bench-press', 'deadlift', 'overhead-press'] as const;

/**
 * Compute the minimum data-point value across *all* time for a given lift+metric.
 * Used as a stable y-axis floor so charts don't jump when toggling filters,
 * while adapting to the user's actual strength level.
 */
function allTimeMinForLift(
  logRows: ParsedLogRow[],
  liftId: string,
  metric: ProgressMetric,
): number | undefined {
  const all = buildProgressData(logRows, liftId, metric, 'all');
  if (all.length === 0) return undefined;
  return Math.min(...all.map((p) => p.value));
}

const BIG_FOUR_LABELS: Record<string, string> = {
  squat: 'Squat',
  'bench-press': 'Bench Press',
  deadlift: 'Deadlift',
  'overhead-press': 'Overhead Press',
};

/* ------------------------------------------------------------------ */
/*  SVG chart constants                                                */
/* ------------------------------------------------------------------ */

const CHART_PADDING = { top: 20, right: 16, bottom: 40, left: 52 };
const CHART_HEIGHT = 220;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ProgressView({
  logRows,
  liftGoals,
  onLiftGoalChange,
  dipThresholdPercent = 10,
  skipDips = true,
  range,
}: Props) {
  const dipThreshold = dipThresholdPercent / 100;
  const lifts = useMemo(() => getLiftsWithData(logRows), [logRows]);

  // Separate big-4 lifts (that have data) from the rest
  const big4Set = new Set<string>(BIG_FOUR);
  const big4Lifts = BIG_FOUR.filter((id) => lifts.some((l) => l.liftId === id));
  const otherLifts = lifts.filter((l) => !big4Set.has(l.liftId));

  const [selectedLift, setSelectedLift] = useState<string>(otherLifts[0]?.liftId ?? '');
  const [metric, setMetric] = useState<ProgressMetric>('e1rm');

  // Auto-select the first "other" lift if the current selection becomes invalid
  useEffect(() => {
    if (otherLifts.length > 0 && !otherLifts.some((l) => l.liftId === selectedLift)) {
      setSelectedLift(otherLifts[0].liftId);
    }
  }, [otherLifts, selectedLift]);

  return (
    <div className="progress-view">
      {lifts.length === 0 ? (
        <p className="progress-empty">No logged strength data yet. Complete a workout to see progress charts.</p>
      ) : (
        <>
          {/* Strength section */}
          <h3 className="strava-section-title">Strength</h3>

          {/* Metric toggle */}
          <div className="progress-toggle-group">
            {(Object.keys(METRIC_LABELS) as ProgressMetric[]).map((m) => (
              <button
                key={m}
                className={`progress-toggle${metric === m ? ' active' : ''}`}
                onClick={() => setMetric(m)}
              >
                {METRIC_LABELS[m]}
              </button>
            ))}
          </div>

          {/* Big 4 charts */}
          {big4Lifts.length > 0 && (
            <div className="progress-big4">
              {big4Lifts.map((liftId) => (
                <Big4Chart
                  key={liftId}
                  liftId={liftId}
                  label={BIG_FOUR_LABELS[liftId] ?? liftId}
                  logRows={logRows}
                  metric={metric}
                  range={range}
                  skipDips={skipDips}
                  dipThreshold={dipThreshold}
                  goalWeight={liftGoals?.find((g) => g.liftId === liftId)?.weight}
                  onGoalChange={onLiftGoalChange}
                />
              ))}
            </div>
          )}

          {/* Remaining exercises dropdown */}
          {otherLifts.length > 0 && (
            <>
              <div className="progress-controls">
                <select
                  className="progress-select"
                  value={selectedLift}
                  onChange={(e) => setSelectedLift(e.target.value)}
                >
                  {otherLifts.map((l) => (
                    <option key={l.liftId} value={l.liftId}>
                      {l.exerciseName}
                    </option>
                  ))}
                </select>
              </div>

              <SelectedLiftChart
                liftId={selectedLift}
                logRows={logRows}
                metric={metric}
                range={range}
                skipDips={skipDips}
                dipThreshold={dipThreshold}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Big-4 lift chart wrapper                                           */
/* ------------------------------------------------------------------ */

function Big4Chart({
  liftId,
  label,
  logRows,
  metric,
  range,
  skipDips,
  dipThreshold,
  goalWeight,
  onGoalChange,
}: {
  liftId: string;
  label: string;
  logRows: ParsedLogRow[];
  metric: ProgressMetric;
  range: StravaTimeRange;
  skipDips: boolean;
  dipThreshold: number;
  goalWeight?: number;
  onGoalChange?: (liftId: string, weight: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [goalInput, setGoalInput] = useState('');

  const data = useMemo(() => {
    const raw = buildProgressData(logRows, liftId, metric, range);
    return skipDips ? filterDips(raw, dipThreshold) : raw;
  }, [logRows, liftId, metric, range, skipDips, dipThreshold]);

  const stableYMin = useMemo(
    () => allTimeMinForLift(logRows, liftId, metric),
    [logRows, liftId, metric],
  );

  // Only show goal on heaviest and e1rm charts
  const showGoal = goalWeight !== undefined && metric !== 'volume';

  return (
    <div className="strava-chart-card">
      <div className="strava-chart-header">
        <h3 className="strava-chart-label">{label}</h3>
        {onGoalChange && metric !== 'volume' && (
          <button
            className="strava-goal-btn"
            onClick={() => {
              setGoalInput(goalWeight !== undefined ? String(goalWeight) : '');
              setEditing(!editing);
            }}
            title="Set 1RM goal"
          >
            <Target size={14} />
          </button>
        )}
      </div>
      {editing && onGoalChange && (
        <div className="strava-goal-input-row">
          <input
            className="strava-goal-input"
            type="number"
            placeholder="Goal weight"
            value={goalInput}
            onChange={(e) => setGoalInput(e.target.value)}
          />
          <button
            className="strava-goal-save"
            onClick={() => {
              const v = Number(goalInput);
              onGoalChange(liftId, isFinite(v) && v > 0 ? v : null);
              setEditing(false);
            }}
          >
            Set
          </button>
        </div>
      )}
      {data.length === 0 ? (
        <p className="progress-empty">No data yet.</p>
      ) : (
        <ProgressChart data={data} metric={metric} stableYMin={stableYMin} goalWeight={showGoal ? goalWeight : undefined} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Selected-lift chart wrapper                                        */
/* ------------------------------------------------------------------ */

function SelectedLiftChart({
  liftId,
  logRows,
  metric,
  range,
  skipDips,
  dipThreshold,
}: {
  liftId: string;
  logRows: ParsedLogRow[];
  metric: ProgressMetric;
  range: StravaTimeRange;
  skipDips: boolean;
  dipThreshold: number;
}) {
  const data = useMemo(() => {
    if (!liftId) return [];
    const raw = buildProgressData(logRows, liftId, metric, range);
    return skipDips ? filterDips(raw, dipThreshold) : raw;
  }, [logRows, liftId, metric, range, skipDips, dipThreshold]);

  const stableYMin = useMemo(
    () => liftId ? allTimeMinForLift(logRows, liftId, metric) : undefined,
    [logRows, liftId, metric],
  );

  if (data.length === 0) {
    return <p className="progress-empty">No data for this selection.</p>;
  }
  return (
    <div className="strava-chart-card">
      <ProgressChart data={data} metric={metric} stableYMin={stableYMin} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SVG Line Chart                                                     */
/* ------------------------------------------------------------------ */

function ProgressChart({
  data,
  metric,
  stableYMin,
  goalWeight,
}: {
  data: ProgressDataPoint[];
  metric: ProgressMetric;
  stableYMin?: number;
  goalWeight?: number;
}) {
  // We use a viewBox so the chart is responsive
  const viewBoxWidth = 400;
  const plotW = viewBoxWidth - CHART_PADDING.left - CHART_PADDING.right;
  const plotH = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;

  const values = data.map((d) => d.value);
  const maxVal = Math.max(...values);
  const minVal = Math.min(...values);
  // Use the all-time minimum for this lift+metric as a stable floor so the
  // y-axis doesn't jump when toggling time-range or skip-dips filters.
  // Fall back to the visible data minimum if no stable floor is provided.
  const yMin = stableYMin !== undefined ? Math.min(stableYMin, minVal) : minVal;
  // Extend yMax to include the goal weight so the goal line is always visible
  const effectiveMax = goalWeight !== undefined ? Math.max(maxVal, goalWeight) : maxVal;
  const yMax = Math.ceil(effectiveMax / 10) * 10 || 10;
  const yRange = yMax - yMin || 1;

  const xScale = (i: number) =>
    CHART_PADDING.left + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const yScale = (v: number) =>
    CHART_PADDING.top + plotH - ((v - yMin) / yRange) * plotH;

  // Build polyline points
  const points = data.map((d, i) => `${xScale(i)},${yScale(d.value)}`).join(' ');

  // Y-axis ticks (4–5 nice ticks)
  const yTicks = niceTicksFor(yMin, yMax, 5);

  // X-axis: show a few evenly spaced date labels
  const xLabelCount = Math.min(data.length, 5);
  const xLabelIndices: number[] = [];
  if (data.length <= xLabelCount) {
    for (let i = 0; i < data.length; i++) xLabelIndices.push(i);
  } else {
    for (let i = 0; i < xLabelCount; i++) {
      xLabelIndices.push(Math.round((i / (xLabelCount - 1)) * (data.length - 1)));
    }
  }

  const yUnit = metric === 'volume' ? 'vol' : '';

  // Tooltip support
  const xPositions = useMemo(
    () => data.map((_, i) => xScale(i)),
    // xScale depends on data.length and plotW (which is constant), so
    // data.length is sufficient as a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.length, plotW],
  );
  const { activeIndex, svgRef, containerHandlers } = useChartTooltip(xPositions, viewBoxWidth);
  const active = activeIndex !== null ? data[activeIndex] : null;

  return (
    <div className="strava-chart-container" {...containerHandlers}>
      <svg
        ref={svgRef}
        className="strava-chart-svg"
        viewBox={`0 0 ${viewBoxWidth} ${CHART_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Grid lines */}
        {yTicks.map((tick) => (
          <line
            key={tick}
            x1={CHART_PADDING.left}
            y1={yScale(tick)}
            x2={viewBoxWidth - CHART_PADDING.right}
            y2={yScale(tick)}
            className="strava-grid-line"
          />
        ))}

        {/* Y-axis labels */}
        {yTicks.map((tick) => (
          <text
            key={tick}
            x={CHART_PADDING.left - 6}
            y={yScale(tick)}
            className="strava-axis-label"
            textAnchor="end"
            dominantBaseline="middle"
          >
            {formatValue(tick)}
          </text>
        ))}

        {/* X-axis labels */}
        {xLabelIndices.map((i) => (
          <text
            key={i}
            x={xScale(i)}
            y={CHART_HEIGHT - 6}
            className="strava-axis-label"
            textAnchor="middle"
          >
            {formatDate(data[i].date)}
          </text>
        ))}

        {/* Area fill under line */}
        <polygon
          points={`${xScale(0)},${yScale(yMin)} ${points} ${xScale(data.length - 1)},${yScale(yMin)}`}
          className="progress-area"
        />

        {/* Line */}
        <polyline points={points} className="progress-line" />

        {/* Data points */}
        {data.map((d, i) => (
          <circle
            key={i}
            cx={xScale(i)}
            cy={yScale(d.value)}
            r={i === activeIndex ? (data.length > 30 ? 3.5 : 5) : (data.length > 30 ? 2 : 3)}
            className={`progress-dot${i === activeIndex ? ' active' : ''}`}
          />
        ))}

        {/* Goal line (horizontal dashed) */}
        {goalWeight !== undefined && (
          <line
            x1={CHART_PADDING.left}
            y1={yScale(goalWeight)}
            x2={viewBoxWidth - CHART_PADDING.right}
            y2={yScale(goalWeight)}
            className="strava-goal-line"
          />
        )}

        {/* Tooltip crosshair */}
        {active != null && activeIndex !== null && (
          <line
            x1={xScale(activeIndex)}
            y1={CHART_PADDING.top}
            x2={xScale(activeIndex)}
            y2={CHART_PADDING.top + plotH}
            className="chart-crosshair"
          />
        )}
      </svg>
      <div className="progress-unit">
        {yUnit ? `${yUnit} · ` : ''}{formatValue(maxVal)}{goalWeight !== undefined ? ` / ${formatValue(goalWeight)}` : ''}
      </div>

      {/* Tooltip label */}
      {active != null && activeIndex !== null && (
        <div
          className="chart-tooltip"
          style={{
            left: `${(xScale(activeIndex) / viewBoxWidth) * 100}%`,
          }}
        >
          <span className="chart-tooltip-value">{active.label || formatValue(active.value)}</span>
          <span className="chart-tooltip-date">{formatDate(active.date)}</span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDate(iso: string): string {
  const parts = iso.split('-');
  if (parts.length < 3) return iso;
  const year = parts[0].slice(2); // 2-digit year
  return `${parseInt(parts[1])}/${parseInt(parts[2])}/${year}`;
}

function formatValue(v: number): string {
  if (v >= 10000) return `${(v / 1000).toFixed(0)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(1);
}

/**
 * Compute "nice" tick values for a y-axis given min/max and desired count.
 */
function niceTicksFor(min: number, max: number, count: number): number[] {
  const range = max - min;
  if (range === 0) return [min];

  const rawStep = range / (count - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / magnitude;

  let niceStep: number;
  if (residual <= 1.5) niceStep = magnitude;
  else if (residual <= 3.5) niceStep = 2.5 * magnitude;
  else if (residual <= 7.5) niceStep = 5 * magnitude;
  else niceStep = 10 * magnitude;

  const niceMin = Math.floor(min / niceStep) * niceStep;
  const niceMax = Math.ceil(max / niceStep) * niceStep;

  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + niceStep * 0.01; v += niceStep) {
    ticks.push(Math.round(v * 1e6) / 1e6); // clean floating point
  }
  return ticks;
}
