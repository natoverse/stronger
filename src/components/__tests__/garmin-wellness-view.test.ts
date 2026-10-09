import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { GarminWellnessEntry } from '../../model/types.js';
import { formatShortDate } from '../../model/freshness.js';
import {
  GarminWellnessView,
  TRAINING_STATUS_LEGEND_ITEMS,
  baselineDomain,
  centeredDomain,
  goalBarCap,
  goalSummaryLabel,
  enduranceScoreLegendLabel,
  enduranceScoreColor,
  formatAltitudeFeet,
  intensityGoalSummaryLabel,
  formatTrainingStatusLabel,
  hillScoreLegendLabel,
  hillScoreColor,
  hrvStatusLegendLabel,
  hrvStatusColor,
  overflowPatternColors,
  readinessLegendLabel,
  sleepGoalColor,
  metersToFeet,
  trainingLoadRatioLegendLabel,
  trainingStatusColor,
  trainingStatusScore,
  vo2MaxLegendLabel,
  vo2MaxColor,
} from '../GarminWellnessView.js';

vi.mock('../../hooks/useChartTooltip.js', () => ({
  useChartTooltip: () => ({ activeIndex: 0, svgRef: { current: null }, containerHandlers: {} }),
}));

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useState: vi.fn(react.useState) };
});

