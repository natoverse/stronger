import { useMemo, useState } from 'react';
import type { WithingsMeasurement } from '../model/types.js';
import type {
  WithingsMetric,
  WithingsGoal,
  WithingsTimeRange,
  WithingsAggregation,
  MetricTrendData,
} from '../model/withings.js';
import {
  filterMeasurements,
  buildMetricTrendData,
  filterTrendDips,
  formatMetricValue,
  WITHINGS_METRICS,
  METRIC_LABELS,
  METRIC_UNITS,
  METRIC_LOWER_IS_BETTER,
} from '../model/withings.js';
import { Target } from 'lucide-react';
import { useChartTooltip } from '../hooks/useChartTooltip.js';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface Props {
  measurements: WithingsMeasurement[];
  goals: WithingsGoal[];
  dipThresholdPercent?: number;
  skipDips?: boolean;
  range: WithingsTimeRange;
  aggregation: WithingsAggregation;
  onGoalChange?: (metric: WithingsMetric, value: number | null) => void;
  embedded?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CHART_HEIGHT = 220;
const CHART_PADDING = { top: 16, right: 20, bottom: 32, left: 52 };

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function WithingsView({
  measurements,
  goals,
  dipThresholdPercent = 5,
  skipDips = true,
  range,
  aggregation,
  onGoalChange,
  embedded = false,
}: Props) {
  const dipThreshold = dipThresholdPercent / 100;

  const today = useMemo(() => new Date(), []);

  const filtered = useMemo(
    () => filterMeasurements(measurements, range, today),
    [measurements, range, today],
  );

  const goalMap = useMemo(() => {
    const m = new Map<WithingsMetric, number>();
    for (const g of goals) m.set(g.metric, g.value);
    return m;
  }, [goals]);

  // Only chart metrics that have at least one measurement in the full dataset.
  const availableMetrics = useMemo(
    () =>
      WITHINGS_METRICS.filter((metric) =>
        measurements.some((m) => {
          const v = m[metric];
          return typeof v === 'number' && Number.isFinite(v);
        }),
      ),
    [measurements],
  );

  const charts = useMemo(
    () =>
      availableMetrics.map((metric) =>
        buildMetricTrendData(filtered, metric, range, goalMap.get(metric) ?? null, today, aggregation),
      ),
    [availableMetrics, filtered, range, goalMap, today, aggregation],
  );

  if (measurements.length === 0) {
    return (
      <div className={embedded ? 'strava-subview' : 'strava-view'}>
        <p className="strava-empty">
          No Withings data yet. Set up sync to see body-composition trends.
        </p>
      </div>
    );
  }

  const anyData = charts.some((c) => c.points.some((p) => p.value !== null));

  return (
    <div className={embedded ? 'strava-subview' : 'strava-view'}>

      {anyData ? (
        charts.map((data) => (
          <MetricTrendChart
            key={data.metric}
            data={data}
            goal={goalMap.get(data.metric) ?? null}
            skipDips={skipDips}
            dipThreshold={dipThreshold}
            onGoalChange={onGoalChange}
          />
        ))
      ) : (
        <p className="strava-empty">No data for the selected time range.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MetricTrendChart — single-series trend line                        */
/* ------------------------------------------------------------------ */

function MetricTrendChart({
  data,
  goal,
  skipDips,
  dipThreshold,
  onGoalChange,
}: {
  data: MetricTrendData;
  goal: number | null;
  skipDips: boolean;
  dipThreshold: number;
  onGoalChange?: (metric: WithingsMetric, value: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [goalInput, setGoalInput] = useState(goal !== null ? String(goal) : '');

  const handleGoalSubmit = () => {
    const val = parseFloat(goalInput);
    if (onGoalChange) {
      onGoalChange(data.metric, isNaN(val) || val <= 0 ? null : val);
    }
    setEditing(false);
  };

  const viewBoxWidth = 400;
  const plotW = viewBoxWidth - CHART_PADDING.left - CHART_PADDING.right;
  const plotH = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;

  const { points: rawPoints } = data;
  const points = useMemo(
    () =>
      skipDips ? filterTrendDips(rawPoints, METRIC_LOWER_IS_BETTER[data.metric], dipThreshold) : rawPoints,
    [rawPoints, skipDips, data.metric, dipThreshold],
  );
  const n = points.length;

  const optimalRange = data.metric === 'fatFreeMass' ? { min: 65, max: 66 } : null;
  // Y-axis domain: pad the observed min/max (and goal) by ~5% so the trend
  // line doesn't hug the chart edges. Body composition varies in a narrow band.
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const withGoal = goal !== null ? [...values, goal] : values;
  const dataMin = withGoal.length > 0 ? Math.min(...withGoal) : 0;
  const dataMax = withGoal.length > 0 ? Math.max(...withGoal) : 1;
  const pad = (dataMax - dataMin) * 0.1 || Math.max(dataMax * 0.02, 0.5);
  const yMin = Math.min(dataMin - pad, optimalRange?.min ?? Infinity);
  const yMax = Math.max(dataMax + pad, optimalRange?.max ?? -Infinity);

  const xCenter = (i: number) =>
    CHART_PADDING.left + (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const yVal = (v: number) =>
    CHART_PADDING.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  const ticks = niceTicksFor(yMin, yMax, 4);

  // X-axis labels — show a subset to avoid crowding
  const maxLabels = Math.min(n, 8);
  const xLabelIndices: number[] = [];
  if (n <= maxLabels) {
    for (let i = 0; i < n; i++) xLabelIndices.push(i);
  } else {
    for (let i = 0; i < maxLabels; i++) {
      xLabelIndices.push(Math.round((i / (maxLabels - 1)) * (n - 1)));
    }
  }

  // Build a single continuous, lightly-smoothed line through every point
  // that has a value, connecting straight across any missing buckets
  // (whether they're genuine gaps or dip-filtered) rather than breaking
  // the line into disconnected segments.
  const lineCoords = points
    .map((p, i) => (p.value === null ? null : { x: xCenter(i), y: yVal(p.value) }))
    .filter((c): c is { x: number; y: number } => c !== null);
  const linePath = buildSmoothPath(lineCoords);

  const xPositions = useMemo(
    () => Array.from({ length: n }, (_, i) => xCenter(i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [n, plotW],
  );
  const { activeIndex, svgRef, containerHandlers } = useChartTooltip(xPositions, viewBoxWidth);

  const deltaClass =
    data.delta === null || data.delta === 0
      ? ''
      : (data.delta < 0) === METRIC_LOWER_IS_BETTER[data.metric]
        ? ' good'
        : ' bad';
  const deltaText =
    data.delta === null
      ? null
      : `${data.delta > 0 ? '+' : ''}${formatMetricValue(data.delta, data.metric)}`;

  return (
    <div className="strava-chart-card">
      <div className="strava-chart-header">
        <h3 className="strava-chart-label">
          {METRIC_LABELS[data.metric]}
          {data.latest !== null && (
            <span className="strava-chart-total">
              {formatMetricValue(data.latest, data.metric)} {METRIC_UNITS[data.metric]}
              {deltaText && (
                <span className={`withings-delta${deltaClass}`}> {deltaText}</span>
              )}
            </span>
          )}
        </h3>
        {onGoalChange && (
          <button
            className="strava-goal-btn"
            onClick={() => {
              setGoalInput(goal !== null ? String(goal) : '');
              setEditing(!editing);
            }}
            title="Set target"
          >
            <Target size={16} />
          </button>
        )}
      </div>

      {editing && (
        <div className="strava-goal-input-row">
          <input
            className="strava-goal-input"
            type="number"
            placeholder={`Target (${METRIC_UNITS[data.metric]})`}
            value={goalInput}
            onChange={(e) => setGoalInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleGoalSubmit()}
            autoFocus
          />
          <button className="strava-goal-save" onClick={handleGoalSubmit}>
            Set
          </button>
        </div>
      )}

      <div className="strava-chart-container" {...containerHandlers}>
        <svg
          ref={svgRef}
          className="strava-chart-svg"
          viewBox={`0 0 ${viewBoxWidth} ${CHART_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {optimalRange && (
            <rect
              x={CHART_PADDING.left}
              y={yVal(optimalRange.max)}
              width={plotW}
              height={yVal(optimalRange.min) - yVal(optimalRange.max)}
              fill="#00e676"
              opacity={0.3}
            />
          )}

          {/* Grid lines */}
          {ticks.map((tick) => (
            <line
              key={`grid-${tick}`}
              x1={CHART_PADDING.left}
              y1={yVal(tick)}
              x2={viewBoxWidth - CHART_PADDING.right}
              y2={yVal(tick)}
              className="strava-grid-line"
            />
          ))}

          {/* Y-axis labels */}
          {ticks.map((tick) => (
            <text
              key={`lbl-${tick}`}
              x={CHART_PADDING.left - 4}
              y={yVal(tick)}
              className="strava-axis-label"
              textAnchor="end"
              dominantBaseline="middle"
            >
              {formatMetricValue(tick, data.metric)}
            </text>
          ))}

          {/* X-axis labels */}
          {xLabelIndices.map((i) => (
            <text
              key={`xlbl-${i}`}
              x={xCenter(i)}
              y={CHART_HEIGHT - 4}
              className="strava-axis-label"
              textAnchor="middle"
            >
              {points[i].label}
            </text>
          ))}

          {/* Goal line */}
          {goal !== null && (
            <line
              x1={CHART_PADDING.left}
              y1={yVal(goal)}
              x2={viewBoxWidth - CHART_PADDING.right}
              y2={yVal(goal)}
              className="strava-goal-line"
            />
          )}

          {/* Trend line — one continuous, lightly-smoothed curve */}
          {linePath && <path d={linePath} className="strava-cumulative-line" />}

          {/* Data dots */}
          {points.map((p, i) =>
            p.value === null ? null : (
              <circle
                key={`dot-${i}`}
                cx={xCenter(i)}
                cy={yVal(p.value)}
                r={i === activeIndex ? (n > 20 ? 3 : 4) : (n > 20 ? 1.5 : 2.5)}
                className={`strava-cumulative-dot${i === activeIndex ? ' active' : ''}`}
              />
            ),
          )}

          {/* Tooltip crosshair */}
          {activeIndex !== null && (
            <line
              x1={xCenter(activeIndex)}
              y1={CHART_PADDING.top}
              x2={xCenter(activeIndex)}
              y2={CHART_PADDING.top + plotH}
              className="chart-crosshair"
            />
          )}
        </svg>

        {/* Tooltip label */}
        {activeIndex !== null && activeIndex < points.length && points[activeIndex].value !== null && (
          <div
            className="chart-tooltip"
            style={{ left: `${(xCenter(activeIndex) / viewBoxWidth) * 100}%` }}
          >
            <span className="chart-tooltip-value">
              {formatMetricValue(points[activeIndex].value as number, data.metric)} {METRIC_UNITS[data.metric]}
            </span>
            <span className="chart-tooltip-date">{points[activeIndex].label}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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

  const niceMin = Math.ceil(min / niceStep) * niceStep;
  const niceMax = Math.floor(max / niceStep) * niceStep;

  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + niceStep * 0.01; v += niceStep) {
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  return ticks;
}

/**
 * Builds a lightly-smoothed SVG path ("d" attribute) through a series of
 * points using Catmull-Rom-to-Bezier interpolation, so the trend line
 * curves gently between points instead of having sharp corners.
 *
 * Each control point's vertical position is clamped to the range spanned by
 * its two anchor points. A plain Catmull-Rom spline can overshoot well beyond
 * the data when consecutive values change sharply (common with sparse or
 * spiky body-composition samples), producing bulges or loops that dip below /
 * rise above every real measurement. Clamping keeps the curve within the band
 * defined by the surrounding points while preserving the horizontal easing.
 */
function buildSmoothPath(coords: { x: number; y: number }[]): string {
  if (coords.length === 0) return '';
  if (coords.length === 1) return `M ${coords[0].x},${coords[0].y}`;

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  let d = `M ${coords[0].x},${coords[0].y}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i - 1] ?? coords[i];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = clamp(p1.y + (p2.y - p0.y) / 6, Math.min(p1.y, p2.y), Math.max(p1.y, p2.y));
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = clamp(p2.y - (p3.y - p1.y) / 6, Math.min(p1.y, p2.y), Math.max(p1.y, p2.y));
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}
