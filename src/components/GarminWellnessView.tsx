/**
 * GarminWellnessView — scrollable page of bar charts for daily Garmin wellness
 * metrics (HRV, sleep, training status/readiness/load, body battery, steps,
 * floors, intensity minutes, VO2 max, hill/endurance scores, RHR).
 *
 * Reuses the same CSS classes as StravaView (strava-chart-card, strava-bar, etc.)
 * and the same aggregation engine from strava.ts via wellness.ts.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GarminWellnessEntry } from '../model/types.js';
import type { WellnessAggregation, WellnessTimeRange, WellnessBucket, WellnessStatusBucket, WellnessChartData } from '../model/wellness.js';
import {
  buildWellnessChartData,
  buildTrainingLoadRatioChartData,
  buildStatusChartData,
  formatWellnessRatio,
  formatWellnessValue,
  WELLNESS_METRIC_LABELS,
  WELLNESS_METRIC_UNITS,
} from '../model/wellness.js';
import { useChartTooltip } from '../hooks/useChartTooltip.js';

/* ------------------------------------------------------------------ */
/*  Color constants                                                    */
/* ------------------------------------------------------------------ */

const ACCENT = '#ff2d7b';
const GREEN  = '#00e676';
const YELLOW = '#ffea00';
const ORANGE = '#ffab40';
const RED    = '#ff1744';
const PURPLE = '#d500f9';
const BLUE   = '#2196f3';
const GRAY   = 'rgba(255,255,255,0.25)';

function thresholdColor(value: number, thresholds: Array<{ max: number; color: string }>, fallback: string): string {
  for (const { max, color } of thresholds) {
    if (value < max) return color;
  }
  return fallback;
}

function readinessColor(v: number): string {
  if (v >= 75) return GREEN;
  if (v >= 50) return YELLOW;
  return ACCENT;
}

function trainingLoadRatioColor(v: number): string {
  if (v < 0.8) return YELLOW;
  if (v <= 1.5) return GREEN;
  return ACCENT;
}

export function trainingStatusColor(status: string): string {
  switch (status.toUpperCase()) {
    case 'PRODUCTIVE':      return GREEN;
    case 'PEAKING':         return PURPLE;
    case 'MAINTAINING':     return YELLOW;
    case 'RECOVERY':
    case 'RECOVERY_ACTIVE': return BLUE;
    case 'UNPRODUCTIVE':    return ORANGE;
    case 'STRAINED':        return ACCENT;
    case 'OVERREACHING':    return RED;
    case 'DETRAINING':      return GRAY;
    default:                return GRAY;
  }
}

interface ChartLegendItem {
  status: string;
  label: string;
  color: string;
}

export const TRAINING_STATUS_LEGEND_ITEMS: ChartLegendItem[] = [
  { status: 'PRODUCTIVE', label: 'Productive', color: GREEN },
  { status: 'PEAKING', label: 'Peaking', color: PURPLE },
  { status: 'MAINTAINING', label: 'Maintaining', color: YELLOW },
  { status: 'RECOVERY', label: 'Recovery', color: BLUE },
  { status: 'UNPRODUCTIVE', label: 'Unproductive', color: ORANGE },
  { status: 'STRAINED', label: 'Strained', color: ACCENT },
  { status: 'OVERREACHING', label: 'Overreaching', color: RED },
  { status: 'DETRAINING', label: 'Detraining', color: GRAY },
];

export function formatTrainingStatusLabel(status: string): string {
  if (!status) return '—';
  return status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (char) => char.toUpperCase());
}

export function hrvStatusColor(status: string): string {
  const s = status.toUpperCase();
  if (s === 'BALANCED' || s === 'OPTIMAL') return GREEN;
  if (s.includes('UNBALANCED'))            return YELLOW;
  if (s === 'LOW')                         return RED;
  return ACCENT;
}

