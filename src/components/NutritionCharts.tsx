/**
 * NutritionCharts — bar charts for calories, protein, and alcoholic drinks that
 * match the Garmin-page chart styling. Each bar is color-coded against its
 * aggregated goal (yellow under 90%, green within ±10%, red over by >10%) and a
 * dashed goal line tracks the aggregated per-period target.
 *
 * Reuses the shared strava chart CSS classes (strava-chart-card, strava-bar,
 * strava-goal-line, strava-axis-label, etc.).
 */
import { useMemo } from 'react';
import type { MealLogEntry } from '../model/index.js';
import type { StravaAggregation, StravaTimeRange } from '../model/strava.js';
import type { NutritionChartData, NutritionMetric } from '../model/nutrition.js';
import {
  buildNutritionChartData,
  formatNutritionValue,
  nutritionColor,
  NUTRITION_METRIC_LABELS,
  NUTRITION_METRIC_UNITS,
} from '../model/nutrition.js';
import { useChartTooltip } from '../hooks/useChartTooltip.js';

interface Props {
  entries: MealLogEntry[];
  range: StravaTimeRange;
  aggregation: StravaAggregation;
  calorieGoal: number;
  proteinGoal: number;
  drinksGoal: number;
}

const CHART_HEIGHT = 132;
const CHART_PADDING = { top: 16, right: 16, bottom: 32, left: 44 };
const BAR_FALLBACK = 'rgba(255,255,255,0.25)';

export function NutritionCharts({ entries, range, aggregation, calorieGoal, proteinGoal, drinksGoal }: Props) {
  const today = useMemo(() => new Date(), []);

  const charts = useMemo(() => {
    const specs: { metric: NutritionMetric; goal: number }[] = [
      { metric: 'calories', goal: calorieGoal },
      { metric: 'protein', goal: proteinGoal },
      { metric: 'drinks', goal: drinksGoal },
    ];
    return specs.map(({ metric, goal }) =>
      buildNutritionChartData(entries, metric, range, goal, today, aggregation),
    );
  }, [entries, range, aggregation, calorieGoal, proteinGoal, drinksGoal, today]);

  if (entries.length === 0) {
    return <p className="nutrition-empty">Log some meals to see nutrition trends.</p>;
  }

  return (
    <>
      {charts.map((data) => (
        <NutritionChart key={data.metric} data={data} />
      ))}
    </>
  );
}

function NutritionChart({ data }: { data: NutritionChartData }) {
  const viewBoxWidth = 400;
  const plotW = viewBoxWidth - CHART_PADDING.left - CHART_PADDING.right;
  const plotH = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;

  const { buckets, metric } = data;
  const n = buckets.length;

  const maxBar = Math.max(...buckets.map((b) => Math.max(b.value, b.goal)), 0.001);

  const barWidth = n > 0 ? plotW / n : plotW;
  const barGap = Math.max(1, barWidth * 0.15);
  const barInner = barWidth - barGap * 2;

  const xCenter = (i: number) => CHART_PADDING.left + barWidth * i + barWidth / 2;
  const yVal = (v: number) => CHART_PADDING.top + plotH - (v / maxBar) * plotH;

  const leftTicks = niceTicksFor(0, maxBar, 4);

  const maxLabels = Math.min(n, 8);
  const xLabelIndices: number[] = [];
  if (n <= maxLabels) {
    for (let i = 0; i < n; i++) xLabelIndices.push(i);
  } else {
    for (let i = 0; i < maxLabels; i++) {
      xLabelIndices.push(Math.round((i / (maxLabels - 1)) * (n - 1)));
    }
  }

  // Goal line: draw a flat horizontal line at the full-period goal (the maximum
  // bucket goal, which equals goalPerDay × daysInPeriod for complete periods).
  // Using max avoids the line dipping for the current in-progress week/month,
  // which has fewer elapsed days than a complete period.
  const fullPeriodGoal = Math.max(...buckets.map((b) => b.goal), 0);

  const xPositions = useMemo(
    () => Array.from({ length: n }, (_, i) => xCenter(i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [n, plotW],
  );
  const { activeIndex, svgRef, containerHandlers } = useChartTooltip(xPositions, viewBoxWidth);

  const headerValue = data.latestValue ?? data.total;

  return (
    <div className="strava-chart-card">
      <div className="strava-chart-header">
        <h3 className="strava-chart-label">
          {NUTRITION_METRIC_LABELS[metric]}
          <span className="strava-chart-total">
            {formatNutritionValue(headerValue, metric)} {NUTRITION_METRIC_UNITS[metric]}
          </span>
        </h3>
      </div>

      {n === 0 ? (
        <p className="strava-empty">No data for the selected range.</p>
      ) : (
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
                y1={yVal(tick)}
                x2={viewBoxWidth - CHART_PADDING.right}
                y2={yVal(tick)}
                className="strava-grid-line"
              />
            ))}

            {leftTicks.map((tick) => (
              <text
                key={`lbl-l-${tick}`}
                x={CHART_PADDING.left - 4}
                y={yVal(tick)}
                className="strava-axis-label"
                textAnchor="end"
                dominantBaseline="middle"
              >
                {formatNutritionValue(tick, metric)}
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

            {buckets.map((b, i) => (
              <rect
                key={`bar-${i}`}
                x={CHART_PADDING.left + barWidth * i + barGap}
                y={yVal(b.value)}
                width={Math.max(barInner, 1)}
                height={Math.max((b.value / maxBar) * plotH, 0)}
                style={{ fill: nutritionColor(b.colorKey, BAR_FALLBACK) }}
                className={`strava-bar${i === activeIndex ? ' active' : ''}`}
                rx={2}
              />
            ))}

            {fullPeriodGoal > 0 && (
              <line
                x1={CHART_PADDING.left}
                y1={yVal(fullPeriodGoal)}
                x2={viewBoxWidth - CHART_PADDING.right}
                y2={yVal(fullPeriodGoal)}
                className="strava-goal-line"
              />
            )}

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
              style={{ left: `${(xCenter(activeIndex) / viewBoxWidth) * 100}%` }}
            >
              <span className="chart-tooltip-value">
                {formatNutritionValue(buckets[activeIndex].value, metric)} {NUTRITION_METRIC_UNITS[metric]}
              </span>
              {buckets[activeIndex].goal > 0 && (
                <span className="chart-tooltip-secondary">
                  Goal {formatNutritionValue(buckets[activeIndex].goal, metric)}
                </span>
              )}
              <span className="chart-tooltip-date">{buckets[activeIndex].label}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
