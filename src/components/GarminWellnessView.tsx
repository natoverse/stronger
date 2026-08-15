/**
 * GarminWellnessView — scrollable page of charts for daily Garmin wellness
 * metrics (HRV, sleep, training status/readiness/load, body battery, steps,
 * floors, intensity minutes, VO2 max, hill/endurance scores, RHR).
 *
 * Reuses the same CSS classes as StravaView (strava-chart-card, strava-bar, etc.)
 * and the same aggregation engine from strava.ts via wellness.ts.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { GarminWellnessEntry } from '../model/types.js';
import type { WellnessAggregation, WellnessTimeRange, WellnessBucket, WellnessStatusBucket, WellnessChartData, StackedCaloriesBucket, LoadFocusBucket, LoadFocusArea } from '../model/wellness.js';
import {
  buildWellnessChartData,
  buildTrainingLoadRatioChartData,
  buildStatusChartData,
  buildIntensityMinCombinedChartData,
  buildStackedCaloriesChartData,
  buildLoadFocusChartData,
  LOAD_FOCUS_AREA_LABELS,
  formatWellnessRatio,
  formatWellnessValue,
  WELLNESS_METRIC_LABELS,
  WELLNESS_METRIC_UNITS,
  goalColor,
  goalColorFromKey,
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

interface ThresholdBand {
  max: number;
  color: string;
  label: string;
}

interface LegendItem {
  range?: string;
  label: string;
  color?: string;
}

function thresholdColor(value: number, thresholds: ThresholdBand[], fallback: string): string {
  for (const { max, color } of thresholds) {
    if (value < max) return color;
  }
  return fallback;
}

function thresholdLabel(value: number, thresholds: ThresholdBand[], fallback: string): string {
  for (const { max, label } of thresholds) {
    if (value < max) return label;
  }
  return fallback;
}

const TRAINING_READINESS_BANDS: ThresholdBand[] = [
  { max: 25, color: ACCENT, label: 'Poor' },
  { max: 50, color: ORANGE, label: 'Low' },
  { max: 75, color: YELLOW, label: 'Moderate' },
  { max: 95, color: GREEN, label: 'High' },
];

export const TRAINING_READINESS_LEGEND_ITEMS: LegendItem[] = [
  { range: '95+', label: 'Prime', color: BLUE },
  { range: '<95', label: 'High', color: GREEN },
  { range: '<75', label: 'Moderate', color: YELLOW },
  { range: '<50', label: 'Low', color: ORANGE },
  { range: '<25', label: 'Poor', color: ACCENT },
];

function readinessColor(v: number): string {
  return thresholdColor(v, TRAINING_READINESS_BANDS, BLUE);
}

export function readinessLegendLabel(v: number): string {
  return thresholdLabel(v, TRAINING_READINESS_BANDS, 'Prime');
}

const LOAD_RATIO_BANDS: ThresholdBand[] = [
  { max: 0.8, color: YELLOW, label: 'Low' },
  { max: 1.5, color: GREEN, label: 'Optimal' },
];

export const LOAD_RATIO_LEGEND_ITEMS: LegendItem[] = [
  { range: '1.5+', label: 'High', color: ACCENT },
  { range: '<1.5', label: 'Optimal', color: GREEN },
  { range: '<0.8', label: 'Low', color: YELLOW },
];

function trainingLoadRatioColor(v: number): string {
  return thresholdColor(v, LOAD_RATIO_BANDS, ACCENT);
}

export function trainingLoadRatioLegendLabel(v: number): string {
  return thresholdLabel(v, LOAD_RATIO_BANDS, 'High');
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

interface TrainingStatusLegendItem {
  status: string;
  label: string;
  color: string;
}

export const TRAINING_STATUS_LEGEND_ITEMS: TrainingStatusLegendItem[] = [
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

export function hrvStatusLegendLabel(status: string): string {
  if (!status) return 'Unknown';
  return formatTrainingStatusLabel(status);
}

export const HRV_STATUS_LEGEND_ITEMS: LegendItem[] = [
  { label: 'Balanced', color: GREEN },
  { label: 'Unbalanced', color: YELLOW },
  { label: 'Low', color: RED },
  { label: 'Optimal', color: GREEN },
];

const VO2_MAX_BANDS: ThresholdBand[] = [
  { max: 38.5, color: RED, label: 'Poor' },
  { max: 42.5, color: ORANGE, label: 'Fair' },
  { max: 46.4, color: GREEN, label: 'Good' },
  { max: 52.5, color: BLUE, label: 'Excellent' },
];

export const VO2_MAX_LEGEND_ITEMS: LegendItem[] = [
  { range: '52.5+', label: 'Superior', color: PURPLE },
  { range: '<52.5', label: 'Excellent', color: BLUE },
  { range: '<46.4', label: 'Good', color: GREEN },
  { range: '<42.5', label: 'Fair', color: ORANGE },
  { range: '<38.5', label: 'Poor', color: RED },
];

export function vo2MaxColor(value: number): string {
  return thresholdColor(value, VO2_MAX_BANDS, PURPLE);
}

export function vo2MaxLegendLabel(value: number): string {
  return thresholdLabel(value, VO2_MAX_BANDS, 'Superior');
}

const HILL_SCORE_BANDS: ThresholdBand[] = [
  { max: 25, color: RED, label: 'Recreational' },
  { max: 50, color: ORANGE, label: 'Challenger' },
  { max: 69, color: GREEN, label: 'Trained' },
  { max: 85, color: BLUE, label: 'Skilled' },
  { max: 95, color: PURPLE, label: 'Expert' },
];

export const HILL_SCORE_LEGEND_ITEMS: LegendItem[] = [
  { range: '95+', label: 'Elite', color: ACCENT },
  { range: '<95', label: 'Expert', color: PURPLE },
  { range: '<85', label: 'Skilled', color: BLUE },
  { range: '<69', label: 'Trained', color: GREEN },
  { range: '<50', label: 'Challenger', color: ORANGE },
  { range: '<25', label: 'Recreational', color: RED },
];

export function hillScoreColor(value: number): string {
  return thresholdColor(value, HILL_SCORE_BANDS, ACCENT);
}

export function hillScoreLegendLabel(value: number): string {
  return thresholdLabel(value, HILL_SCORE_BANDS, 'Elite');
}

// Sleep score bands: <60 red, <80 orange, <90 green, 90+ blue.
const SLEEP_SCORE_BANDS: ThresholdBand[] = [
  { max: 60, color: RED, label: 'Poor' },
  { max: 80, color: ORANGE, label: 'Fair' },
  { max: 90, color: GREEN, label: 'Good' },
];

export const SLEEP_SCORE_LEGEND_ITEMS: LegendItem[] = [
  { range: '90+', label: 'Excellent', color: BLUE },
  { range: '<90', label: 'Good', color: GREEN },
  { range: '<80', label: 'Fair', color: ORANGE },
  { range: '<60', label: 'Poor', color: RED },
];

export function sleepScoreColor(value: number): string {
  return thresholdColor(value, SLEEP_SCORE_BANDS, BLUE);
}

export function sleepScoreLegendLabel(value: number): string {
  return thresholdLabel(value, SLEEP_SCORE_BANDS, 'Excellent');
}

const ENDURANCE_SCORE_BANDS: ThresholdBand[] = [
  { max: 5000, color: RED, label: 'Recreational' },
  { max: 5700, color: ORANGE, label: 'Intermediate' },
  { max: 6400, color: YELLOW, label: 'Trained' },
  { max: 7000, color: GREEN, label: 'Well-trained' },
  { max: 7700, color: BLUE, label: 'Expert' },
  { max: 8400, color: PURPLE, label: 'Superior' },
];

export const ENDURANCE_SCORE_LEGEND_ITEMS: LegendItem[] = [
  { range: '8400+', label: 'Elite', color: ACCENT },
  { range: '<8400', label: 'Superior', color: PURPLE },
  { range: '<7700', label: 'Expert', color: BLUE },
  { range: '<7000', label: 'Well-trained', color: GREEN },
  { range: '<6400', label: 'Trained', color: YELLOW },
  { range: '<5700', label: 'Intermediate', color: ORANGE },
  { range: '<5000', label: 'Recreational', color: RED },
];

export function enduranceScoreColor(value: number): string {
  return thresholdColor(value, ENDURANCE_SCORE_BANDS, ACCENT);
}

export function enduranceScoreLegendLabel(value: number): string {
  return thresholdLabel(value, ENDURANCE_SCORE_BANDS, 'Elite');
}

// Stress bands: 0–25 Rest (blue), 26–50 Low (yellow), 51–75 Medium (orange), 76–100 High (red).
const STRESS_BANDS: ThresholdBand[] = [
  { max: 26, color: BLUE, label: 'Rest' },
  { max: 51, color: YELLOW, label: 'Low' },
  { max: 76, color: ORANGE, label: 'Medium' },
];

export const STRESS_LEGEND_ITEMS: LegendItem[] = [
  { range: '76–100', label: 'High', color: RED },
  { range: '51–75', label: 'Medium', color: ORANGE },
  { range: '26–50', label: 'Low', color: YELLOW },
  { range: '0–25', label: 'Rest', color: BLUE },
];

export function stressColor(value: number): string {
  return thresholdColor(value, STRESS_BANDS, RED);
}

export function stressLegendLabel(value: number): string {
  return thresholdLabel(value, STRESS_BANDS, 'High');
}

export const GOAL_COLOR_LEGEND_ITEMS: LegendItem[] = [
  { label: 'Exceeded (>125%)', color: BLUE },
  { label: 'Goal met', color: GREEN },
  { label: 'Below goal', color: YELLOW },
];

// Load focus: color the daily load bar by where it sits vs. the optimal range.
const LOAD_FOCUS_BELOW = YELLOW;
const LOAD_FOCUS_IN = GREEN;
const LOAD_FOCUS_ABOVE = ORANGE;
const LOAD_FOCUS_BAND = GRAY;

/** Color a load value by its position relative to the optimal [min, max] band. */
export function loadFocusColor(value: number | null, min: number | null, max: number | null): string {
  if (value === null) return GRAY;
  if (max !== null && value > max) return LOAD_FOCUS_ABOVE;
  if (min !== null && value < min) return LOAD_FOCUS_BELOW;
  if (min !== null || max !== null) return LOAD_FOCUS_IN;
  return ACCENT;
}