// Garmin fitness bands requested for VO₂ max: poor, fair, good, excellent, superior.
export function vo2MaxColor(value: number): string {
  return thresholdColor(value, [
    { max: 38.5, color: RED },
    { max: 42.4, color: ORANGE },
    { max: 46.4, color: GREEN },
    { max: 52.5, color: BLUE },
  ], PURPLE);
}

// Garmin hill score bands requested for climbing fitness from red through pink.
export function hillScoreColor(value: number): string {
  return thresholdColor(value, [
    { max: 25, color: RED },
    { max: 50, color: ORANGE },
    { max: 70, color: GREEN },
    { max: 85, color: BLUE },
    { max: 95, color: PURPLE },
  ], ACCENT);
}

// Sleep score bands: <60 red, <80 orange, <90 green, 90+ blue.
export function sleepScoreColor(value: number): string {
  return thresholdColor(value, [
    { max: 60, color: RED },
    { max: 80, color: ORANGE },
    { max: 90, color: GREEN },
  ], BLUE);
}

// Garmin endurance score bands requested for lowest through highest endurance fitness.
export function enduranceScoreColor(value: number): string {
  return thresholdColor(value, [
    { max: 5000, color: RED },
    { max: 5700, color: ORANGE },
    { max: 6400, color: YELLOW },
    { max: 7000, color: GREEN },
    { max: 7700, color: BLUE },
    { max: 8400, color: PURPLE },
  ], ACCENT);
}

/* ------------------------------------------------------------------ */
/*  Chart constants (same as StravaView)                              */
/* ------------------------------------------------------------------ */

const CHART_HEIGHT = 132;
const CHART_PADDING = { top: 16, right: 16, bottom: 32, left: 52 };
const VIEW_BOX_W = 400;
const PLOT_W = VIEW_BOX_W - CHART_PADDING.left - CHART_PADDING.right;
const PLOT_H = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;

/* ------------------------------------------------------------------ */
/*  Y-axis tick helper (same as StravaView)                           */
/* ------------------------------------------------------------------ */