describe('GarminWellnessView', () => {
  const entry: GarminWellnessEntry = {
    date: '2025-01-01',
    sleepStartTimestampLocal: Date.parse('2024-12-31T23:15:00Z'),
    sleepEndTimestampLocal: Date.parse('2025-01-01T07:05:00Z'),
    sleepDurationSec: 7 * 3600,
    sleepDeepSec: null, sleepLightSec: null, sleepRemSec: null, sleepAwakeSec: null,
    sleepScore: null,
    bodyBatteryHigh: 90, bodyBatteryLow: 20,
    hrvWeeklyAvg: null, hrvStatus: '',
    readinessScore: null, trainingStatus: '',
    trainingAcuteLoad: null, trainingChronicLoad: null,
    steps: null, floors: null, restingHR: null, vo2Max: null,
    intensityMinModerate: null, intensityMinVigorous: null,
    hillScore: null, enduranceScore: null,
    heatAcclimationPct: null, altitudeAcclimationPct: null, currentAltitude: null,
    activeCalories: null, bmrCalories: null, avgStress: null,
    lactateThresholdHr: null, lactateThresholdSpeed: null, lactateThresholdPower: null,
    fitnessAge: null, maxHrEstimate: null,
    loadFocusAerobicLow: null, loadFocusAerobicLowMin: null, loadFocusAerobicLowMax: null,
    loadFocusAerobicHigh: null, loadFocusAerobicHighMin: null, loadFocusAerobicHighMax: null,
    loadFocusAnaerobic: null, loadFocusAnaerobicMin: null, loadFocusAnaerobicMax: null,
    hrvBaselineMin: null, hrvBaselineMax: null,
  };

  function render(aggregation: 'day' | 'week' | 'month', entries = [entry], range = '2025') {
    return renderToStaticMarkup(createElement(GarminWellnessView, { entries, range, aggregation }));
  }

  const sparseHeaders = [
    ['VO₂ Max (Running)', '45.0 mL/kg/min'],
    ['Lactate Threshold HR', '165 bpm'],
    ['Lactate Threshold Pace', '8:24 /mi'],
    ['Lactate Threshold Power', '300 W'],
  ];
  const oldReading = {
    ...entry, date: '2024-12-31', vo2Max: 45,
    lactateThresholdHr: 165, lactateThresholdSpeed: 3.19, lactateThresholdPower: 300,
    restingHR: 60,
  };
  const chartCard = (markup: string, title: string) =>
    markup.split('class="strava-chart-card"').slice(1).find((card) => card.includes(title))!;

  const averageEntry: GarminWellnessEntry = {
    ...entry,
    restingHR: 60, sleepDurationSec: 7 * 3600, sleepScore: 80,
    steps: 1000, floors: 10, avgStress: 20, hrvWeeklyAvg: 50,
    hrvBaselineMin: 30, hrvBaselineMax: 70,
    trainingAcuteLoad: 100, trainingChronicLoad: 100,
    loadFocusAerobicLow: 100, loadFocusAerobicHigh: 200, loadFocusAnaerobic: 50,
    intensityMinModerate: 10, intensityMinVigorous: 20,
  };
  const summaryGrid = (markup: string) =>
    markup.split('<section class="wellness-summary-grid"')[1].split('</section>')[0];
  const summaryCard = (markup: string, title: string) =>
    summaryGrid(markup).split('<article').find((card) => card.includes(`>${title}</h2>`))!;

  it('places four numeric summary cards above Training without replacing charts', () => {
    const markup = render('day', [{ ...averageEntry, hrvStatus: 'BALANCED', vo2Max: 48.2 }]);
    expect(summaryGrid(markup).match(/class="wellness-summary-card"/g)).toHaveLength(4);
    expect(markup.indexOf('wellness-summary-grid')).toBeLessThan(markup.indexOf('>Training</h2>'));
    expect(summaryCard(markup, 'HRV Status')).toContain('style="color:#00e676">50</p>');
    expect(summaryCard(markup, 'Resting Heart Rate')).toContain('style="color:#ff2d7b">60</p>');
    expect(summaryCard(markup, 'VO₂ Max')).toContain('style="color:#2196f3">48.2</p>');
    expect(summaryCard(markup, 'Sleep Score')).toContain('style="color:#00e676">80</p>');
    expect(summaryGrid(markup)).not.toMatch(/<svg|bpm|mL\/kg\/min|Balanced/);
    expect(chartCard(markup, 'HRV Status')).toContain('<svg');
  });

  it.each(['day', 'week', 'month'] as const)('uses latest individual readings rather than %s averages', (aggregation) => {
    const markup = render(aggregation, [
      { ...averageEntry, date: '2025-01-03', hrvWeeklyAvg: null, restingHR: 55, vo2Max: null, sleepScore: null },
      { ...averageEntry, date: '2025-01-02', hrvWeeklyAvg: 45, hrvStatus: 'LOW', vo2Max: 40, sleepScore: 70 },
      { ...averageEntry, hrvStatus: 'BALANCED', vo2Max: 48 },
      { ...averageEntry, date: '2024-12-31', restingHR: 90, hrvWeeklyAvg: 90, sleepScore: 95 },
    ]);
    expect(summaryCard(markup, 'HRV Status')).toContain('style="color:#ff1744">45</p>');
    expect(summaryCard(markup, 'Resting Heart Rate')).toContain('>55</p>');
    expect(summaryCard(markup, 'VO₂ Max')).toContain('style="color:#ffab40">40.0</p>');
    expect(summaryCard(markup, 'Sleep Score')).toContain('style="color:#ffab40">70</p>');
  });

  it('keeps the HRV color paired with its reading, not an older status', () => {
    const markup = render('day', [
      { ...averageEntry, hrvStatus: 'LOW' },
      { ...averageEntry, date: '2025-01-02', hrvWeeklyAvg: 60, hrvStatus: '' },
      { ...entry, date: '2025-01-03', hrvStatus: 'BALANCED' },
    ]);
    expect(summaryCard(markup, 'HRV Status')).toContain('style="color:#ff2d7b">60</p>');
  });

  it('shows missing readings as gray dashes and ignores nonfinite and future readings', () => {
    const markup = render('day', [
      entry,
      { ...entry, date: '2025-01-02', hrvWeeklyAvg: NaN, restingHR: Infinity, vo2Max: NaN, sleepScore: -Infinity },
      { ...averageEntry, date: '2099-01-01', vo2Max: 50 },
    ]);
    expect(summaryGrid(markup).match(/style="color:rgba\(255,255,255,0.25\)">—<\/p>/g)).toHaveLength(4);
  });

  it('retains zero readings and the sparse VO₂ Max fallback', () => {
    const markup = render('day', [
      oldReading,
      { ...entry, hrvWeeklyAvg: 0, hrvStatus: 'UNBALANCED', restingHR: 0, sleepScore: 0 },
    ]);
    expect(summaryCard(markup, 'HRV Status')).toContain('style="color:#ffea00">0</p>');
    expect(summaryCard(markup, 'Resting Heart Rate')).toContain('>0</p>');
    expect(summaryCard(markup, 'Sleep Score')).toContain('style="color:#ff1744">0</p>');
    expect(summaryCard(markup, 'VO₂ Max')).toContain('style="color:#00e676">45.0</p>');
  });

  const averageTitles = [
    'Resting Heart Rate', 'Sleep Duration', 'Sleep Score', 'Steps', 'Floors',
    'Load Ratio', 'Low Aerobic Load', 'High Aerobic Load', 'Anaerobic Load',
    'Stress', 'HRV Status', 'Intensity Minutes',
  ];
  function renderWithAverages(aggregation: 'day' | 'week' | 'month', entries = [averageEntry], range = '2025') {
    vi.mocked(useState).mockReturnValueOnce([true, vi.fn()]);
    return render(aggregation, entries, range);
  }

  it('defaults average overlays off and exposes a top-level toggle', () => {
    const markup = render('day', [averageEntry]);
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-label="Show averages"');
    expect(markup).not.toContain('checked=""');
    expect(markup).toContain('class="wellness-sync-row"');
    expect(markup).not.toContain('wellness-average-line');
    expect(markup.indexOf('Show averages')).toBeLessThan(markup.indexOf('>Training</h2>'));
  });

  it.each(['day', 'week', 'month'] as const)('adds averages only to requested charts in %s view', (aggregation) => {
    const markup = renderWithAverages(aggregation);
    expect(markup).toContain('aria-label="Show averages" checked=""');
    expect(markup.match(/wellness-average-line/g)).toHaveLength(averageTitles.length);
    for (const title of averageTitles) {
      expect(chartCard(markup, title)).toContain('class="strava-goal-line wellness-average-line"');
    }
    expect(chartCard(markup, 'Resting Heart Rate')).toContain('aria-label="Average: 60"');
    expect(chartCard(markup, 'Sleep Duration')).toContain('aria-label="Average: 7h"');
    expect(chartCard(markup, 'Intensity Minutes')).toContain('aria-label="Average: 30"');
    for (const title of averageTitles) {
      expect(chartCard(markup, title)).toContain('class="wellness-average-label"');
    }
    expect(chartCard(markup, 'VO₂ Max (Running)')).not.toContain('wellness-average-line');
    // Existing sleep-schedule averages and HRV baseline references are independent.
    expect(chartCard(markup, 'Sleep Schedule')).toContain('aria-label="Average start:');
    expect(chartCard(markup, 'HRV Status')).toContain('<path');
  });

  it('averages only finite available readings in the selected range, including zero', () => {
    const entries = [
      averageEntry,
      { ...entry, date: '2025-01-02', restingHR: 70, steps: 0 },
      { ...entry, date: '2025-01-03' },
      { ...entry, date: '2025-01-04', steps: NaN },
      { ...averageEntry, date: '2024-01-01', restingHR: 90, steps: 5000 },
      { ...averageEntry, date: '2026-01-01', restingHR: 100, steps: 9000 },
    ];
    const markup = renderWithAverages('day', entries);
    expect(chartCard(markup, 'Resting Heart Rate')).toContain('aria-label="Average: 65"');
    expect(chartCard(markup, 'Steps')).toContain('aria-label="Average: 500"');
    const averageLine = chartCard(markup, 'Steps').match(/<line[^>]*wellness-average-line[^>]*>/)![0];
    expect(averageLine).not.toContain('NaN');
    const otherRange = renderWithAverages('day', entries, '2024');
    expect(chartCard(otherRange, 'Resting Heart Rate')).toContain('aria-label="Average: 90"');
  });

  it.each(['day', 'week', 'month'] as const)('omits averages for missing %s data', (aggregation) => {
    const markup = renderWithAverages(aggregation, [{ ...entry, sleepDurationSec: null }]);
    expect(markup).not.toContain('wellness-average-line');
    expect(markup).not.toContain('class="wellness-average-label"');
  });

  it.each(['day', 'week', 'month'] as const)('averages bucket totals rather than the range total in %s view', (aggregation) => {
    const markup = renderWithAverages(aggregation, [
      averageEntry,
      { ...averageEntry, date: '2025-02-01', steps: 3000, floors: 30,
        intensityMinModerate: 30, intensityMinVigorous: 60 },
    ]);
    expect(chartCard(markup, 'Steps')).toContain('aria-label="Average: 2000"');
    expect(chartCard(markup, 'Floors')).toContain('aria-label="Average: 20"');
    expect(chartCard(markup, 'Intensity Minutes')).toContain('aria-label="Average: 60"');
  });

  it('does not clamp an off-axis average to a misleading value', () => {
    const markup = renderWithAverages('day', [
      { ...averageEntry, restingHR: 100 },
      { ...averageEntry, date: '2025-01-02', restingHR: 50 },
    ]);
    expect(chartCard(markup, 'Resting Heart Rate')).not.toContain('wellness-average-line');
    expect(chartCard(markup, 'Resting Heart Rate')).toContain('>Avg 75</span>');
  });

  it('colors threshold averages using the unrounded mean and falls back to gray', () => {
    const markup = renderWithAverages('day', [
      { ...averageEntry, avgStress: 25, sleepScore: 50 },
      { ...averageEntry, date: '2025-01-02', avgStress: 26, sleepScore: 100 },
    ]);
    const line = (title: string) => chartCard(markup, title).match(/<line[^>]*wellness-average-line[^>]*>/)![0];
    expect(line('Stress')).toContain('style="stroke:#2196f3"');
    expect(line('Load Ratio')).toContain('style="stroke:#00e676"');
    expect(line('Resting Heart Rate')).toContain('style="stroke:rgba(255,255,255,0.25)"');
    expect(line('Steps')).toContain('style="stroke:rgba(255,255,255,0.25)"');
    expect(line('Low Aerobic Load')).toContain('style="stroke:rgba(255,255,255,0.25)"');
    expect(chartCard(markup, 'Stress')).toContain('>Avg 26</span>');
    expect(chartCard(markup, 'Load Ratio')).toContain('>Avg 1</span>');
  });

  it('retains rounded fractional precision in the load-ratio average header', () => {
    const markup = renderWithAverages('day', [
      { ...averageEntry, trainingAcuteLoad: 100, trainingChronicLoad: 100 },
      { ...averageEntry, date: '2025-01-02', trainingAcuteLoad: 75, trainingChronicLoad: 100 },
    ]);
    expect(chartCard(markup, 'Load Ratio')).toContain('>Avg 0.88</span>');
    expect(chartCard(markup, 'Load Ratio').match(/<line[^>]*wellness-average-line[^>]*>/)![0])
      .toContain('style="stroke:#00e676"');
  });

  it('colors goal averages by the mean rather than the latest reading', () => {
    vi.mocked(useState).mockReturnValueOnce([true, vi.fn()]);
    const markup = renderToStaticMarkup(createElement(GarminWellnessView, {
      entries: [averageEntry, { ...averageEntry, date: '2025-01-02', steps: 3000, sleepDurationSec: 9 * 3600 }],
      range: '2025', aggregation: 'day', stepsGoal: 2000, sleepHoursGoal: 8, weeklyIntensityMinGoal: 210,
    }));
    for (const title of ['Steps', 'Sleep Duration', 'Intensity Minutes']) {
      const line = chartCard(markup, title).match(/<line[^>]*wellness-average-line[^>]*>/)![0];
      expect(line).toContain('style="stroke:#00e676"');
    }
  });

  it('compares load-focus and HRV averages with available mean range boundaries', () => {
    const markup = renderWithAverages('day', [
      { ...averageEntry, loadFocusAerobicLowMin: 50, loadFocusAerobicLowMax: 150, hrvWeeklyAvg: 20 },
      { ...averageEntry, date: '2025-01-02', loadFocusAerobicLow: 200,
        loadFocusAerobicLowMin: 150, loadFocusAerobicLowMax: 250, hrvWeeklyAvg: 40 },
    ]);
    expect(chartCard(markup, 'Low Aerobic Load').match(/<line[^>]*wellness-average-line[^>]*>/)![0])
      .toContain('style="stroke:#00e676"');
    expect(chartCard(markup, 'HRV Status').match(/<line[^>]*wellness-average-line[^>]*>/)![0])
      .toContain('style="stroke:#00e676"');
  });

  it('shows the latest actual sync date and local time, falling back for legacy timestamps', () => {
    const timestamp = '2025-01-03T01:45:00Z';
    const synced = new Date(timestamp);
    const markup = render('day', [
      { ...entry, syncedAt: timestamp },
      { ...entry, date: '2025-01-02', syncedAt: '2025-01-02T01:45:00Z' },
      { ...entry, syncedAt: 'invalid' },
    ]);
    const localTime = synced.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const localDate = `${synced.getFullYear()}-${String(synced.getMonth() + 1).padStart(2, '0')}-${String(synced.getDate()).padStart(2, '0')}`;
    expect(markup).toContain(`${formatShortDate(localDate)} · ${localTime}</p>`);
    expect(markup.indexOf(localTime)).toBeLessThan(markup.indexOf('class="wellness-average-toggle"'));
    expect(render('day', [{ ...entry, syncedAt: 'invalid' }])).toContain('Wednesday, Jan. 1st</p>');
  });

  it.each(['day', 'week', 'month'] as const)(
    'shows prior sparse readings only in headers for %s aggregation',
    (aggregation) => {
      const markup = render(aggregation, [entry, oldReading, { ...oldReading, date: '2026-01-01', vo2Max: 60 }]);
      for (const [title, value] of sparseHeaders) {
        const card = chartCard(markup, title);
        expect(card).toContain(`class="strava-chart-total">${value}`);
        expect(card).not.toContain('<circle');
        expect(card).toContain('class="chart-tooltip-value">—');
      }
      if (aggregation === 'day') {
        expect(chartCard(markup, 'VO₂ Max (Running)')).toContain('45.0 mL/kg/min · Good');
      }
      expect(chartCard(markup, 'Resting Heart Rate')).not.toContain('class="strava-chart-total"');
    },
  );

  it.each(['day', 'week', 'month'] as const)(
    'preserves in-range latest values and averages for %s aggregation',
    (aggregation) => {
      const markup = render(aggregation, [
        oldReading,
        { ...oldReading, date: '2025-01-01', vo2Max: 50, lactateThresholdHr: 170 },
        { ...oldReading, date: '2025-01-02', vo2Max: 54, lactateThresholdHr: 174 },
      ]);
      expect(chartCard(markup, 'VO₂ Max (Running)')).toContain(
        `class="strava-chart-total">${aggregation === 'day' ? '54.0' : '52.0'} mL/kg/min`,
      );
      expect(chartCard(markup, 'Lactate Threshold HR')).toContain(
        `class="strava-chart-total">${aggregation === 'day' ? '174' : '172'} bpm`,
      );
    },
  );

  it('does not invent headers when no eligible historical readings exist', () => {
    const markup = render('day', [entry, { ...oldReading, date: '2026-01-01' }]);
    for (const [title] of sparseHeaders) {
      expect(chartCard(markup, title)).not.toContain('class="strava-chart-total"');
    }
  });

  it('renders local header/hover times and clock ticks without changing Body Battery or sleep duration', () => {
    const markup = render('day');
    const sleepCard = markup.split('class="strava-chart-card"').find((card) => card.includes('Sleep Schedule'))!;
    expect(sleepCard).toContain('11:15 PM–7:05 AM');
    expect(sleepCard).toContain('class="chart-tooltip-value">11:15 PM–7:05 AM');
    expect(sleepCard).toContain('class="chart-tooltip-date">1/1');
    expect(sleepCard).toContain('12:00 AM');
    expect(sleepCard).toContain('9:00 PM');
    expect(sleepCard).toContain('10:00 AM');
    expect(sleepCard).not.toContain('6:00 PM');
    expect(sleepCard).not.toContain('12:00 PM');
    expect(sleepCard).toContain('aria-label="Sleep Schedule"');
    expect(sleepCard).toContain('<rect');
    const batteryCard = markup.split('class="strava-chart-card"').find((card) => card.includes('Body Battery Range'))!;
    expect(batteryCard).toContain('20–90');
    const durationCard = markup.split('class="strava-chart-card"').find((card) => card.includes('Sleep Duration'))!;
    expect(durationCard).toContain('7h');
    expect(markup).not.toContain('NaN');
  });

  it.each(['week', 'month'] as const)('labels averaged %s headers', (aggregation) => {
    expect(render(aggregation)).toContain('Avg 11:15 PM–7:05 AM');
  });

  it('leaves legacy sleep windows empty rather than drawing zero-valued bars', () => {
    const markup = render('day', [{ ...entry, sleepStartTimestampLocal: null }]);
    const sleepCard = markup.split('class="strava-chart-card"').find((card) => card.includes('Sleep Schedule'))!;
    expect(sleepCard).not.toContain('<rect');
    expect(sleepCard).not.toContain('strava-goal-line');
    expect(sleepCard).toContain('class="chart-tooltip-value">—');
  });

  it.each([
    ['2024-12-31T20:30:00Z', '2025-01-01T07:00:00Z'],
    ['2024-12-31T23:00:00Z', '2025-01-01T10:30:00Z'],
    ['2024-12-31T20:30:00Z', '2025-01-01T10:30:00Z'],
    ['2025-01-01T12:30:00Z', '2025-01-01T20:00:00Z'],
    ['2025-01-01T10:30:00Z', '2025-01-01T11:30:00Z'],
  ])('hatches and bounds outlying bars from %s to %s', (start, end) => {
    const markup = render('day', [{
      ...entry, sleepStartTimestampLocal: Date.parse(start), sleepEndTimestampLocal: Date.parse(end),
    }]);
    const sleepCard = markup.split('class="strava-chart-card"').find((card) => card.includes('Sleep Schedule'))!;
    const bar = sleepCard.match(/<rect[^>]+fill="url\(#[^"]+\)"[^>]*>/)![0];
    const top = Number(bar.match(/ y="([^"]+)"/)![1]);
    const height = Number(bar.match(/ height="([^"]+)"/)![1]);
    expect(top).toBeGreaterThanOrEqual(16);
    expect(top + height).toBeLessThanOrEqual(100);
    expect(height).toBeGreaterThan(0);
    expect(sleepCard).toContain('9:00 PM');
    expect(sleepCard).toContain('10:00 AM');
  });

  it('does not hatch bars exactly on the axis bounds', () => {
    const markup = render('day', [{
      ...entry,
      sleepStartTimestampLocal: Date.parse('2024-12-31T21:00:00Z'),
      sleepEndTimestampLocal: Date.parse('2025-01-01T10:00:00Z'),
    }]);
    const sleepCard = markup.split('class="strava-chart-card"').find((card) => card.includes('Sleep Schedule'))!;
    expect(sleepCard).not.toContain('<pattern');
    expect(sleepCard.match(/class="strava-goal-line"/g)).toHaveLength(2);
  });

  it.each(['day', 'week', 'month'] as const)('uses range-filtered per-night averages for %s boundaries', (aggregation) => {
    const entries = [
      ['2024-12-31T22:00:00Z', '2025-01-01T06:00:00Z'],
      ['2025-01-01T22:00:00Z', '2025-01-02T06:00:00Z'],
      ['2025-02-01T01:00:00Z', '2025-02-01T09:00:00Z'],
      ['2023-12-31T21:00:00Z', '2024-01-01T10:00:00Z'],
    ].map(([start, end]) => ({
      ...entry, sleepStartTimestampLocal: Date.parse(start), sleepEndTimestampLocal: Date.parse(end),
    }));
    const sleepCard = render(aggregation, entries).split('class="strava-chart-card"').find((card) => card.includes('Sleep Schedule'))!;
    expect(sleepCard).toContain('class="strava-goal-line" aria-label="Average start: 11:00 PM"');
    expect(sleepCard).toContain('class="strava-goal-line" aria-label="Average end: 7:00 AM"');
    expect(sleepCard).toContain('fill="rgba(255,255,255,0.25)" opacity="0.3"');
    const otherRange = render(aggregation, entries, '2024').split('class="strava-chart-card"').find((card) => card.includes('Sleep Schedule'))!;
    expect(otherRange).toContain('aria-label="Average start: 9:00 PM"');
    expect(otherRange).toContain('aria-label="Average end: 10:00 AM"');
  });
});

