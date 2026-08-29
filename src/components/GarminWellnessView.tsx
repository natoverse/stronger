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
import type { WellnessAggregation, WellnessTimeRange, WellnessBucket, WellnessStatusBucket, WellnessChartData, StackedCaloriesBucket, WellnessRangeBucket, LoadFocusArea } from '../model/wellness.js';
import {
  buildWellnessChartData,
  buildTrainingLoadRatioChartData,
  buildStatusChartData,
  buildIntensityMinCombinedChartData,
  buildStackedCaloriesChartData,
  buildLoadFocusChartData,
  buildHrvRangeChartData,
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

export function overflowPatternColors(color: string): { background: string; line: string } {
  return { background: color, line: color };
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
  { status: 'PEAKING', label: 'Peaking', color: PURPLE },
  { status: 'PRODUCTIVE', label: 'Productive', color: GREEN },
  { status: 'MAINTAINING', label: 'Maintaining', color: YELLOW },
  { status: 'RECOVERY', label: 'Recovery', color: BLUE },
  { status: 'UNPRODUCTIVE', label: 'Unproductive', color: ORANGE },
  { status: 'STRAINED', label: 'Strained', color: ACCENT },
  { status: 'OVERREACHING', label: 'Overreaching', color: RED },
  { status: 'DETRAINING', label: 'Detraining', color: GRAY },
  { status: 'NO_STATUS', label: 'No status', color: GRAY },
];

export function trainingStatusScore(status: string): number | null {
  const normalized = status.toUpperCase() === 'RECOVERY_ACTIVE'
    ? 'RECOVERY'
    : status.toUpperCase();
  const index = TRAINING_STATUS_LEGEND_ITEMS.findIndex((item) => item.status === normalized);
  return index === -1 ? null : TRAINING_STATUS_LEGEND_ITEMS.length - index;
}

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

/** Sleep buckets are averages in hours, so every aggregation uses the daily goal unchanged. */
export function sleepGoalColor(hours: number, goalHours: number): string {
  return goalColor(hours, goalHours, 'day', ACCENT);
}

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
/*  Y-domain helpers                                                   */
/* ------------------------------------------------------------------ */

export interface ChartDomain {
  min: number;
  max: number;
}

/**
 * Y domain centered on the latest value, padded by `pad` in both directions.
 * Returns null when there is no current value (chart falls back to auto-scale).
 * The lower bound never goes below zero.
 */
export function centeredDomain(current: number | null, pad: number): ChartDomain | null {
  if (current === null || !Number.isFinite(current)) return null;
  return { min: Math.max(0, current - pad), max: current + pad };
}

/**
 * Y domain covering the visible baseline band, padded by `pad` in both
 * directions. Returns null when no bucket has a baseline.
 */
export function baselineDomain(
  buckets: { min: number | null; max: number | null }[],
  pad: number,
): ChartDomain | null {
  const mins = buckets.map((b) => b.min).filter((v): v is number => v !== null);
  const maxs = buckets.map((b) => b.max).filter((v): v is number => v !== null);
  if (mins.length === 0 && maxs.length === 0) return null;
  const low = mins.length > 0 ? Math.min(...mins) : Math.min(...maxs);
  const high = maxs.length > 0 ? Math.max(...maxs) : Math.max(...mins);
  return { min: Math.max(0, low - pad), max: high + pad };
}

/**
 * Bar-axis cap for a goal-based chart: `goal × multiple`, scaled the same way
 * as `goalColor` (week ×7, month ×30). Returns null when the goal is disabled.
 */
export function goalBarCap(
  goal: number,
  multiple: number,
  aggregation: WellnessAggregation,
): number | null {
  if (!(goal > 0)) return null;
  const scale = aggregation === 'week' ? 7 : aggregation === 'month' ? 30 : 1;
  return goal * scale * multiple;
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

/**
 * Ticks constrained to a fixed [min, max] domain. Ticks outside the domain are
 * dropped and the exact bounds are always included so a capped axis reads true.
 */
function domainTicks(min: number, max: number, count: number): number[] {
  const inner = niceTicksFor(min, max, count).filter((t) => t > min && t < max);
  return [min, ...inner, max];
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
  /**
   * Fixed y-axis domain. When set, the axis ignores the data extent: values
   * outside the domain are clamped to the nearest bound, and bars that exceed
   * the top of the domain are drawn with the overflow hatch pattern.
   */
  domain?: ChartDomain | null;
}

function WellnessBarChart({ label, unit, buckets, summaryLabel, legendItems, colorFn, formatValue, renderAsDots = false, domain = null }: BarChartProps) {
  const n = buckets.length;
  const overflowPatternId = useId();
  if (n === 0) return null;

  const dataMax = Math.max(...buckets.map((b) => b.value ?? 0), 0.001);
  const yMin = domain ? domain.min : 0;
  const yMax = domain ? Math.max(domain.max, domain.min + 0.001) : dataMax;
  const span = yMax - yMin;

  const barWidth = PLOT_W / n;
  const barGap = Math.max(1, barWidth * 0.15);
  const barInner = barWidth - barGap * 2;

  const clampY = (v: number) => Math.min(Math.max(v, yMin), yMax);
  const xCenter = (i: number) => CHART_PADDING.left + barWidth * i + barWidth / 2;
  const yBar = (v: number) => CHART_PADDING.top + PLOT_H - ((clampY(v) - yMin) / span) * PLOT_H;

  const yTicks = domain ? domainTicks(yMin, yMax, 4) : niceTicksFor(0, yMax, 4);

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

  const hasCumulative = buckets.some((b) => b.cumulative !== undefined && b.cumulative !== null);
  const cumulativePath = (() => {
    if (!hasCumulative) return '';
    const cmds: string[] = [];
    let lastWasNull = true;
    buckets.forEach((b, i) => {
      if (b.cumulative === undefined || b.cumulative === null) { lastWasNull = true; return; }
      cmds.push(`${lastWasNull ? 'M' : 'L'} ${xCenter(i)} ${yBar(b.cumulative)}`);
      lastWasNull = false;
    });
    return cmds.join(' ');
  })();

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
          {/* Overflow hatches retain the corresponding bar's computed color. */}
          {domain !== null && !renderAsDots && (
            <defs>
              {buckets.map((b, i) => {
                if (b.value === null || b.value <= yMax) return null;
                const fill = colorFn ? colorFn(b.value, b.colorKey) : ACCENT;
                const colors = overflowPatternColors(fill);
                return (
                  <pattern key={`overflow-${i}`} id={`${overflowPatternId}-${i}`} width="6" height="6" patternUnits="userSpaceOnUse">
                    <rect width="6" height="6" fill={colors.background} opacity={0.35} />
                    <path
                      d="M-1 1L1 -1M0 6L6 0M5 7L7 5M-1 5L1 7M0 0L6 6M5 -1L7 1"
                      fill="none"
                      stroke={colors.line}
                      strokeWidth={1.25}
                    />
                  </pattern>
                );
              })}
            </defs>
          )}

          {/* Grid lines */}
          {yTicks.map((tick) => (
            <line
              key={`grid-${tick}`}
              x1={CHART_PADDING.left} y1={yBar(tick)}
              x2={VIEW_BOX_W - CHART_PADDING.right} y2={yBar(tick)}
              className="strava-grid-line"
            />
          ))}

          {/* Week-boundary gridlines (day aggregation only) */}
          {buckets.map((b, i) => (
            b.isWeekStart && i > 0 ? (
              <line
                key={`week-${i}`}
                x1={CHART_PADDING.left + barWidth * i} y1={CHART_PADDING.top}
                x2={CHART_PADDING.left + barWidth * i} y2={CHART_PADDING.top + PLOT_H}
                className="strava-week-boundary-line"
              />
            ) : null
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
                  r={i === activeIndex ? (n > 20 ? 8.1 : 10.8) : (n > 20 ? 4.05 : 6.75)}
                  fill={fill}
                  opacity={i === activeIndex ? 1 : 0.75}
                />
              );
            }
            const barH = Math.max(yBar(yMin) - yBar(val), 0);
            const exceedsDomain = domain !== null && val > yMax;
            return (
              <rect
                key={`bar-${i}`}
                x={CHART_PADDING.left + barWidth * i + barGap}
                y={CHART_PADDING.top + PLOT_H - barH}
                width={Math.max(barInner, 1)}
                height={barH}
                fill={exceedsDomain ? `url(#${overflowPatternId}-${i})` : fill}
                opacity={i === activeIndex ? 1 : 0.75}
                rx={2}
              />
            );
          })}

          {/* Cumulative weekly-total overlay line (day aggregation only) */}
          {cumulativePath && <path d={cumulativePath} className="wellness-cumulative-line" fill="none" />}
          {hasCumulative && buckets.map((b, i) => (
            b.cumulative === undefined || b.cumulative === null ? null : (
              <circle
                key={`cum-dot-${i}`}
                cx={xCenter(i)}
                cy={yBar(b.cumulative)}
                r={i === activeIndex ? 4 : 2.5}
                className={`wellness-cumulative-dot${i === activeIndex ? ' active' : ''}`}
              />
            )
          ))}

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
            {hasCumulative && buckets[activeIndex].cumulative != null && (
              <span className="chart-tooltip-value">
                Week: {formatValue(buckets[activeIndex].cumulative!)}{unit ? ` ${unit}` : ''}
              </span>
            )}
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

interface WellnessMinMaxBucket {
  label: string;
  min: number | null;
  max: number | null;
}

interface RangeBarChartProps {
  label: string;
  unit: string;
  buckets: WellnessMinMaxBucket[];
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
  buckets: WellnessRangeBucket[];
  summaryLabel: string;
  legendItems?: LegendItem[];
  formatValue: (v: number | null) => string;
  rangeLabel?: string;
  colorFn?: (value: number | null, min: number | null, max: number | null, colorKey?: string) => string;
  /** Fixed y-axis domain. When set, values outside it are clamped to the bounds. */
  domain?: ChartDomain | null;
}

function WellnessLoadFocusChart({
  label,
  buckets,
  summaryLabel,
  legendItems,
  formatValue,
  rangeLabel = 'optimal',
  colorFn = loadFocusColor,
  domain = null,
}: LoadFocusChartProps) {
  const n = buckets.length;
  if (n === 0) return null;

  // Y domain spans 0 → max of every value/min/max so dots and band both fit,
  // unless an explicit domain is supplied.
  const domainValues = buckets.flatMap((b) => [b.value, b.min, b.max]).filter((v): v is number => v !== null);
  const autoMax = domainValues.length > 0 ? Math.max(...domainValues, 0.001) : 0.001;
  const yMin = domain ? domain.min : 0;
  const maxBar = domain ? Math.max(domain.max, domain.min + 0.001) : autoMax;
  const span = maxBar - yMin;

  const barWidth = PLOT_W / n;

  const clampY = (v: number) => Math.min(Math.max(v, yMin), maxBar);
  const xCenter = (i: number) => CHART_PADDING.left + barWidth * i + barWidth / 2;
  const yBar = (v: number) => CHART_PADDING.top + PLOT_H - ((clampY(v) - yMin) / span) * PLOT_H;

  const yTicks = domain ? domainTicks(yMin, maxBar, 4) : niceTicksFor(0, maxBar, 4);

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
    ? `${rangeLabel} ${formatValue(activeBucket.min)}–${formatValue(activeBucket.max)}`
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
            if (high < yMin || low > maxBar) return null;
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
                r={i === activeIndex ? (n > 20 ? 8.1 : 10.8) : (n > 20 ? 4.05 : 6.75)}
                fill={colorFn(b.value, b.min, b.max, b.colorKey)}
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
              if (v === null || v > maxBar || v < yMin) { lastWasNull = true; continue; }
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
/*  WellnessStatusBarChart — categorical status dots                  */
/* ------------------------------------------------------------------ */

function WellnessStatusBarChart({ buckets }: { buckets: WellnessStatusBucket[] }) {
  const n = buckets.length;
  if (n === 0) return null;

  const slotWidth = PLOT_W / n;
  const xCenter = (i: number) => CHART_PADDING.left + slotWidth * i + slotWidth / 2;
  const yScore = (score: number) => (
    CHART_PADDING.top
    + PLOT_H
    - ((score - 1) / (TRAINING_STATUS_LEGEND_ITEMS.length - 1)) * PLOT_H
  );

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
        {TRAINING_STATUS_LEGEND_ITEMS.map((item) => {
          const score = trainingStatusScore(item.status)!;
          return (
            <g key={`status-axis-${item.status}`}>
              <line
                x1={CHART_PADDING.left} y1={yScore(score)}
                x2={VIEW_BOX_W - CHART_PADDING.right} y2={yScore(score)}
                className="strava-grid-line"
              />
              <text
                x={CHART_PADDING.left - 4} y={yScore(score)}
                className="strava-axis-label"
                textAnchor="end"
                dominantBaseline="middle"
              >
                {score}
              </text>
            </g>
          );
        })}

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

          {/* Dots — only render recognized statuses */}
          {buckets.map((b, i) => {
            const score = trainingStatusScore(b.status);
            if (score === null) return null;
            return (
              <circle
                key={`dot-${i}`}
                cx={xCenter(i)}
                cy={yScore(score)}
                r={i === activeIndex ? (n > 20 ? 8.1 : 10.8) : (n > 20 ? 4.05 : 6.75)}
                fill={trainingStatusColor(b.status)}
                opacity={i === activeIndex ? 1 : 0.75}
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
  /** Daily sleep goal in hours (0 = no goal). */
  sleepHoursGoal?: number;
  /** Weekly intensity minutes goal (0 = no goal). Auto-synced from Garmin. */
  weeklyIntensityMinGoal?: number;
  /** Daily calorie goal (0 = no goal line). From app settings. */
  dailyCalorieGoal?: number;
}

export function GarminWellnessView({ entries, range, aggregation, embedded = false, stepsGoal = 0, floorsGoal = 0, sleepHoursGoal = 0, weeklyIntensityMinGoal = 0, dailyCalorieGoal = 0 }: Props) {
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

  const hrvData         = useMemo(() => buildHrvRangeChartData(entries, range, aggregation, today), [entries, range, aggregation, today]);
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

  // Fixed y-axis domains: score charts center on the latest value, goal charts
  // cap at a multiple of the (aggregation-scaled) goal.
  const vo2Domain       = useMemo(() => centeredDomain(vo2Data.latestValue, 10), [vo2Data.latestValue]);
  const hillDomain      = useMemo(() => centeredDomain(hillData.latestValue, 20), [hillData.latestValue]);
  const enduranceDomain = useMemo(() => centeredDomain(enduranceData.latestValue, 1000), [enduranceData.latestValue]);
  const rhrDomain       = useMemo(() => centeredDomain(rhrData.latestValue, 15), [rhrData.latestValue]);
  const hrvDomain       = useMemo(() => baselineDomain(hrvData.buckets, 5), [hrvData.buckets]);
  const stepsDomain     = useMemo(() => {
    const cap = goalBarCap(stepsGoal, 1.5, aggregation);
    return cap === null ? null : { min: 0, max: cap };
  }, [stepsGoal, aggregation]);
  const floorsDomain    = useMemo(() => {
    const cap = goalBarCap(floorsGoal, 3, aggregation);
    return cap === null ? null : { min: 0, max: cap };
  }, [floorsGoal, aggregation]);
  const intensityDomain = useMemo(() => {
    // Day view shows a Monday-start cumulative line, so the axis caps at the
    // weekly goal itself (matching Garmin) rather than a per-day multiple.
    if (aggregation === 'day') {
      return weeklyIntensityMinGoal > 0 ? { min: 0, max: weeklyIntensityMinGoal } : null;
    }
    const cap = goalBarCap(weeklyIntensityMinGoal / 7, 2, aggregation);
    return cap === null ? null : { min: 0, max: cap };
  }, [weeklyIntensityMinGoal, aggregation]);

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
  const summaryValue = (data: Pick<WellnessChartData, 'summary' | 'latestValue'>): number | null =>
    aggregation === 'day' ? data.latestValue : data.summary;
  const latestBodyBatteryRange = [...bbRangeBuckets].reverse().find((bucket) => bucket.min !== null || bucket.max !== null);
  const latestHrvStatus = [...hrvData.buckets].reverse().find((bucket) => bucket.value !== null && bucket.colorKey)?.colorKey ?? '';
  const latestHrvBaseline = hrvData.latestMin !== null || hrvData.latestMax !== null
    ? `baseline ${formatWellnessValue(hrvData.latestMin, 'hrvWeeklyAvg')}–${formatWellnessValue(hrvData.latestMax, 'hrvWeeklyAvg')}`
    : '';
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
        domain={vo2Domain}
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
        domain={hillDomain}
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
        domain={enduranceDomain}
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.heatAcclimationPct}
        unit={WELLNESS_METRIC_UNITS.heatAcclimationPct}
        buckets={heatAcclimationData.buckets}
        summaryLabel={summaryStr(summaryValue(heatAcclimationData), 'heatAcclimationPct', WELLNESS_METRIC_UNITS.heatAcclimationPct)}
        formatValue={numFmt('heatAcclimationPct')}
        renderAsDots
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
        renderAsDots
      />
      <WellnessLoadFocusChart
        label="HRV Status"
        buckets={hrvData.buckets}
        summaryLabel={withLegendLabel(
          summaryStr(summaryValue(hrvData), 'hrvWeeklyAvg', WELLNESS_METRIC_UNITS.hrvWeeklyAvg),
          [
            aggregation === 'day' ? hrvStatusLegendLabel(latestHrvStatus) : '',
            latestHrvBaseline,
          ].filter(Boolean).join(' · ') || null,
        )}
        legendItems={HRV_STATUS_LEGEND_ITEMS}
        formatValue={numFmt('hrvWeeklyAvg')}
        rangeLabel="baseline"
        colorFn={(_, __, ___, key) => key ? hrvStatusColor(key) : ACCENT}
        domain={hrvDomain}
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.restingHR}
        unit={WELLNESS_METRIC_UNITS.restingHR}
        buckets={rhrData.buckets}
        summaryLabel={summaryStr(summaryValue(rhrData), 'restingHR', WELLNESS_METRIC_UNITS.restingHR)}
        formatValue={numFmt('restingHR')}
        renderAsDots
        domain={rhrDomain}
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
        legendItems={sleepHoursGoal > 0 ? GOAL_COLOR_LEGEND_ITEMS : undefined}
        colorFn={(v) => v !== null ? sleepGoalColor(v, sleepHoursGoal) : GRAY}
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
        domain={stepsDomain}
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.floors}
        unit={WELLNESS_METRIC_UNITS.floors}
        buckets={floorsData.buckets}
        summaryLabel={summaryStr(summaryValue(floorsData), 'floors', '')}
        formatValue={numFmt('floors')}
        legendItems={floorsGoal > 0 ? GOAL_COLOR_LEGEND_ITEMS : undefined}
        colorFn={(v) => v !== null ? goalColor(v, floorsGoal, aggregation, ACCENT) : GRAY}
        domain={floorsDomain}
      />
      <WellnessBarChart
        label="Intensity Minutes"
        unit={WELLNESS_METRIC_UNITS.intensityMinModerate}
        buckets={intensityData.buckets}
        summaryLabel={summaryStr(summaryValue(intensityData), 'intensityMinModerate', WELLNESS_METRIC_UNITS.intensityMinModerate)}
        formatValue={numFmt('intensityMinModerate')}
        legendItems={weeklyIntensityMinGoal > 0 ? GOAL_COLOR_LEGEND_ITEMS : undefined}
        colorFn={(v, key) => goalColorFromKey(key, v !== null ? ACCENT : GRAY)}
        domain={intensityDomain}
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