function niceTicksFor(min: number, max: number, count: number): number[] {
  const range = max - min;
  if (range === 0) return [min];
  const rawStep = range / (count - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / magnitude;
  let niceStep: number;
  if      (residual <= 1.5) niceStep = magnitude;
  else if (residual <= 3.5) niceStep = 2.5 * magnitude;
  else if (residual <= 7.5) niceStep = 5 * magnitude;
  else                      niceStep = 10 * magnitude;
  const niceMin = Math.floor(min / niceStep) * niceStep;
  const niceMax = Math.ceil(max / niceStep) * niceStep;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + niceStep * 0.01; v += niceStep) {
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  return ticks;
}

/* ------------------------------------------------------------------ */
/*  WellnessBarChart — standard numeric bar chart                     */
/* ------------------------------------------------------------------ */

interface BarChartProps {
  label: string;
  unit: string;
  buckets: WellnessBucket[];
  summaryLabel: string;
  /** Per-bar color function. Falls back to ACCENT. */
  colorFn?: (value: number | null, colorKey?: string) => string;
  formatValue: (v: number | null) => string;
}

function WellnessBarChart({ label, unit, buckets, summaryLabel, colorFn, formatValue }: BarChartProps) {
  const n = buckets.length;
  if (n === 0) return null;

  const maxBar = Math.max(...buckets.map((b) => b.value ?? 0), 0.001);
  const barWidth = PLOT_W / n;
  const barGap = Math.max(1, barWidth * 0.15);
  const barInner = barWidth - barGap * 2;

  const xCenter = (i: number) => CHART_PADDING.left + barWidth * i + barWidth / 2;
  const yBar = (v: number) => CHART_PADDING.top + PLOT_H - (v / maxBar) * PLOT_H;

  const yTicks = niceTicksFor(0, maxBar, 4);

  const maxLabels = Math.min(n, 8);
  const xLabelIndices: number[] = [];
  if (n <= maxLabels) {
    for (let i = 0; i < n; i++) xLabelIndices.push(i);
  } else {
    for (let i = 0; i < maxLabels; i++) {
      xLabelIndices.push(Math.round((i / (maxLabels - 1)) * (n - 1)));
    }
  }

  const xPositions = buckets.map((_, i) => xCenter(i));
  const { activeIndex, svgRef, containerHandlers } = useChartTooltip(xPositions, VIEW_BOX_W);

  const fmtY = (v: number) => formatValue(v);

  return (
    <div className="strava-chart-card">
      <div className="strava-chart-header">
        <h3 className="strava-chart-label">
          {label}
          <span className="strava-chart-total">{summaryLabel}</span>
        </h3>
      </div>

      <div className="strava-chart-container" {...containerHandlers}>
        <svg
          ref={svgRef}
          className="strava-chart-svg"
          viewBox={`0 0 ${VIEW_BOX_W} ${CHART_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Grid lines */}
          {yTicks.map((tick) => (
            <line
              key={`grid-${tick}`}
              x1={CHART_PADDING.left} y1={yBar(tick)}
              x2={VIEW_BOX_W - CHART_PADDING.right} y2={yBar(tick)}
              className="strava-grid-line"
            />
          ))}

          {/* Left axis labels */}
          {yTicks.map((tick) => (
            <text
              key={`lbl-${tick}`}
              x={CHART_PADDING.left - 4} y={yBar(tick)}
              className="strava-axis-label"
              textAnchor="end"
              dominantBaseline="middle"
            >
              {fmtY(tick)}
            </text>
          ))}

          {/* X-axis labels */}
          {xLabelIndices.map((i) => (
            <text
              key={`xlbl-${i}`}
              x={xCenter(i)} y={CHART_HEIGHT - 4}
              className="strava-axis-label"
              textAnchor="middle"
            >
              {buckets[i].label}
            </text>
          ))}

          {/* Bars */}
          {buckets.map((b, i) => {
            const val = b.value ?? 0;
            const barH = Math.max((val / maxBar) * PLOT_H, 0);
            const fill = colorFn ? colorFn(b.value, b.colorKey) : ACCENT;
            return (
              <rect
                key={`bar-${i}`}
                x={CHART_PADDING.left + barWidth * i + barGap}
                y={CHART_PADDING.top + PLOT_H - barH}
                width={Math.max(barInner, 1)}
                height={barH}
                fill={fill}
                opacity={i === activeIndex ? 1 : 0.75}
                rx={2}
              />
            );
          })}

          {/* Crosshair */}
          {activeIndex !== null && (
            <line
              x1={xCenter(activeIndex)} y1={CHART_PADDING.top}
              x2={xCenter(activeIndex)} y2={CHART_PADDING.top + PLOT_H}
              className="chart-crosshair"
            />
          )}
        </svg>

        {/* Tooltip */}
        {activeIndex !== null && activeIndex < buckets.length && (
          <div
            className="chart-tooltip"
            style={{ left: `${(xCenter(activeIndex) / VIEW_BOX_W) * 100}%` }}
          >
            <span className="chart-tooltip-value">
              {formatValue(buckets[activeIndex].value)}{unit ? ` ${unit}` : ''}
            </span>
            <span className="chart-tooltip-date">{buckets[activeIndex].label}</span>
          </div>
        )}
      </div>
    </div>
  );
}

interface WellnessRangeBucket {
  label: string;
  min: number | null;
  max: number | null;
}

interface RangeBarChartProps {
  label: string;
  unit: string;
  buckets: WellnessRangeBucket[];
  summaryLabel: string;
  formatValue: (v: number | null) => string;
}

function WellnessRangeBarChart({ label, unit, buckets, summaryLabel, formatValue }: RangeBarChartProps) {
  const n = buckets.length;
  if (n === 0) return null;

  const values = buckets.flatMap((b) => [b.min, b.max]).filter((v): v is number => v !== null);
  const rawMin = values.length > 0 ? Math.min(...values) : 0;
  const rawMax = values.length > 0 ? Math.max(...values) : 1;
  const yMin = rawMin;
  const yMax = rawMax === rawMin ? rawMin + 1 : rawMax;

  const barWidth = PLOT_W / n;
  const barGap = Math.max(1, barWidth * 0.15);
  const barInner = barWidth - barGap * 2;

  const xCenter = (i: number) => CHART_PADDING.left + barWidth * i + barWidth / 2;
  const yPos = (v: number) => CHART_PADDING.top + PLOT_H - ((v - yMin) / (yMax - yMin)) * PLOT_H;

  const yTicks = niceTicksFor(yMin, yMax, 4);

  const maxLabels = Math.min(n, 8);
  const xLabelIndices: number[] = [];
  if (n <= maxLabels) {
    for (let i = 0; i < n; i++) xLabelIndices.push(i);
  } else {
    for (let i = 0; i < maxLabels; i++) {
      xLabelIndices.push(Math.round((i / (maxLabels - 1)) * (n - 1)));
    }
  }

  const xPositions = buckets.map((_, i) => xCenter(i));
  const { activeIndex, svgRef, containerHandlers } = useChartTooltip(xPositions, VIEW_BOX_W);
  const activeRangeBucket = activeIndex === null ? null : buckets[activeIndex] ?? null;
  const activeTooltipX = activeIndex !== null ? xCenter(activeIndex) : 0;
  const activeTooltipValue = activeRangeBucket === null || activeRangeBucket.min === null || activeRangeBucket.max === null
    ? '—'
    : `${formatValue(activeRangeBucket.min)}–${formatValue(activeRangeBucket.max)}${unit ? ` ${unit}` : ''}`;

  return (
    <div className="strava-chart-card">
      <div className="strava-chart-header">
        <h3 className="strava-chart-label">
          {label}
          <span className="strava-chart-total">{summaryLabel}</span>
        </h3>
      </div>

      <div className="strava-chart-container" {...containerHandlers}>
        <svg
          ref={svgRef}
          className="strava-chart-svg"
          viewBox={`0 0 ${VIEW_BOX_W} ${CHART_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {yTicks.map((tick) => (
            <line
              key={`grid-${tick}`}
              x1={CHART_PADDING.left} y1={yPos(tick)}
              x2={VIEW_BOX_W - CHART_PADDING.right} y2={yPos(tick)}
              className="strava-grid-line"
            />
          ))}

          {yTicks.map((tick) => (
            <text
              key={`lbl-${tick}`}
              x={CHART_PADDING.left - 4} y={yPos(tick)}
              className="strava-axis-label"
              textAnchor="end"
              dominantBaseline="middle"
            >
              {formatValue(tick)}
            </text>
          ))}

          {xLabelIndices.map((i) => (
            <text
              key={`xlbl-${i}`}
              x={xCenter(i)} y={CHART_HEIGHT - 4}
              className="strava-axis-label"
              textAnchor="middle"
            >
              {buckets[i].label}
            </text>
          ))}

          {buckets.map((b, i) => {
            if (b.min === null && b.max === null) return null;
            const lowValue = (b.min ?? b.max)!;
            const highValue = (b.max ?? b.min)!;
            const low = Math.min(lowValue, highValue);
            const high = Math.max(lowValue, highValue);
            const yTop = yPos(high);
            const yBottom = yPos(low);
            return (
              <rect
                key={`bar-${i}`}
                x={CHART_PADDING.left + barWidth * i + barGap}
                y={yTop}
                width={Math.max(barInner, 1)}
                // Keep zero-range days visible as a thin mark.
                height={Math.max(yBottom - yTop, 1)}
                fill={ACCENT}
                opacity={i === activeIndex ? 1 : 0.75}
                rx={2}
              />
            );
          })}

          {activeIndex !== null && (
            <line
              x1={xCenter(activeIndex)} y1={CHART_PADDING.top}
              x2={xCenter(activeIndex)} y2={CHART_PADDING.top + PLOT_H}
              className="chart-crosshair"
            />
          )}
        </svg>

        {activeRangeBucket !== null && (
          <div
            className="chart-tooltip"
            style={{ left: `${(activeTooltipX / VIEW_BOX_W) * 100}%` }}
          >
            <span className="chart-tooltip-value">
              {activeTooltipValue}
            </span>
            <span className="chart-tooltip-date">{activeRangeBucket.label}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  WellnessStatusBarChart — categorical full-height color bars       */
/* ------------------------------------------------------------------ */

function WellnessStatusBarChart({ buckets }: { buckets: WellnessStatusBucket[] }) {
  const n = buckets.length;
  if (n === 0) return null;

  const barWidth = PLOT_W / n;
  const barGap = Math.max(1, barWidth * 0.15);
  const barInner = barWidth - barGap * 2;
  const STATUS_BAR_H = PLOT_H * 0.7;
  const barTop = CHART_PADDING.top + (PLOT_H - STATUS_BAR_H) / 2;

  const xCenter = (i: number) => CHART_PADDING.left + barWidth * i + barWidth / 2;

  const xPositions = buckets.map((_, i) => xCenter(i));
  const { activeIndex, svgRef, containerHandlers } = useChartTooltip(xPositions, VIEW_BOX_W);
  const [legendOpen, setLegendOpen] = useState(false);
  const [legendIndex, setLegendIndex] = useState(0);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const legendButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const legendTriggerIndexRef = useRef(0);

  function closeLegend({ restoreFocus = false }: { restoreFocus?: boolean } = {}) {
    setLegendOpen(false);
    if (restoreFocus) {
      legendButtonRefs.current[legendTriggerIndexRef.current]?.focus();
    }
  }

  useEffect(() => {
    if (!legendOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!legendRef.current?.contains(event.target as Node)) {
        closeLegend();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeLegend({ restoreFocus: true });
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [legendOpen]);

  const activeLegendItem = TRAINING_STATUS_LEGEND_ITEMS[legendIndex] ?? TRAINING_STATUS_LEGEND_ITEMS[0];

  function showLegendItem(index: number) {
    legendTriggerIndexRef.current = index;
    setLegendIndex(index);
    setLegendOpen(true);
  }

  const maxLabels = Math.min(n, 8);
  const xLabelIndices: number[] = [];
  if (n <= maxLabels) {
    for (let i = 0; i < n; i++) xLabelIndices.push(i);
  } else {
    for (let i = 0; i < maxLabels; i++) {
      xLabelIndices.push(Math.round((i / (maxLabels - 1)) * (n - 1)));
    }
  }

  return (
    <div className="strava-chart-card">
      <div className="strava-chart-header">
        <h3 className="strava-chart-label">Training Status</h3>
        <div className="wellness-status-legend" ref={legendRef}>
          <div className="wellness-status-legend-swatches" role="group" aria-label="Training status legend">
            {TRAINING_STATUS_LEGEND_ITEMS.map((item, index) => (
              <button
                key={item.status}
                type="button"
                ref={(node) => {
                  legendButtonRefs.current[index] = node;
                }}
                className={`wellness-status-legend-swatch ${legendOpen && legendIndex === index ? 'active' : ''}`.trim()}
                style={{ background: item.color }}
                onPointerDown={() => showLegendItem(index)}
                onMouseEnter={() => legendOpen && setLegendIndex(index)}
                onPointerMove={() => legendOpen && setLegendIndex(index)}
                onFocus={() => legendOpen && setLegendIndex(index)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    showLegendItem(index);
                  }
                }}
                aria-label={item.label}
                aria-controls={legendOpen && legendIndex === index ? 'training-status-legend-popover' : undefined}
                aria-expanded={legendOpen && legendIndex === index}
              />
            ))}
          </div>
          {legendOpen && (
            <div
              id="training-status-legend-popover"
              className="wellness-status-legend-popover"
              role="tooltip"
            >
              <span className="wellness-status-legend-popover-value" aria-live="polite">
                <span className="wellness-status-legend-dot" style={{ background: activeLegendItem.color }} />
                {activeLegendItem.label}
              </span>
              <span className="wellness-status-legend-popover-hint">Hover or swipe across the colors.</span>
            </div>
          )}
        </div>
      </div>

      <div className="strava-chart-container" {...containerHandlers}>
        <svg
          ref={svgRef}
          className="strava-chart-svg"
          viewBox={`0 0 ${VIEW_BOX_W} ${CHART_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* X-axis labels */}
          {xLabelIndices.map((i) => (
            <text
              key={`xlbl-${i}`}
              x={xCenter(i)} y={CHART_HEIGHT - 4}
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
              y={barTop}
              width={Math.max(barInner, 1)}
              height={STATUS_BAR_H}
              fill={trainingStatusColor(b.status)}
              opacity={i === activeIndex ? 1 : 0.75}
              rx={2}
            />
          ))}

          {activeIndex !== null && (
            <line
              x1={xCenter(activeIndex)} y1={CHART_PADDING.top}
              x2={xCenter(activeIndex)} y2={CHART_PADDING.top + PLOT_H}
              className="chart-crosshair"
            />
          )}
        </svg>

        {activeIndex !== null && activeIndex < buckets.length && (
          <div
            className="chart-tooltip"
            style={{ left: `${(xCenter(activeIndex) / VIEW_BOX_W) * 100}%` }}
          >
            <span className="chart-tooltip-value">
              {formatTrainingStatusLabel(buckets[activeIndex].status)}
            </span>
            <span className="chart-tooltip-date">{buckets[activeIndex].label}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main view                                                          */
/* ------------------------------------------------------------------ */

interface Props {
  entries: GarminWellnessEntry[];
  range: WellnessTimeRange;
  aggregation: WellnessAggregation;
  embedded?: boolean;
}

export function GarminWellnessView({ entries, range, aggregation, embedded = false }: Props) {
  const today = useMemo(() => new Date(), []);

  // Build chart data
  const readinessData   = useMemo(() => buildWellnessChartData(entries, 'readinessScore',       range, aggregation, today), [entries, range, aggregation, today]);
  const statusData      = useMemo(() => buildStatusChartData(entries, range, aggregation, today), [entries, range, aggregation, today]);
  const trainingLoadRatioData = useMemo(() => buildTrainingLoadRatioChartData(entries, range, aggregation, today), [entries, range, aggregation, today]);
  const vo2Data         = useMemo(() => buildWellnessChartData(entries, 'vo2Max',               range, aggregation, today), [entries, range, aggregation, today]);
  const hillData        = useMemo(() => buildWellnessChartData(entries, 'hillScore',            range, aggregation, today), [entries, range, aggregation, today]);
  const enduranceData   = useMemo(() => buildWellnessChartData(entries, 'enduranceScore',       range, aggregation, today), [entries, range, aggregation, today]);

  const hrvData         = useMemo(() => buildWellnessChartData(entries, 'hrvWeeklyAvg',         range, aggregation, today, 'hrvStatus'), [entries, range, aggregation, today]);
  const rhrData         = useMemo(() => buildWellnessChartData(entries, 'restingHR',            range, aggregation, today), [entries, range, aggregation, today]);
  const bbHighData      = useMemo(() => buildWellnessChartData(entries, 'bodyBatteryHigh',      range, aggregation, today), [entries, range, aggregation, today]);
  const bbLowData       = useMemo(() => buildWellnessChartData(entries, 'bodyBatteryLow',       range, aggregation, today), [entries, range, aggregation, today]);
  const bbRangeBuckets  = useMemo(
    () =>
      bbHighData.buckets.map((highBucket, index) => {
        const lowBucket = bbLowData.buckets[index];
        return {
          label: highBucket.label,
          min: lowBucket?.value ?? null,
          max: highBucket.value,
        };
      }),
    [bbHighData.buckets, bbLowData.buckets],
  );

  const sleepDurData    = useMemo(() => buildWellnessChartData(entries, 'sleepDurationSec',     range, aggregation, today), [entries, range, aggregation, today]);
  const sleepScoreData  = useMemo(() => buildWellnessChartData(entries, 'sleepScore',           range, aggregation, today), [entries, range, aggregation, today]);

  const stepsData       = useMemo(() => buildWellnessChartData(entries, 'steps',                range, aggregation, today), [entries, range, aggregation, today]);
  const floorsData      = useMemo(() => buildWellnessChartData(entries, 'floors',               range, aggregation, today), [entries, range, aggregation, today]);
  const modMinData      = useMemo(() => buildWellnessChartData(entries, 'intensityMinModerate', range, aggregation, today), [entries, range, aggregation, today]);
  const vigMinData      = useMemo(() => buildWellnessChartData(entries, 'intensityMinVigorous', range, aggregation, today), [entries, range, aggregation, today]);

  if (entries.length === 0) {
    return (
      <div className={embedded ? 'strava-subview' : 'strava-view'}>
        <div className="strava-empty">
          No wellness data yet. Run the Garmin Wellness sync to populate the &apos;Stronger - Garmin Wellness&apos; tab.
        </div>
      </div>
    );
  }

  function summaryStr(value: number | null, metric: Parameters<typeof formatWellnessValue>[1], unit: string): string {
    if (value === null) return '';
    return `${formatWellnessValue(value, metric)}${unit ? ` ${unit}` : ''}`;
  }
  const summaryValue = (data: WellnessChartData): number | null =>
    aggregation === 'day' ? data.latestValue : data.summary;
  const latestBodyBatteryRange = [...bbRangeBuckets].reverse().find((bucket) => bucket.min !== null || bucket.max !== null);

  const numFmt = (metric: Parameters<typeof formatWellnessValue>[1]) =>
    (v: number | null) => formatWellnessValue(v, metric);

  return (
    <div className={embedded ? 'strava-subview' : 'strava-view'}>
      {/* Section: Training */}
      <h2 className="strava-section-title">Training</h2>
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.readinessScore}
        unit={WELLNESS_METRIC_UNITS.readinessScore}
        buckets={readinessData.buckets}
        summaryLabel={summaryStr(summaryValue(readinessData), 'readinessScore', '')}
        colorFn={(v) => v !== null ? readinessColor(v) : GRAY}
        formatValue={numFmt('readinessScore')}
      />
      <WellnessStatusBarChart buckets={statusData.buckets} />
      <WellnessBarChart
        label="Acute:Chronic Load Ratio"
        unit=""
        buckets={trainingLoadRatioData.buckets}
        summaryLabel={formatWellnessRatio(summaryValue(trainingLoadRatioData))}
        colorFn={(v) => v !== null ? trainingLoadRatioColor(v) : GRAY}
        formatValue={formatWellnessRatio}
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.vo2Max}
        unit={WELLNESS_METRIC_UNITS.vo2Max}
        buckets={vo2Data.buckets}
        summaryLabel={summaryStr(summaryValue(vo2Data), 'vo2Max', WELLNESS_METRIC_UNITS.vo2Max)}
        colorFn={(v) => v !== null ? vo2MaxColor(v) : GRAY}
        formatValue={numFmt('vo2Max')}
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.hillScore}
        unit={WELLNESS_METRIC_UNITS.hillScore}
        buckets={hillData.buckets}
        summaryLabel={summaryStr(summaryValue(hillData), 'hillScore', '')}
        colorFn={(v) => v !== null ? hillScoreColor(v) : GRAY}
        formatValue={numFmt('hillScore')}
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.enduranceScore}
        unit={WELLNESS_METRIC_UNITS.enduranceScore}
        buckets={enduranceData.buckets}
        summaryLabel={summaryStr(summaryValue(enduranceData), 'enduranceScore', '')}
        colorFn={(v) => v !== null ? enduranceScoreColor(v) : GRAY}
        formatValue={numFmt('enduranceScore')}
      />

      {/* Section: Recovery */}
      <h2 className="strava-section-title">Recovery</h2>
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.hrvWeeklyAvg}
        unit={WELLNESS_METRIC_UNITS.hrvWeeklyAvg}
        buckets={hrvData.buckets}
        summaryLabel={summaryStr(summaryValue(hrvData), 'hrvWeeklyAvg', WELLNESS_METRIC_UNITS.hrvWeeklyAvg)}
        colorFn={(_, key) => key ? hrvStatusColor(key) : ACCENT}
        formatValue={numFmt('hrvWeeklyAvg')}
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.restingHR}
        unit={WELLNESS_METRIC_UNITS.restingHR}
        buckets={rhrData.buckets}
        summaryLabel={summaryStr(summaryValue(rhrData), 'restingHR', WELLNESS_METRIC_UNITS.restingHR)}
        formatValue={numFmt('restingHR')}
      />
      <WellnessRangeBarChart
        label="Body Battery Range"
        unit=""
        buckets={bbRangeBuckets}
        summaryLabel={
          aggregation === 'day'
            ? (latestBodyBatteryRange && (latestBodyBatteryRange.min !== null || latestBodyBatteryRange.max !== null)
                ? `${formatWellnessValue(latestBodyBatteryRange.min, 'bodyBatteryLow')}–${formatWellnessValue(latestBodyBatteryRange.max, 'bodyBatteryHigh')}`
                : '')
            : (bbLowData.summary !== null && bbHighData.summary !== null
                ? `Avg ${formatWellnessValue(bbLowData.summary, 'bodyBatteryLow')}–${formatWellnessValue(bbHighData.summary, 'bodyBatteryHigh')}`
                : '')
        }
        formatValue={numFmt('bodyBatteryHigh')}
      />

      {/* Section: Sleep */}
      <h2 className="strava-section-title">Sleep</h2>
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.sleepDurationSec}
        unit={WELLNESS_METRIC_UNITS.sleepDurationSec}
        buckets={sleepDurData.buckets}
        summaryLabel={summaryStr(summaryValue(sleepDurData), 'sleepDurationSec', WELLNESS_METRIC_UNITS.sleepDurationSec)}
        formatValue={numFmt('sleepDurationSec')}
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.sleepScore}
        unit={WELLNESS_METRIC_UNITS.sleepScore}
        buckets={sleepScoreData.buckets}
        summaryLabel={summaryStr(summaryValue(sleepScoreData), 'sleepScore', '')}
        formatValue={numFmt('sleepScore')}
        colorFn={(v) => v !== null ? sleepScoreColor(v) : GRAY}
      />

      {/* Section: Activity */}
      <h2 className="strava-section-title">Activity</h2>
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.steps}
        unit={WELLNESS_METRIC_UNITS.steps}
        buckets={stepsData.buckets}
        summaryLabel={summaryStr(summaryValue(stepsData), 'steps', '')}
        formatValue={numFmt('steps')}
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.floors}
        unit={WELLNESS_METRIC_UNITS.floors}
        buckets={floorsData.buckets}
        summaryLabel={summaryStr(summaryValue(floorsData), 'floors', '')}
        formatValue={numFmt('floors')}
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.intensityMinModerate}
        unit={WELLNESS_METRIC_UNITS.intensityMinModerate}
        buckets={modMinData.buckets}
        summaryLabel={summaryStr(summaryValue(modMinData), 'intensityMinModerate', WELLNESS_METRIC_UNITS.intensityMinModerate)}
        formatValue={numFmt('intensityMinModerate')}
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.intensityMinVigorous}
        unit={WELLNESS_METRIC_UNITS.intensityMinVigorous}
        buckets={vigMinData.buckets}
        summaryLabel={summaryStr(summaryValue(vigMinData), 'intensityMinVigorous', WELLNESS_METRIC_UNITS.intensityMinVigorous)}
        formatValue={numFmt('intensityMinVigorous')}
      />
    </div>
  );
}
