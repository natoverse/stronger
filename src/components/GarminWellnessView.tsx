/**
 * GarminWellnessView — scrollable page of bar charts for daily Garmin wellness
 * metrics (HRV, sleep, training status/readiness/load, body battery, steps,
 * floors, intensity minutes, VO2 max, hill/endurance scores, RHR).
 *
 * Reuses the same CSS classes as StravaView (strava-chart-card, strava-bar, etc.)
 * and the same aggregation engine from strava.ts via wellness.ts.
 */
import { useState, useMemo } from 'react';
import type { GarminWellnessEntry } from '../model/types.js';
import type { WellnessAggregation, WellnessTimeRange, WellnessBucket, WellnessStatusBucket } from '../model/wellness.js';
import {
  buildWellnessChartData,
  buildTrainingLoadRatioChartData,
  buildStatusChartData,
  formatWellnessRatio,
  getTimeRangeOptions,
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

function trainingStatusColor(status: string): string {
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

export function hrvStatusColor(status: string): string {
  const s = status.toUpperCase();
  if (s === 'BALANCED' || s === 'OPTIMAL') return GREEN;
  if (s.includes('UNBALANCED'))            return YELLOW;
  if (s === 'LOW')                         return RED;
  return ACCENT;
}

/* ------------------------------------------------------------------ */
/*  Chart constants (same as StravaView)                              */
/* ------------------------------------------------------------------ */

const CHART_HEIGHT = 220;
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

  return (
    <div className="strava-chart-card">
      <div className="strava-chart-header">
        <h3 className="strava-chart-label">Training Status</h3>
      </div>

      {/* Status color legend */}
      <div className="wellness-status-legend">
        {[
          { label: 'Productive',  color: GREEN  },
          { label: 'Peaking',     color: PURPLE },
          { label: 'Maintaining', color: YELLOW },
          { label: 'Recovery',    color: BLUE   },
          { label: 'Unproductive',color: ORANGE },
          { label: 'Strained',    color: ACCENT },
          { label: 'Overreaching',color: RED    },
          { label: 'Detraining',  color: GRAY   },
        ].map(({ label, color }) => (
          <span key={label} className="wellness-status-legend-item">
            <span className="wellness-status-legend-dot" style={{ background: color }} />
            {label}
          </span>
        ))}
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
              {buckets[activeIndex].status
                ? buckets[activeIndex].status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
                : '—'}
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
}

export function GarminWellnessView({ entries }: Props) {
  const today = useMemo(() => new Date(), []);
  const rangeOptions = useMemo(() => getTimeRangeOptions(today), [today]);
  const [range, setRange] = useState<WellnessTimeRange>(() => rangeOptions[1]?.value ?? 'month');
  const [aggregation, setAggregation] = useState<WellnessAggregation>('week');

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

  const sleepDurData    = useMemo(() => buildWellnessChartData(entries, 'sleepDurationSec',     range, aggregation, today), [entries, range, aggregation, today]);
  const sleepScoreData  = useMemo(() => buildWellnessChartData(entries, 'sleepScore',           range, aggregation, today), [entries, range, aggregation, today]);

  const stepsData       = useMemo(() => buildWellnessChartData(entries, 'steps',                range, aggregation, today), [entries, range, aggregation, today]);
  const floorsData      = useMemo(() => buildWellnessChartData(entries, 'floors',               range, aggregation, today), [entries, range, aggregation, today]);
  const modMinData      = useMemo(() => buildWellnessChartData(entries, 'intensityMinModerate', range, aggregation, today), [entries, range, aggregation, today]);
  const vigMinData      = useMemo(() => buildWellnessChartData(entries, 'intensityMinVigorous', range, aggregation, today), [entries, range, aggregation, today]);

  if (entries.length === 0) {
    return (
      <div className="strava-view">
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

  const numFmt = (metric: Parameters<typeof formatWellnessValue>[1]) =>
    (v: number | null) => formatWellnessValue(v, metric);

  return (
    <div className="strava-view">
      {/* Controls */}
      <div className="strava-controls">
        <div className="strava-range-group">
          {rangeOptions.map((opt) => (
            <button
              key={opt.value}
              className={`strava-range-btn${range === opt.value ? ' active' : ''}`}
              onClick={() => setRange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="strava-agg-group">
          {(['day', 'week', 'month'] as WellnessAggregation[]).map((agg) => (
            <button
              key={agg}
              className={`strava-agg-btn${aggregation === agg ? ' active' : ''}`}
              onClick={() => setAggregation(agg)}
            >
              {agg.charAt(0).toUpperCase() + agg.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Section: Training */}
      <h2 className="strava-section-title">Training</h2>
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.readinessScore}
        unit={WELLNESS_METRIC_UNITS.readinessScore}
        buckets={readinessData.buckets}
        summaryLabel={summaryStr(readinessData.summary, 'readinessScore', '')}
        colorFn={(v) => v !== null ? readinessColor(v) : GRAY}
        formatValue={numFmt('readinessScore')}
      />
      <WellnessStatusBarChart buckets={statusData.buckets} />
      <WellnessBarChart
        label="Acute:Chronic Load Ratio"
        unit=""
        buckets={trainingLoadRatioData.buckets}
        summaryLabel={formatWellnessRatio(trainingLoadRatioData.summary)}
        colorFn={(v) => v !== null ? trainingLoadRatioColor(v) : GRAY}
        formatValue={formatWellnessRatio}
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.vo2Max}
        unit={WELLNESS_METRIC_UNITS.vo2Max}
        buckets={vo2Data.buckets}
        summaryLabel={summaryStr(vo2Data.summary, 'vo2Max', WELLNESS_METRIC_UNITS.vo2Max)}
        formatValue={numFmt('vo2Max')}
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.hillScore}
        unit={WELLNESS_METRIC_UNITS.hillScore}
        buckets={hillData.buckets}
        summaryLabel={summaryStr(hillData.summary, 'hillScore', '')}
        formatValue={numFmt('hillScore')}
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.enduranceScore}
        unit={WELLNESS_METRIC_UNITS.enduranceScore}
        buckets={enduranceData.buckets}
        summaryLabel={summaryStr(enduranceData.summary, 'enduranceScore', '')}
        formatValue={numFmt('enduranceScore')}
      />

      {/* Section: Recovery */}
      <h2 className="strava-section-title">Recovery</h2>
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.hrvWeeklyAvg}
        unit={WELLNESS_METRIC_UNITS.hrvWeeklyAvg}
        buckets={hrvData.buckets}
        summaryLabel={summaryStr(hrvData.summary, 'hrvWeeklyAvg', WELLNESS_METRIC_UNITS.hrvWeeklyAvg)}
        colorFn={(_, key) => key ? hrvStatusColor(key) : ACCENT}
        formatValue={numFmt('hrvWeeklyAvg')}
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.restingHR}
        unit={WELLNESS_METRIC_UNITS.restingHR}
        buckets={rhrData.buckets}
        summaryLabel={summaryStr(rhrData.summary, 'restingHR', WELLNESS_METRIC_UNITS.restingHR)}
        formatValue={numFmt('restingHR')}
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.bodyBatteryHigh}
        unit={WELLNESS_METRIC_UNITS.bodyBatteryHigh}
        buckets={bbHighData.buckets}
        summaryLabel={summaryStr(bbHighData.summary, 'bodyBatteryHigh', '')}
        formatValue={numFmt('bodyBatteryHigh')}
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.bodyBatteryLow}
        unit={WELLNESS_METRIC_UNITS.bodyBatteryLow}
        buckets={bbLowData.buckets}
        summaryLabel={summaryStr(bbLowData.summary, 'bodyBatteryLow', '')}
        formatValue={numFmt('bodyBatteryLow')}
      />

      {/* Section: Sleep */}
      <h2 className="strava-section-title">Sleep</h2>
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.sleepDurationSec}
        unit={WELLNESS_METRIC_UNITS.sleepDurationSec}
        buckets={sleepDurData.buckets}
        summaryLabel={summaryStr(sleepDurData.summary, 'sleepDurationSec', WELLNESS_METRIC_UNITS.sleepDurationSec)}
        formatValue={numFmt('sleepDurationSec')}
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.sleepScore}
        unit={WELLNESS_METRIC_UNITS.sleepScore}
        buckets={sleepScoreData.buckets}
        summaryLabel={summaryStr(sleepScoreData.summary, 'sleepScore', '')}
        formatValue={numFmt('sleepScore')}
      />

      {/* Section: Activity */}
      <h2 className="strava-section-title">Activity</h2>
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.steps}
        unit={WELLNESS_METRIC_UNITS.steps}
        buckets={stepsData.buckets}
        summaryLabel={summaryStr(stepsData.summary, 'steps', '')}
        formatValue={numFmt('steps')}
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.floors}
        unit={WELLNESS_METRIC_UNITS.floors}
        buckets={floorsData.buckets}
        summaryLabel={summaryStr(floorsData.summary, 'floors', '')}
        formatValue={numFmt('floors')}
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.intensityMinModerate}
        unit={WELLNESS_METRIC_UNITS.intensityMinModerate}
        buckets={modMinData.buckets}
        summaryLabel={summaryStr(modMinData.summary, 'intensityMinModerate', WELLNESS_METRIC_UNITS.intensityMinModerate)}
        formatValue={numFmt('intensityMinModerate')}
      />
      <WellnessBarChart
        label={WELLNESS_METRIC_LABELS.intensityMinVigorous}
        unit={WELLNESS_METRIC_UNITS.intensityMinVigorous}
        buckets={vigMinData.buckets}
        summaryLabel={summaryStr(vigMinData.summary, 'intensityMinVigorous', WELLNESS_METRIC_UNITS.intensityMinVigorous)}
        formatValue={numFmt('intensityMinVigorous')}
      />
    </div>
  );
}