describe('altitude formatting', () => {
  it('converts Garmin altitude meters to rounded display feet', () => {
    expect(metersToFeet(1625)).toBeCloseTo(5331.365);
    expect(formatAltitudeFeet(1625)).toBe('5,331');
    expect(formatAltitudeFeet(null)).toBe('—');
  });
});

describe('hrvStatusColor', () => {
  it('maps balanced, low, and unbalanced HRV statuses to the requested colors', () => {
    expect(hrvStatusColor('BALANCED')).toBe('#00e676');
    expect(hrvStatusColor('LOW')).toBe('#ff1744');
    expect(hrvStatusColor('UNBALANCED')).toBe('#ffea00');
  });
});

describe('vo2MaxColor', () => {
  it('maps VO2 max thresholds to the expected palette', () => {
    expect(vo2MaxColor(38.4)).toBe('#ff1744');
    expect(vo2MaxColor(38.5)).toBe('#ffab40');
    expect(vo2MaxColor(42.4)).toBe('#ffab40');
    expect(vo2MaxColor(42.5)).toBe('#00e676');
    expect(vo2MaxColor(46.4)).toBe('#2196f3');
    expect(vo2MaxColor(52.5)).toBe('#d500f9');
  });
});

describe('hillScoreColor', () => {
  it('maps hill score thresholds to the expected palette', () => {
    expect(hillScoreColor(24.9)).toBe('#ff1744');
    expect(hillScoreColor(25)).toBe('#ffab40');
    expect(hillScoreColor(50)).toBe('#00e676');
    expect(hillScoreColor(69)).toBe('#2196f3');
    expect(hillScoreColor(85)).toBe('#d500f9');
    expect(hillScoreColor(95)).toBe('#ff2d7b');
  });
});