const LOAD_FOCUS_LEGEND_ITEMS: LegendItem[] = [
  { label: 'Above optimal range', color: LOAD_FOCUS_ABOVE },
  { label: 'In optimal range', color: LOAD_FOCUS_IN },
  { label: 'Below optimal range', color: LOAD_FOCUS_BELOW },
];

/* ------------------------------------------------------------------ */
/*  Chart constants (same as StravaView)                              */
/* ------------------------------------------------------------------ */

const CHART_HEIGHT = 132;
const CHART_PADDING = { top: 16, right: 16, bottom: 32, left: 52 };
const VIEW_BOX_W = 400;
const PLOT_W = VIEW_BOX_W - CHART_PADDING.left - CHART_PADDING.right;
const PLOT_H = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
const METERS_TO_FEET = 3.28084;

export function metersToFeet(meters: number | null): number | null {
  return meters === null ? null : meters * METERS_TO_FEET;
}

export function formatAltitudeFeet(meters: number | null): string {
  const feet = metersToFeet(meters);
  return feet === null ? '—' : Math.round(feet).toLocaleString('en-US');
}

interface WellnessChartHeaderProps {
  label: string;
  summaryLabel?: string;
  legendItems?: LegendItem[];
}

function WellnessChartHeader({ label, summaryLabel, legendItems }: WellnessChartHeaderProps) {
  const [legendOpen, setLegendOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const legendId = useId();

  useEffect(() => {
    if (!legendOpen) return;

    function handleClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setLegendOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setLegendOpen(false);
      }
    }

    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [legendOpen]);

  return (
    <div className="strava-chart-header" ref={containerRef}>
      <h3 className="strava-chart-label">
        {legendItems ? (
          <button
            type="button"
            className="wellness-legend-trigger"
            onClick={() => setLegendOpen((open) => !open)}
            aria-expanded={legendOpen}
            aria-controls={legendId}
          >
            {label}
          </button>
        ) : (
          label
        )}
        {summaryLabel ? <span className="strava-chart-total">{summaryLabel}</span> : null}
      </h3>
      {legendItems && legendOpen ? (
        <div
          id={legendId}
          className="wellness-legend-popover"
          role="tooltip"
        >
          {legendItems.map((item) => (
            <div key={`${item.range ?? 'label'}-${item.label}`} className="wellness-legend-item">
              {item.range ? <span className="wellness-legend-range">{item.range}</span> : null}
              <span className="wellness-legend-label-group">
                {item.color ? <span className="wellness-legend-swatch" style={{ background: item.color }} /> : null}
                <span className="wellness-legend-value">{item.label}</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

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
  legendItems?: LegendItem[];
  /** Per-value color function. Falls back to ACCENT. */
  colorFn?: (value: number | null, colorKey?: string) => string;
  formatValue: (v: number | null) => string;
  renderAsDots?: boolean;
}

function WellnessBarChart({ label, unit, buckets, summaryLabel, legendItems, colorFn, formatValue, renderAsDots = false }: BarChartProps) {
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
      <WellnessChartHeader label={label} summaryLabel={summaryLabel} legendItems={legendItems} />

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

          {/* Values */}
          {buckets.map((b, i) => {
            if (b.value === null) return null;
            const val = b.value;
            const fill = colorFn ? colorFn(b.value, b.colorKey) : ACCENT;
            if (renderAsDots) {
              return (
                <circle
                  key={`dot-${i}`}
                  cx={xCenter(i)}
                  cy={yBar(val)}
                  r={i === activeIndex ? (n > 20 ? 9 : 12) : (n > 20 ? 4.5 : 7.5)}
                  fill={fill}
                  opacity={i === activeIndex ? 1 : 0.75}
                />
              );
            }
            const barH = Math.max((val / maxBar) * PLOT_H, 0);
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

interface AltitudeChartProps {
  altitudeBuckets: WellnessBucket[];
  acclimationBuckets: WellnessBucket[];
  summaryLabel: string;
}

function WellnessAltitudeChart({ altitudeBuckets, acclimationBuckets, summaryLabel }: AltitudeChartProps) {
  const n = altitudeBuckets.length;
  if (n === 0) return null;

  const altitudeFeet = altitudeBuckets.map((bucket) => metersToFeet(bucket.value));
  const acclimationFeet = acclimationBuckets.map((bucket) => metersToFeet(bucket.value));
  const maxValue = Math.max(
    ...altitudeFeet.map((value) => value ?? 0),
    ...acclimationFeet.map((value) => value ?? 0),
    0.001,
  );
  const barWidth = PLOT_W / n;
  const barGap = Math.max(1, barWidth * 0.15);
  const barInner = barWidth - barGap * 2;
  const xCenter = (i: number) => CHART_PADDING.left + barWidth * i + barWidth / 2;
  const yValue = (value: number) => CHART_PADDING.top + PLOT_H - (value / maxValue) * PLOT_H;
  const yTicks = niceTicksFor(0, maxValue, 4);
  const maxLabels = Math.min(n, 8);
  const xLabelIndices = n <= maxLabels
    ? Array.from({ length: n }, (_, i) => i)
    : Array.from({ length: maxLabels }, (_, i) => Math.round((i / (maxLabels - 1)) * (n - 1)));
  const lineSegments: string[] = [];
  let currentSegment: string[] = [];
  acclimationFeet.forEach((value, i) => {
    if (value === null) {
      if (currentSegment.length > 1) lineSegments.push(currentSegment.join(' '));
      currentSegment = [];
    } else {
      currentSegment.push(`${xCenter(i)},${yValue(value)}`);
    }
  });
  if (currentSegment.length > 1) lineSegments.push(currentSegment.join(' '));

  const xPositions = altitudeBuckets.map((_, i) => xCenter(i));
  const { activeIndex, svgRef, containerHandlers } = useChartTooltip(xPositions, VIEW_BOX_W);
  const activeAltitude = activeIndex === null ? null : altitudeBuckets[activeIndex]?.value ?? null;
  const activeAcclimation = activeIndex === null ? null : acclimationBuckets[activeIndex]?.value ?? null;

  return (
    <div className="strava-chart-card">
      <WellnessChartHeader
        label="Altitude Acclimation"
        summaryLabel={summaryLabel}
        legendItems={[
          { label: 'Current altitude', color: ACCENT },
          { label: 'Altitude adaptation', color: BLUE },
        ]}
      />
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
              x1={CHART_PADDING.left} y1={yValue(tick)}
              x2={VIEW_BOX_W - CHART_PADDING.right} y2={yValue(tick)}
              className="strava-grid-line"
            />
          ))}
          {yTicks.map((tick) => (
            <text
              key={`lbl-${tick}`}
              x={CHART_PADDING.left - 4} y={yValue(tick)}
              className="strava-axis-label"
              textAnchor="end"
              dominantBaseline="middle"
            >
              {Math.round(tick).toLocaleString('en-US')}
            </text>
          ))}
          {xLabelIndices.map((i) => (
            <text
              key={`xlbl-${i}`}
              x={xCenter(i)} y={CHART_HEIGHT - 4}
              className="strava-axis-label"
              textAnchor="middle"
            >
              {altitudeBuckets[i].label}
            </text>
          ))}
          {altitudeFeet.map((value, i) => {
            const barHeight = value === null ? 0 : Math.max((value / maxValue) * PLOT_H, 0);
            return (
              <rect
                key={`bar-${i}`}
                x={CHART_PADDING.left + barWidth * i + barGap}
                y={CHART_PADDING.top + PLOT_H - barHeight}
                width={Math.max(barInner, 1)}
                height={barHeight}
                fill={ACCENT}
                opacity={i === activeIndex ? 1 : 0.65}
                rx={2}
              />
            );
          })}
          {lineSegments.map((points, i) => (
            <polyline
              key={`line-${i}`}
              points={points}
              fill="none"
              stroke={BLUE}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
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
        {activeIndex !== null && activeIndex < altitudeBuckets.length && (
          <div
            className="chart-tooltip"
            style={{ left: `${(xCenter(activeIndex) / VIEW_BOX_W) * 100}%` }}
          >
            <span className="chart-tooltip-value">Altitude {formatAltitudeFeet(activeAltitude)} ft</span>
            <span className="chart-tooltip-secondary">Adapted {formatAltitudeFeet(activeAcclimation)} ft</span>
            <span className="chart-tooltip-date">{altitudeBuckets[activeIndex].label}</span>
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
  legendItems?: LegendItem[];
  formatValue: (v: number | null) => string;
}

function WellnessRangeBarChart({ label, unit, buckets, summaryLabel, legendItems, formatValue }: RangeBarChartProps) {
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
      <WellnessChartHeader label={label} summaryLabel={summaryLabel} legendItems={legendItems} />

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
/*  WellnessLoadFocusChart — daily load dots with optimal-range band   */
/* ------------------------------------------------------------------ */

interface LoadFocusChartProps {
  label: string;
  buckets: LoadFocusBucket[];
  summaryLabel: string;
  legendItems?: LegendItem[];
  formatValue: (v: number | null) => string;
}

function WellnessLoadFocusChart({ label, buckets, summaryLabel, legendItems, formatValue }: LoadFocusChartProps) {
  const n = buckets.length;
  if (n === 0) return null;

  // Y domain spans 0 → max of every value/min/max so dots and band both fit.
  const domainValues = buckets.flatMap((b) => [b.value, b.min, b.max]).filter((v): v is number => v !== null);
  const maxBar = domainValues.length > 0 ? Math.max(...domainValues, 0.001) : 0.001;

  const barWidth = PLOT_W / n;

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
  const activeBucket = activeIndex === null ? null : buckets[activeIndex] ?? null;
  const activeTooltipValue = activeBucket === null || activeBucket.value === null
    ? '—'
    : formatValue(activeBucket.value);
  const activeTooltipRange = activeBucket && (activeBucket.min !== null || activeBucket.max !== null)
    ? `optimal ${formatValue(activeBucket.min)}–${formatValue(activeBucket.max)}`
    : '';

  return (
    <div className="strava-chart-card">
      <WellnessChartHeader label={label} summaryLabel={summaryLabel} legendItems={legendItems} />

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
              x1={CHART_PADDING.left} y1={yBar(tick)}
              x2={VIEW_BOX_W - CHART_PADDING.right} y2={yBar(tick)}
              className="strava-grid-line"
            />
          ))}

          {yTicks.map((tick) => (
            <text
              key={`lbl-${tick}`}
              x={CHART_PADDING.left - 4} y={yBar(tick)}
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

          {/* Optimal-range band shading (per-bucket, shifts daily) */}
          {buckets.map((b, i) => {
            if (b.min === null && b.max === null) return null;
            const low = Math.min(b.min ?? b.max!, b.max ?? b.min!);
            const high = Math.max(b.min ?? b.max!, b.max ?? b.min!);
            const yTop = yBar(high);
            const yBottom = yBar(low);
            return (
              <rect
                key={`band-${i}`}
                x={CHART_PADDING.left + barWidth * i}
                y={yTop}
                width={barWidth}
                height={Math.max(yBottom - yTop, 1)}
                fill={LOAD_FOCUS_BAND}
                opacity={0.3}
              />
            );
          })}

          {/* Daily load dots */}
          {buckets.map((b, i) => {
            if (b.value === null) return null;
            return (
              <circle
                key={`dot-${i}`}
                cx={xCenter(i)}
                cy={yBar(b.value)}
                r={i === activeIndex ? (n > 20 ? 9 : 12) : (n > 20 ? 4.5 : 7.5)}
                fill={loadFocusColor(b.value, b.min, b.max)}
                opacity={i === activeIndex ? 1 : 0.85}
              />
            );
          })}

          {/* Dynamic min/max reference lines — trace per-bucket optimal range */}
          {(['min', 'max'] as const).map((key) => {
            const cmds: string[] = [];
            let lastWasNull = true;
            for (let i = 0; i < buckets.length; i++) {
              const v = buckets[i][key];
              if (v === null || v > maxBar) { lastWasNull = true; continue; }
              const cmd = lastWasNull ? 'M' : 'L';
              cmds.push(`${cmd} ${xCenter(i)} ${yBar(v)}`);
              lastWasNull = false;
            }
            const d = cmds.join(' ');
            return d ? <path key={key} d={d} className="strava-goal-line" fill="none" /> : null;
          })}

          {activeIndex !== null && (
            <line
              x1={xCenter(activeIndex)} y1={CHART_PADDING.top}
              x2={xCenter(activeIndex)} y2={CHART_PADDING.top + PLOT_H}
              className="chart-crosshair"
            />
          )}
        </svg>

        {activeBucket !== null && (
          <div
            className="chart-tooltip"
            style={{ left: `${(xCenter(activeIndex!) / VIEW_BOX_W) * 100}%` }}
          >
            <span className="chart-tooltip-value">{activeTooltipValue}</span>
            {activeTooltipRange ? <span className="chart-tooltip-value">{activeTooltipRange}</span> : null}
            <span className="chart-tooltip-date">{activeBucket.label}</span>
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

  const maxLabels = Math.min(n, 8);
  const xLabelIndices: number[] = [];
  if (n <= maxLabels) {
    for (let i = 0; i < n; i++) xLabelIndices.push(i);
  } else {
    for (let i = 0; i < maxLabels; i++) {
      xLabelIndices.push(Math.round((i / (maxLabels - 1)) * (n - 1)));
    }
  }

  const latestStatus = (() => {
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (buckets[i].status !== '') return buckets[i].status;
    }
    return '';
  })();

  return (
    <div className="strava-chart-card">
      <WellnessChartHeader
        label="Training Status"
        summaryLabel={latestStatus ? formatTrainingStatusLabel(latestStatus) : undefined}
        legendItems={TRAINING_STATUS_LEGEND_ITEMS.map(({ label, color }) => ({ label, color }))}
      />

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

          {/* Bars — only render when status is known */}
          {buckets.map((b, i) => {
            if (b.status === '') return null;
            return (
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
/*  WellnessStackedCaloriesChart — active + BMR stacked bar + goal    */
/* ------------------------------------------------------------------ */

interface StackedCaloriesChartProps {
  buckets: StackedCaloriesBucket[];
  summaryLabel: string;
  /** Scaled goal line value (kcal). 0 = no line. */
  goalKcal: number;
  aggregation: WellnessAggregation;
}

function WellnessStackedCaloriesChart({ buckets, summaryLabel, goalKcal, aggregation }: StackedCaloriesChartProps) {
  const n = buckets.length;
  if (n === 0) return null;

  // Month uses ×30 as an approximation (same convention as goalColor in wellness.ts).
  const scaledGoal = goalKcal > 0
    ? goalKcal * (aggregation === 'week' ? 7 : aggregation === 'month' ? 30 : 1)
    : 0;

  const maxStackValue = Math.max(...buckets.map((b) => (b.active ?? 0) + (b.bmr ?? 0)), scaledGoal, 0.001);

  const barWidth = PLOT_W / n;
  const barGap = Math.max(1, barWidth * 0.15);
  const barInner = barWidth - barGap * 2;

  const xCenter = (i: number) => CHART_PADDING.left + barWidth * i + barWidth / 2;
  const yBar = (v: number) => CHART_PADDING.top + PLOT_H - (v / maxStackValue) * PLOT_H;

  const yTicks = niceTicksFor(0, maxStackValue, 4);

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

  const legendItems: LegendItem[] = [
    { label: 'Active', color: BLUE },
    { label: 'Resting (BMR)', color: ORANGE },
    ...(scaledGoal > 0 ? [{ label: 'Goal', color: YELLOW }] : []),
  ];

  const activeBucket = activeIndex !== null ? buckets[activeIndex] : null;
  const activeTotal = activeBucket
    ? ((activeBucket.active ?? 0) + (activeBucket.bmr ?? 0))
    : null;

  return (
    <div className="strava-chart-card">
      <WellnessChartHeader label="Calories" summaryLabel={summaryLabel} legendItems={legendItems} />

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
              {Math.round(tick)}
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

          {/* Stacked bars */}
          {buckets.map((b, i) => {
            const bmrVal = b.bmr ?? 0;
            const activeVal = b.active ?? 0;
            const total = bmrVal + activeVal;
            if (total === 0 && b.bmr === null && b.active === null) return null;
            const opacity = i === activeIndex ? 1 : 0.75;
            const bx = CHART_PADDING.left + barWidth * i + barGap;

            // BMR segment (bottom)
            const bmrH = Math.max((bmrVal / maxStackValue) * PLOT_H, 0);
            // Active segment (top)
            const activeH = Math.max((activeVal / maxStackValue) * PLOT_H, 0);

            return (
              <g key={`stack-${i}`}>
                {bmrVal > 0 && (
                  <rect
                    x={bx}
                    y={CHART_PADDING.top + PLOT_H - bmrH}
                    width={Math.max(barInner, 1)}
                    height={bmrH}
                    fill={ORANGE}
                    opacity={opacity}
                    rx={2}
                  />
                )}
                {activeVal > 0 && (
                  <rect
                    x={bx}
                    y={CHART_PADDING.top + PLOT_H - bmrH - activeH}
                    width={Math.max(barInner, 1)}
                    height={activeH}
                    fill={BLUE}
                    opacity={opacity}
                    rx={2}
                  />
                )}
              </g>
            );
          })}

          {/* Goal line */}
          {scaledGoal > 0 && (
            <line
              x1={CHART_PADDING.left}
              y1={yBar(scaledGoal)}
              x2={VIEW_BOX_W - CHART_PADDING.right}
              y2={yBar(scaledGoal)}
              className="strava-goal-line"
            />
          )}

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
        {activeBucket !== null && activeIndex !== null && (
          <div
            className="chart-tooltip"
            style={{ left: `${(xCenter(activeIndex) / VIEW_BOX_W) * 100}%` }}
          >
            <span className="chart-tooltip-value">
              {activeTotal !== null ? `${Math.round(activeTotal)} kcal` : '—'}
            </span>
            <span className="chart-tooltip-date">{activeBucket.label}</span>
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
  /** Daily step goal (0 = no goal). Auto-synced from Garmin. */
  stepsGoal?: number;
  /** Daily floors goal (0 = no goal). Auto-synced from Garmin. */
  floorsGoal?: number;
  /** Weekly intensity minutes goal (0 = no goal). Auto-synced from Garmin. */
  weeklyIntensityMinGoal?: number;
  /** Daily calorie goal (0 = no goal line). From app settings. */
  dailyCalorieGoal?: number;
}

export function GarminWellnessView({ entries, range, aggregation, embedded = false, stepsGoal = 0, floorsGoal = 0, weeklyIntensityMinGoal = 0, dailyCalorieGoal = 0 }: Props) {
  const today = useMemo(() => new Date(), []);

  // Build chart data
  const readinessData   = useMemo(() => buildWellnessChartData(entries, 'readinessScore',       range, aggregation, today), [entries, range, aggregation, today]);
  const statusData      = useMemo(() => buildStatusChartData(entries, range, aggregation, today), [entries, range, aggregation, today]);
  const trainingLoadRatioData = useMemo(() => buildTrainingLoadRatioChartData(entries, range, aggregation, today), [entries, range, aggregation, today]);
  const vo2Data         = useMemo(() => buildWellnessChartData(entries, 'vo2Max',               range, aggregation, today), [entries, range, aggregation, today]);
  const hillData        = useMemo(() => buildWellnessChartData(entries, 'hillScore',            range, aggregation, today), [entries, range, aggregation, today]);
  const enduranceData   = useMemo(() => buildWellnessChartData(entries, 'enduranceScore',       range, aggregation, today), [entries, range, aggregation, today]);
  const heatAcclimationData = useMemo(() => buildWellnessChartData(entries, 'heatAcclimationPct', range, aggregation, today), [entries, range, aggregation, today]);
  const altitudeAcclimationData = useMemo(() => buildWellnessChartData(entries, 'altitudeAcclimationPct', range, aggregation, today), [entries, range, aggregation, today]);
  const currentAltitudeData = useMemo(() => buildWellnessChartData(entries, 'currentAltitude', range, aggregation, today), [entries, range, aggregation, today]);
  const loadFocusData = useMemo(
    () => (['aerobicLow', 'aerobicHigh', 'anaerobic'] as LoadFocusArea[]).map(
      (area) => buildLoadFocusChartData(entries, area, range, aggregation, today),
    ),
    [entries, range, aggregation, today],
  );

  const hrvData         = useMemo(() => buildWellnessChartData(entries, 'hrvWeeklyAvg',         range, aggregation, today, 'hrvStatus'), [entries, range, aggregation, today]);
  const stressData      = useMemo(() => buildWellnessChartData(entries, 'avgStress',            range, aggregation, today), [entries, range, aggregation, today]);
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
  const intensityData   = useMemo(() => buildIntensityMinCombinedChartData(entries, range, aggregation, weeklyIntensityMinGoal, today), [entries, range, aggregation, weeklyIntensityMinGoal, today]);
  const caloriesData    = useMemo(() => buildStackedCaloriesChartData(entries, range, aggregation, today), [entries, range, aggregation, today]);

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
  const latestHrvStatus = [...hrvData.buckets].reverse().find((bucket) => bucket.value !== null && bucket.colorKey)?.colorKey ?? '';
  const withLegendLabel = (summary: string, legend: string | null): string =>
    summary && legend ? `${summary} · ${legend}` : summary;

  const numFmt = (metric: Parameters<typeof formatWellnessValue>[1]) =>
    (v: number | null) => formatWellnessValue(v, metric);

  const loadFocusFmt = (v: number | null) => (v === null ? '—' : String(Math.round(v)));

  return (
    <div className={embedded ? 'strava-subview' : 'strava-view'}>
      {/* Section: Training */}
      <h2 className="strava-section-title">Training</h2>
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.readinessScore}
        unit={WELLNESS_METRIC_UNITS.readinessScore}
        buckets={readinessData.buckets}
        summaryLabel={withLegendLabel(
          summaryStr(summaryValue(readinessData), 'readinessScore', ''),
          aggregation === 'day' && summaryValue(readinessData) !== null ? readinessLegendLabel(summaryValue(readinessData)!) : null,
        )}
        legendItems={TRAINING_READINESS_LEGEND_ITEMS}
        colorFn={(v) => v !== null ? readinessColor(v) : GRAY}
        formatValue={numFmt('readinessScore')}
        renderAsDots
      />
      <WellnessStatusBarChart buckets={statusData.buckets} />
      <WellnessBarChart
        label="Load Ratio"
        unit=""
        buckets={trainingLoadRatioData.buckets}
        summaryLabel={withLegendLabel(
          formatWellnessRatio(summaryValue(trainingLoadRatioData)),
          aggregation === 'day' && summaryValue(trainingLoadRatioData) !== null
            ? trainingLoadRatioLegendLabel(summaryValue(trainingLoadRatioData)!)
            : null,
        )}
        legendItems={LOAD_RATIO_LEGEND_ITEMS}
        colorFn={(v) => v !== null ? trainingLoadRatioColor(v) : GRAY}
        formatValue={formatWellnessRatio}
        renderAsDots
      />
      {loadFocusData.map((data) => {
        const load = aggregation === 'day' ? data.latestValue : data.summary;
        const loadStr = load === null ? '' : String(Math.round(load));
        const rangeStr = data.latestMin !== null || data.latestMax !== null
          ? `optimal ${loadFocusFmt(data.latestMin)}–${loadFocusFmt(data.latestMax)}`
          : '';
        return (
          <WellnessLoadFocusChart
            key={data.area}
            label={LOAD_FOCUS_AREA_LABELS[data.area]}
            buckets={data.buckets}
            summaryLabel={withLegendLabel(loadStr, rangeStr || null)}
            legendItems={LOAD_FOCUS_LEGEND_ITEMS}
            formatValue={loadFocusFmt}
          />
        );
      })}
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.vo2Max}
        unit={WELLNESS_METRIC_UNITS.vo2Max}
        buckets={vo2Data.buckets}
        summaryLabel={withLegendLabel(
          summaryStr(summaryValue(vo2Data), 'vo2Max', WELLNESS_METRIC_UNITS.vo2Max),
          aggregation === 'day' && summaryValue(vo2Data) !== null ? vo2MaxLegendLabel(summaryValue(vo2Data)!) : null,
        )}
        legendItems={VO2_MAX_LEGEND_ITEMS}
        colorFn={(v) => v !== null ? vo2MaxColor(v) : GRAY}
        formatValue={numFmt('vo2Max')}
        renderAsDots
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.hillScore}
        unit={WELLNESS_METRIC_UNITS.hillScore}
        buckets={hillData.buckets}
        summaryLabel={withLegendLabel(
          summaryStr(summaryValue(hillData), 'hillScore', ''),
          aggregation === 'day' && summaryValue(hillData) !== null ? hillScoreLegendLabel(summaryValue(hillData)!) : null,
        )}
        legendItems={HILL_SCORE_LEGEND_ITEMS}
        colorFn={(v) => v !== null ? hillScoreColor(v) : GRAY}
        formatValue={numFmt('hillScore')}
        renderAsDots
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.enduranceScore}
        unit={WELLNESS_METRIC_UNITS.enduranceScore}
        buckets={enduranceData.buckets}
        summaryLabel={withLegendLabel(
          summaryStr(summaryValue(enduranceData), 'enduranceScore', ''),
          aggregation === 'day' && summaryValue(enduranceData) !== null ? enduranceScoreLegendLabel(summaryValue(enduranceData)!) : null,
        )}
        legendItems={ENDURANCE_SCORE_LEGEND_ITEMS}
        colorFn={(v) => v !== null ? enduranceScoreColor(v) : GRAY}
        formatValue={numFmt('enduranceScore')}
        renderAsDots
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.heatAcclimationPct}
        unit={WELLNESS_METRIC_UNITS.heatAcclimationPct}
        buckets={heatAcclimationData.buckets}
        summaryLabel={summaryStr(summaryValue(heatAcclimationData), 'heatAcclimationPct', WELLNESS_METRIC_UNITS.heatAcclimationPct)}
        formatValue={numFmt('heatAcclimationPct')}
      />
      <WellnessAltitudeChart
        altitudeBuckets={currentAltitudeData.buckets}
        acclimationBuckets={altitudeAcclimationData.buckets}
        summaryLabel={[
          summaryValue(currentAltitudeData) === null ? '' : `Altitude ${formatAltitudeFeet(summaryValue(currentAltitudeData))} ft`,
          summaryValue(altitudeAcclimationData) === null ? '' : `Adapted ${formatAltitudeFeet(summaryValue(altitudeAcclimationData))} ft`,
        ].filter(Boolean).join(' · ')}
      />

      {/* Section: Recovery */}
      <h2 className="strava-section-title">Recovery</h2>
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.avgStress}
        unit={WELLNESS_METRIC_UNITS.avgStress}
        buckets={stressData.buckets}
        summaryLabel={withLegendLabel(
          summaryStr(summaryValue(stressData), 'avgStress', WELLNESS_METRIC_UNITS.avgStress),
          aggregation === 'day' && summaryValue(stressData) !== null ? stressLegendLabel(summaryValue(stressData)!) : null,
        )}
        legendItems={STRESS_LEGEND_ITEMS}
        colorFn={(v) => v !== null ? stressColor(v) : GRAY}
        formatValue={numFmt('avgStress')}
      />
      <WellnessBarChart
        label="HRV Status"
        unit={WELLNESS_METRIC_UNITS.hrvWeeklyAvg}
        buckets={hrvData.buckets}
        summaryLabel={withLegendLabel(
          summaryStr(summaryValue(hrvData), 'hrvWeeklyAvg', WELLNESS_METRIC_UNITS.hrvWeeklyAvg),
          aggregation === 'day' ? hrvStatusLegendLabel(latestHrvStatus) : null,
        )}
        legendItems={HRV_STATUS_LEGEND_ITEMS}
        colorFn={(_, key) => key ? hrvStatusColor(key) : ACCENT}
        formatValue={numFmt('hrvWeeklyAvg')}
        renderAsDots
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.restingHR}
        unit={WELLNESS_METRIC_UNITS.restingHR}
        buckets={rhrData.buckets}
        summaryLabel={summaryStr(summaryValue(rhrData), 'restingHR', WELLNESS_METRIC_UNITS.restingHR)}
        formatValue={numFmt('restingHR')}
        renderAsDots
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
        summaryLabel={withLegendLabel(
          summaryStr(summaryValue(sleepScoreData), 'sleepScore', ''),
          aggregation === 'day' && summaryValue(sleepScoreData) !== null ? sleepScoreLegendLabel(summaryValue(sleepScoreData)!) : null,
        )}
        legendItems={SLEEP_SCORE_LEGEND_ITEMS}
        formatValue={numFmt('sleepScore')}
        colorFn={(v) => v !== null ? sleepScoreColor(v) : GRAY}
        renderAsDots
      />

      {/* Section: Activity */}
      <h2 className="strava-section-title">Activity</h2>
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.steps}
        unit={WELLNESS_METRIC_UNITS.steps}
        buckets={stepsData.buckets}
        summaryLabel={summaryStr(summaryValue(stepsData), 'steps', '')}
        formatValue={numFmt('steps')}
        legendItems={stepsGoal > 0 ? GOAL_COLOR_LEGEND_ITEMS : undefined}
        colorFn={(v) => v !== null ? goalColor(v, stepsGoal, aggregation, ACCENT) : GRAY}
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.floors}
        unit={WELLNESS_METRIC_UNITS.floors}
        buckets={floorsData.buckets}
        summaryLabel={summaryStr(summaryValue(floorsData), 'floors', '')}
        formatValue={numFmt('floors')}
        legendItems={floorsGoal > 0 ? GOAL_COLOR_LEGEND_ITEMS : undefined}
        colorFn={(v) => v !== null ? goalColor(v, floorsGoal, aggregation, ACCENT) : GRAY}
      />
      <WellnessBarChart
        label="Intensity Minutes"
        unit={WELLNESS_METRIC_UNITS.intensityMinModerate}
        buckets={intensityData.buckets}
        summaryLabel={summaryStr(summaryValue(intensityData), 'intensityMinModerate', WELLNESS_METRIC_UNITS.intensityMinModerate)}
        formatValue={numFmt('intensityMinModerate')}
        legendItems={weeklyIntensityMinGoal > 0 ? GOAL_COLOR_LEGEND_ITEMS : undefined}
        colorFn={(v, key) => goalColorFromKey(key, v !== null ? ACCENT : GRAY)}
      />
      <WellnessStackedCaloriesChart
        buckets={caloriesData.buckets}
        summaryLabel={(() => {
          const latestVal = aggregation === 'day'
            ? (caloriesData.latestActive !== null || caloriesData.latestBmr !== null
                ? (caloriesData.latestActive ?? 0) + (caloriesData.latestBmr ?? 0)
                : null)
            : caloriesData.summary;
          return latestVal !== null ? `${Math.round(latestVal)} kcal` : '';
        })()}
        goalKcal={dailyCalorieGoal}
        aggregation={aggregation}
      />
    </div>
  );
}
