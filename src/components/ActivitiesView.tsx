import { useState, useMemo } from 'react';
import type {
  StravaActivity,
  StravaGoal,
  StravaMetric,
  StravaTimeRange,
  StravaAggregation,
  MetricChartData,
} from '../model/strava.js';
import {
  getActivityTypes,
  filterActivities,
  buildMetricChartData,
  formatMetricValue,
  METRIC_LABELS,
  METRIC_UNITS,
  splitActivities,
  generateBucketSlots,
  getBucketKey,
} from '../model/strava.js';
import { Target } from 'lucide-react';
import { useChartTooltip } from '../hooks/useChartTooltip.js';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface Props {
  activities: StravaActivity[];
  goals: StravaGoal[];
  range: StravaTimeRange;
  aggregation: StravaAggregation;
  onGoalChange?: (metric: StravaMetric, value: number | null) => void;
  /** Heading shown at the top of the view. Defaults to "Activities". */
  title?: string | null;
  /** Message shown when there are no activities. */
  emptyText?: string;
  /** When true, omit outer page padding so the charts can live inside a shared layout. */
  embedded?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const METRICS: StravaMetric[] = ['distance', 'elevationGain', 'duration'];

/** Cardio charts show all three metrics; strength only shows duration. */
const STRENGTH_METRICS: StravaMetric[] = ['duration'];

const CHART_HEIGHT = 132;
const CHART_PADDING = { top: 16, right: 56, bottom: 32, left: 52 };
const CALORIES_UNIT = 'kcal';

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ActivitiesView({ activities, goals, range, aggregation, onGoalChange, title = 'Activities', emptyText = 'No activity data yet. Set up sync to see activity charts.', embedded = false }: Props) {
  // Split into cardio (everything except strength) and strength training
  const { cardio: cardioActivities, strength: strengthActivities } = useMemo(
    () => splitActivities(activities),
    [activities],
  );

  const allTypes = useMemo(
    () => getActivityTypes(cardioActivities),
    [cardioActivities],
  );

  const today = useMemo(() => new Date(), []);

  // Cardio: filtered by range (all types included)
  const filteredCardio = useMemo(
    () => filterActivities(cardioActivities, range, new Set(allTypes), today),
    [cardioActivities, range, allTypes, today],
  );

  // Strength: filtered by range only (all strength activities included)
  const filteredStrength = useMemo(
    () => {
      const allStrength = new Set(getActivityTypes(strengthActivities));
      return filterActivities(strengthActivities, range, allStrength, today);
    },
    [strengthActivities, range, today],
  );

  const filteredAllActivities = useMemo(
    () => {
      const allTypes = new Set(getActivityTypes(activities));
      return filterActivities(activities, range, allTypes, today);
    },
    [activities, range, today],
  );

  const goalMap = useMemo(() => {
    const m = new Map<StravaMetric, number>();
    for (const g of goals) m.set(g.metric, g.value);
    return m;
  }, [goals]);

  const cardioCharts = useMemo(
    () =>
      METRICS.map((metric) =>
        buildMetricChartData(filteredCardio, metric, range, goalMap.get(metric) ?? null, today, aggregation),
      ).filter((d) => d.buckets.length > 0),
    [filteredCardio, range, goalMap, today, aggregation],
  );

  const strengthCharts = useMemo(
    () =>
      STRENGTH_METRICS.map((metric) =>
        buildMetricChartData(filteredStrength, metric, range, null, today, aggregation),
      ).filter((d) => d.buckets.length > 0),
    [filteredStrength, range, today, aggregation],
  );

  const caloriesChartData = useMemo(
    () => buildCaloriesChartData(filteredAllActivities, range, aggregation, today),
    [filteredAllActivities, range, aggregation, today],
  );

  if (activities.length === 0) {
    return (
      <div className={embedded ? 'strava-subview' : 'strava-view'}>
        {title ? <h2 className="strava-title">{title}</h2> : null}
        <p className="strava-empty">
          {emptyText}
        </p>
      </div>
    );
  }

  return (
    <div className={embedded ? 'strava-subview' : 'strava-view'}>
      {title ? <h2 className="strava-title">{title}</h2> : null}

      {/* Cardio charts */}
      {cardioCharts.length > 0 && (
        <>
          <h3 className="strava-section-title">Cardio</h3>
          {cardioCharts.map((data) => (
            <MetricChart
              key={data.metric}
              data={data}
              aggregation={aggregation}
              goal={goalMap.get(data.metric) ?? null}
              onGoalChange={onGoalChange}
            />
          ))}
        </>
      )}

      {caloriesChartData && (
        <>
          <h3 className="strava-section-title">Calories</h3>
          <CaloriesChart data={caloriesChartData} />
        </>
      )}

      {/* Strength training chart */}
      {strengthCharts.length > 0 && (
        <>
          <h3 className="strava-section-title">Strength Training</h3>
          {strengthCharts.map((data) => (
            <MetricChart
              key={`strength-${data.metric}`}
              data={data}
              aggregation={aggregation}
              goal={null}
              onGoalChange={undefined}
            />
          ))}
        </>
      )}

      {cardioCharts.length === 0 && strengthCharts.length === 0 && !caloriesChartData && (
        <p className="strava-empty">No data for the selected filters and time range.</p>
      )}
    </div>
  );
}

interface CaloriesBucket {
  label: string;
  active: number;
  resting: number;
  total: number;
}

interface CaloriesChartData {
  buckets: CaloriesBucket[];
  cumulativeTotal: number[];
  total: number;
  latestValue: number | null;
}

function buildCaloriesChartData(
  activities: StravaActivity[],
  range: StravaTimeRange,
  aggregation: StravaAggregation,
  today: Date,
): CaloriesChartData | null {
  const asNonNegative = (value: number | undefined): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

  const hasCaloriesData = activities.some((a) => {
    const total = asNonNegative(a.totalCalories ?? a.calories);
    const active = asNonNegative(a.activeCalories);
    return total > 0 || active > 0;
  });
  if (!hasCaloriesData) return null;

  const slots = generateBucketSlots(range, aggregation, today);
  const bucketMap = new Map<string, { active: number; resting: number; total: number }>();
  for (const { key } of slots) {
    bucketMap.set(key, { active: 0, resting: 0, total: 0 });
  }

  for (const activity of activities) {
    const key = getBucketKey(activity.date, aggregation);
    const bucket = bucketMap.get(key);
    if (!bucket) continue;

    const active = asNonNegative(activity.activeCalories);
    const total = asNonNegative(activity.totalCalories ?? activity.calories);
    const resting = Math.max(total - active, 0);

    bucket.active += active;
    bucket.resting += resting;
    bucket.total += total;
  }

  const buckets: CaloriesBucket[] = slots.map(({ key, label }) => {
    const bucket = bucketMap.get(key) ?? { active: 0, resting: 0, total: 0 };
    return { label, active: bucket.active, resting: bucket.resting, total: bucket.total };
  });

  const cumulativeTotal: number[] = [];
  let running = 0;
  for (const bucket of buckets) {
    running += bucket.total;
    cumulativeTotal.push(running);
  }
  const latestValue = [...buckets].reverse().find((bucket) => bucket.total > 0)?.total ?? null;

  return { buckets, cumulativeTotal, total: running, latestValue };
}

function formatCaloriesValue(v: number): string {
  if (v >= 10000) return `${(v / 1000).toFixed(0)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return Math.round(v).toString();
}

function CaloriesChart({ data }: { data: CaloriesChartData }) {
  const viewBoxWidth = 400;
  const plotW = viewBoxWidth - CHART_PADDING.left - CHART_PADDING.right;
  const plotH = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;

  const { buckets, cumulativeTotal } = data;
  const topValue = data.latestValue ?? data.total;
  const n = buckets.length;
  if (n === 0) return null;

  const maxBar = Math.max(...buckets.map((b) => b.total), 0.001);
  const maxCum = Math.max(...cumulativeTotal, 0.001);

  const barWidth = plotW / n;
  const barGap = Math.max(1, barWidth * 0.15);
  const barInner = barWidth - barGap * 2;

  const xCenter = (i: number) => CHART_PADDING.left + barWidth * i + barWidth / 2;
  const yBar = (v: number) => CHART_PADDING.top + plotH - (v / maxBar) * plotH;
  const yCum = (v: number) => CHART_PADDING.top + plotH - (v / maxCum) * plotH;

  const leftTicks = niceTicksFor(0, maxBar, 4);
  const rightTicks = niceTicksFor(0, maxCum, 4);

  const maxLabels = Math.min(n, 8);
  const xLabelIndices: number[] = [];
  if (n <= maxLabels) {
    for (let i = 0; i < n; i++) xLabelIndices.push(i);
  } else {
    for (let i = 0; i < maxLabels; i++) {
      xLabelIndices.push(Math.round((i / (maxLabels - 1)) * (n - 1)));
    }
  }

  const cumulativePoints = cumulativeTotal
    .map((v, i) => `${xCenter(i)},${yCum(v)}`)
    .join(' ');

  const xPositions = useMemo(
    () => Array.from({ length: n }, (_, i) => xCenter(i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [n, plotW],
  );
  const { activeIndex, svgRef, containerHandlers } = useChartTooltip(xPositions, viewBoxWidth);

  return (
    <div className="strava-chart-card">
      <div className="strava-chart-header">
        <h3 className="strava-chart-label">
          Calories
          <span className="strava-chart-total">
            {formatCaloriesValue(topValue)} {CALORIES_UNIT}
          </span>
        </h3>
      </div>

      <div className="strava-chart-container" {...containerHandlers}>
        <svg
          ref={svgRef}
          className="strava-chart-svg"
          viewBox={`0 0 ${viewBoxWidth} ${CHART_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {leftTicks.map((tick) => (
            <line
              key={`grid-${tick}`}
              x1={CHART_PADDING.left}
              y1={yBar(tick)}
              x2={viewBoxWidth - CHART_PADDING.right}
              y2={yBar(tick)}
              className="strava-grid-line"
            />
          ))}

          {leftTicks.map((tick) => (
            <text
              key={`lbl-l-${tick}`}
              x={CHART_PADDING.left - 4}
              y={yBar(tick)}
              className="strava-axis-label"
              textAnchor="end"
              dominantBaseline="middle"
            >
              {formatCaloriesValue(tick)}
            </text>
          ))}

          {rightTicks.map((tick) => (
            <text
              key={`lbl-r-${tick}`}
              x={viewBoxWidth - CHART_PADDING.right + 4}
              y={yCum(tick)}
              className="strava-axis-label strava-axis-right"
              textAnchor="start"
              dominantBaseline="middle"
            >
              {formatCaloriesValue(tick)}
            </text>
          ))}

          {xLabelIndices.map((i) => (
            <text
              key={`xlbl-${i}`}
              x={xCenter(i)}
              y={CHART_HEIGHT - 4}
              className="strava-axis-label"
              textAnchor="middle"
            >
              {buckets[i].label}
            </text>
          ))}

          {buckets.map((b, i) => {
            const x = CHART_PADDING.left + barWidth * i + barGap;
            const restingY = yBar(b.resting);
            const totalY = yBar(b.total);
            return (
              <g key={`bar-${i}`}>
                <rect
                  x={x}
                  y={restingY}
                  width={Math.max(barInner, 1)}
                  height={Math.max(plotH - (plotH - (b.resting / maxBar) * plotH), 0)}
                  className={`strava-bar-resting${i === activeIndex ? ' active' : ''}`}
                  rx={2}
                />
                <rect
                  x={x}
                  y={totalY}
                  width={Math.max(barInner, 1)}
                  height={Math.max(restingY - totalY, 0)}
                  className={`strava-bar-active${i === activeIndex ? ' active' : ''}`}
                  rx={2}
                />
              </g>
            );
          })}

          <polyline
            points={cumulativePoints}
            className="strava-cumulative-line"
          />

          {cumulativeTotal.map((v, i) => (
            <circle
              key={`dot-${i}`}
              cx={xCenter(i)}
              cy={yCum(v)}
              r={i === activeIndex ? (n > 20 ? 3 : 4) : (n > 20 ? 1.5 : 2.5)}
              className={`strava-cumulative-dot${i === activeIndex ? ' active' : ''}`}
            />
          ))}

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

        {activeIndex !== null && activeIndex < buckets.length && (
          <div
            className="chart-tooltip"
            style={{
              left: `${(xCenter(activeIndex) / viewBoxWidth) * 100}%`,
            }}
          >
            <span className="chart-tooltip-value">
              {formatCaloriesValue(buckets[activeIndex].total)} {CALORIES_UNIT} total
            </span>
            <span className="chart-tooltip-secondary">
              {formatCaloriesValue(buckets[activeIndex].resting)} resting • {formatCaloriesValue(buckets[activeIndex].active)} active
            </span>
            {activeIndex < cumulativeTotal.length && (
              <span className="chart-tooltip-secondary">
                Σ {formatCaloriesValue(cumulativeTotal[activeIndex])}
              </span>
            )}
            <span className="chart-tooltip-date">{buckets[activeIndex].label}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MetricChart — dual-axis SVG chart                                  */
/* ------------------------------------------------------------------ */

function MetricChart({
  data,
  aggregation,
  goal,
  onGoalChange,
}: {
  data: MetricChartData;
  aggregation: StravaAggregation;
  goal: number | null;
  onGoalChange?: (metric: StravaMetric, value: number | null) => void;
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

  const { buckets, cumulative, proratedGoal, goalTrajectory } = data;
  const topValue = aggregation === 'day' && data.latestValue !== null
    ? data.latestValue
    : data.total;
  const n = buckets.length;
  if (n === 0) return null;

  // Left axis: bar values
  const maxBar = Math.max(...buckets.map((b) => b.value), 0.001);

  // Right axis: cumulative values (and goal if present)
  const maxCum = Math.max(
    ...cumulative,
    proratedGoal ?? 0,
    0.001,
  );

  // Scales
  const barWidth = plotW / n;
  const barGap = Math.max(1, barWidth * 0.15);
  const barInner = barWidth - barGap * 2;

  const xCenter = (i: number) => CHART_PADDING.left + barWidth * i + barWidth / 2;
  const yBar = (v: number) => CHART_PADDING.top + plotH - (v / maxBar) * plotH;
  const yCum = (v: number) => CHART_PADDING.top + plotH - (v / maxCum) * plotH;

  // Y-axis ticks
  const leftTicks = niceTicksFor(0, maxBar, 4);
  const rightTicks = niceTicksFor(0, maxCum, 4);

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

  // Cumulative polyline
  const cumPoints = cumulative
    .map((v, i) => `${xCenter(i)},${yCum(v)}`)
    .join(' ');

  // Goal trajectory polyline (linear ramp through bucket centers)
  const goalTrajectoryPoints =
    goalTrajectory.length > 0
      ? goalTrajectory
          .map((v, i) => `${xCenter(i)},${yCum(v)}`)
          .join(' ')
      : null;

  // Tooltip support
  const xPositions = useMemo(
    () => Array.from({ length: n }, (_, i) => xCenter(i)),
    // xCenter depends on barWidth which depends on n and plotW (constant),
    // so n is sufficient as a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [n, plotW],
  );
  const { activeIndex, svgRef, containerHandlers } = useChartTooltip(xPositions, viewBoxWidth);

  return (
    <div className="strava-chart-card">
      <div className="strava-chart-header">
        <h3 className="strava-chart-label">
          {METRIC_LABELS[data.metric]}
          <span className="strava-chart-total">
            {formatMetricValue(topValue, data.metric)} {METRIC_UNITS[data.metric]}
          </span>
        </h3>
        {onGoalChange && (
          <button
            className="strava-goal-btn"
            onClick={() => {
              setGoalInput(goal !== null ? String(goal) : '');
              setEditing(!editing);
            }}
            title="Set annual goal"
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
            placeholder={`Annual goal (${METRIC_UNITS[data.metric]})`}
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
          {/* Grid lines (left axis) */}
          {leftTicks.map((tick) => (
            <line
              key={`grid-${tick}`}
              x1={CHART_PADDING.left}
              y1={yBar(tick)}
              x2={viewBoxWidth - CHART_PADDING.right}
              y2={yBar(tick)}
              className="strava-grid-line"
            />
          ))}

          {/* Left axis labels (bar values) */}
          {leftTicks.map((tick) => (
            <text
              key={`lbl-l-${tick}`}
              x={CHART_PADDING.left - 4}
              y={yBar(tick)}
              className="strava-axis-label"
              textAnchor="end"
              dominantBaseline="middle"
            >
              {formatMetricValue(tick, data.metric)}
            </text>
          ))}

          {/* Right axis labels (cumulative values) */}
          {rightTicks.map((tick) => (
            <text
              key={`lbl-r-${tick}`}
              x={viewBoxWidth - CHART_PADDING.right + 4}
              y={yCum(tick)}
              className="strava-axis-label strava-axis-right"
              textAnchor="start"
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
              {buckets[i].label}
            </text>
          ))}

          {/* Bars */}
          {buckets.map((b, i) => (
            <rect
              key={`bar-${i}`}
              x={CHART_PADDING.left + barWidth * i + barGap}
              y={yBar(b.value)}
              width={Math.max(barInner, 1)}
              height={Math.max(plotH - (plotH - (b.value / maxBar) * plotH), 0)}
              className={`strava-bar${i === activeIndex ? ' active' : ''}`}
              rx={2}
            />
          ))}

          {/* Goal trajectory line */}
          {goalTrajectoryPoints && (
            <polyline
              points={goalTrajectoryPoints}
              className="strava-goal-line"
            />
          )}

          {/* Cumulative line */}
          <polyline
            points={cumPoints}
            className="strava-cumulative-line"
          />

          {/* Cumulative dots */}
          {cumulative.map((v, i) => (
            <circle
              key={`dot-${i}`}
              cx={xCenter(i)}
              cy={yCum(v)}
              r={i === activeIndex ? (n > 20 ? 3 : 4) : (n > 20 ? 1.5 : 2.5)}
              className={`strava-cumulative-dot${i === activeIndex ? ' active' : ''}`}
            />
          ))}

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
        {activeIndex !== null && activeIndex < buckets.length && (
          <div
            className="chart-tooltip"
            style={{
              left: `${(xCenter(activeIndex) / viewBoxWidth) * 100}%`,
            }}
          >
            <span className="chart-tooltip-value">
              {formatMetricValue(buckets[activeIndex].value, data.metric)} {METRIC_UNITS[data.metric]}
            </span>
            {activeIndex < cumulative.length && (
              <span className="chart-tooltip-secondary">
                Σ {formatMetricValue(cumulative[activeIndex], data.metric)}
              </span>
            )}
            <span className="chart-tooltip-date">{buckets[activeIndex].label}</span>
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

  const niceMin = Math.floor(min / niceStep) * niceStep;
  const niceMax = Math.ceil(max / niceStep) * niceStep;

  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + niceStep * 0.01; v += niceStep) {
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  return ticks;
}