describe('enduranceScoreColor', () => {
  it('maps endurance score thresholds to the expected palette', () => {
    expect(enduranceScoreColor(4999)).toBe('#ff1744');
    expect(enduranceScoreColor(5000)).toBe('#ffab40');
    expect(enduranceScoreColor(5700)).toBe('#ffea00');
    expect(enduranceScoreColor(6400)).toBe('#00e676');
    expect(enduranceScoreColor(7000)).toBe('#2196f3');
    expect(enduranceScoreColor(7700)).toBe('#d500f9');
    expect(enduranceScoreColor(8400)).toBe('#ff2d7b');
  });
});

describe('training status legend', () => {
  it('orders the categorical scale from Peaking at 9 to No status at 1', () => {
    expect(TRAINING_STATUS_LEGEND_ITEMS).toHaveLength(9);
    expect(TRAINING_STATUS_LEGEND_ITEMS[0].label).toBe('Peaking');
    expect(TRAINING_STATUS_LEGEND_ITEMS[TRAINING_STATUS_LEGEND_ITEMS.length - 1].label).toBe('No status');
    expect(trainingStatusScore('PEAKING')).toBe(9);
    expect(trainingStatusScore('NO_STATUS')).toBe(1);
    expect(trainingStatusScore('RECOVERY_ACTIVE')).toBe(trainingStatusScore('RECOVERY'));
    expect(trainingStatusScore('UNKNOWN')).toBeNull();
  });

  it('keeps legend swatch colors aligned with training status dots', () => {
    for (const item of TRAINING_STATUS_LEGEND_ITEMS) {
      expect(item.color).toBe(trainingStatusColor(item.status));
    }
  });

  it('formats underscored training statuses for display', () => {
    expect(formatTrainingStatusLabel('RECOVERY_ACTIVE')).toBe('Recovery active');
    expect(formatTrainingStatusLabel('')).toBe('—');
  });
});

describe('wellness legend labels', () => {
  it('derives readiness and load ratio labels from numeric values', () => {
    expect(readinessLegendLabel(20)).toBe('Poor');
    expect(readinessLegendLabel(95)).toBe('Prime');
    expect(trainingLoadRatioLegendLabel(0.7)).toBe('Low');
    expect(trainingLoadRatioLegendLabel(1.1)).toBe('Optimal');
    expect(trainingLoadRatioLegendLabel(1.5)).toBe('High');
  });

  describe('sleep goal colors', () => {
    it('compares chart values in hours against the configured daily hours goal', () => {
      expect(sleepGoalColor(6, 7)).toBe('#ffea00');
      expect(sleepGoalColor(8, 7)).toBe('#00e676');
      expect(sleepGoalColor(9, 7)).toBe('#2196f3');
    });

    it('uses the daily goal for an averaged weekly bucket', () => {
      expect(sleepGoalColor((7 + 9) / 2, 7)).toBe('#00e676');
    });
  });

  it('derives VO2, hill, and endurance labels from numeric values', () => {
    expect(vo2MaxLegendLabel(52.5)).toBe('Superior');
    expect(hillScoreLegendLabel(68.9)).toBe('Trained');
    expect(hillScoreLegendLabel(95)).toBe('Elite');
    expect(enduranceScoreLegendLabel(8399)).toBe('Superior');
    expect(enduranceScoreLegendLabel(8400)).toBe('Elite');
  });

  it('formats HRV status labels from stored status text', () => {
    expect(hrvStatusLegendLabel('UNBALANCED')).toBe('Unbalanced');
    expect(hrvStatusLegendLabel('')).toBe('Unknown');
  });
});

describe('chart y-domains', () => {
  it('centers the domain on the current value and never dips below zero', () => {
    expect(centeredDomain(45, 10)).toEqual({ min: 35, max: 55 });
    expect(centeredDomain(52, 15)).toEqual({ min: 37, max: 67 });
    expect(centeredDomain(600, 1000)).toEqual({ min: 0, max: 1600 });
    expect(centeredDomain(null, 10)).toBeNull();
  });

  describe('overflow patterns', () => {
    it('uses the computed bar color for both hatch layers', () => {
      expect(overflowPatternColors('#ff1744')).toEqual({
        background: '#ff1744',
        line: '#ff1744',
      });
    });
  });

  it('pads the HRV baseline band by five on each side', () => {
    expect(
      baselineDomain(
        [
          { min: 40, max: 60 },
          { min: 38, max: 64 },
          { min: null, max: null },
        ],
        5,
      ),
    ).toEqual({ min: 33, max: 69 });
    expect(baselineDomain([{ min: null, max: null }], 5)).toBeNull();
  });

  it('scales goal caps by aggregation and disables them without a goal', () => {
    expect(goalBarCap(10000, 1.5, 'day')).toBe(15000);
    expect(goalBarCap(10000, 1.5, 'week')).toBe(105000);
    expect(goalBarCap(10, 3, 'day')).toBe(30);
    expect(goalBarCap(150 / 7, 2, 'day')).toBeCloseTo(42.857, 3);
    expect(goalBarCap(0, 1.5, 'day')).toBeNull();
  });

  it('formats activity goal chart summaries as current over goal', () => {
    expect(goalSummaryLabel(12345, 10000, 'day', 'steps', '')).toBe('12345 / 10000');
    // Weekly aggregation compares against seven daily floor goals.
    expect(goalSummaryLabel(8, 10, 'week', 'floors', '')).toBe('8 / 70');
    expect(goalSummaryLabel(8, 0, 'day', 'floors', '')).toBe('8');
  });

  it('formats intensity summaries as current with week total over weekly goal', () => {
    expect(intensityGoalSummaryLabel(25, 125, 150)).toBe('25 - 125 / 150 min');
    expect(intensityGoalSummaryLabel(25, null, 150)).toBe('25 min');
    expect(intensityGoalSummaryLabel(25, 125, 0)).toBe('25 min');
  });
});
