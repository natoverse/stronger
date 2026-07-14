# Spec 035 — Garmin Wellness Sync & Charts

## Status
Implemented.

## Problem
The app already syncs Garmin activity data (workouts, runs, rides) via `garmin-sync.py`. Garmin Connect exposes a much richer set of daily wellness metrics that are valuable for tracking training readiness and recovery: HRV, sleep, body battery, training status and load, VO2 max, intensity minutes, steps, floors, RHR, hill score, and endurance score.

## Solution

### Data model
A single new sheet tab, **"Stronger - Garmin Wellness"**, holds one row per day with 24 columns (A:X):

| # | Column | Description |
|---|--------|-------------|
| 1 | date | YYYY-MM-DD |
| 2 | hrvLastNight | Overnight HRV (ms) |
| 3 | hrvWeeklyAvg | 5-day rolling HRV average (ms) |
| 4 | hrvStatus | BALANCED / UNBALANCED / LOW |
| 5 | sleepDurationSec | Total sleep in seconds |
| 6 | sleepDeepSec | Deep sleep in seconds |
| 7 | sleepLightSec | Light sleep in seconds |
| 8 | sleepRemSec | REM sleep in seconds |
| 9 | sleepAwakeSec | Awake time in seconds |
| 10 | sleepScore | Overall sleep score (0–100) |
| 11 | bodyBatteryHigh | Peak body battery during day (0–100) |
| 12 | bodyBatteryLow | Trough body battery during day (0–100) |
| 13 | readinessScore | Training readiness score (0–100) |
| 14 | trainingStatus | PRODUCTIVE / MAINTAINING / RECOVERY / etc. |
| 15 | trainingAcuteLoad | Short-term training load |
| 16 | trainingChronicLoad | Long-term training load |
| 17 | steps | Daily step count |
| 18 | floors | Floors ascended |
| 19 | restingHR | Resting heart rate (bpm) |
| 20 | vo2Max | Running VO2 max estimate (mL/kg/min) |
| 21 | intensityMinModerate | Moderate intensity minutes |
| 22 | intensityMinVigorous | Vigorous intensity minutes |
| 23 | hillScore | Hill Score (0–100) |
| 24 | enduranceScore | Endurance Score (0–100) |

### Sync script — `scripts/garmin-wellness-sync.py`
- Same auth pattern as `garmin-sync.py` (python-garminconnect, GARMIN_TOKENS secret)
- 8 API calls per date: HRV, sleep, training readiness, training status, daily summary, VO2 max, hill score, endurance score
- Append-only with date deduplication (same pattern as activity sync)
- Default window: last 14 days. `--backfill` flag: all dates since 2021-01-01
- 0.15s delay between dates for rate-limit courtesy
- Partial rows written on API failure (field = `''`); never aborts mid-sync

### GitHub Actions — `.github/workflows/garmin-wellness-sync.yml`
- Runs daily at 08:00 UTC (one hour after garmin-sync)
- Same secrets: GARMIN_TOKENS, GOOGLE_SERVICE_ACCOUNT_KEY, SPREADSHEET_ID
- `backfill` workflow_dispatch input for one-time historical backfills

### Frontend — `GarminWellnessView`
- Route: `#/wellness`, nav button in toolbar (Stethoscope icon)
- Same controls as StravaView: range selector (month / year-per-year) + day/week/month aggregation
- 17 bar charts in 4 sections: **Training**, **Recovery**, **Sleep**, **Activity**
- All charts use `--color-accent` (`#ff2d7b`) as the default bar color

#### Color-coded charts
| Chart | Color logic |
|-------|-------------|
| Training Readiness | ≥75 → green, ≥50 → yellow, <50 → pink |
| Training Status | Full Garmin palette: productive=green, peaking=purple, maintaining=yellow, recovery=blue, unproductive=orange, strained=pink, overreaching=red, detraining=gray |
| Acute Load | <100 → gray (below optimal), 100–300 → green (optimal), >300 → pink (too high) |
| Overnight HRV | Color by hrvStatus: BALANCED/OPTIMAL → green, UNBALANCED → orange, LOW → red |

#### Aggregation
- Day: one bar per calendar day
- Week: ISO week buckets, AVG for most metrics, SUM for steps/floors/intensity minutes
- Month: monthly buckets, same SUM/AVG split

### Files changed
- `scripts/garmin-wellness-sync.py` — new sync script
- `.github/workflows/garmin-wellness-sync.yml` — new workflow
- `src/model/types.ts` — `GarminWellnessEntry` interface (24 fields)
- `src/google/config.ts` — `GARMIN_WELLNESS_TAB_NAME` constant
- `src/model/wellness.ts` — new aggregation model (`buildWellnessChartData`, `buildStatusChartData`, formatters)
- `src/google/sheets.ts` — `parseGarminWellnessRow`, `verifyGarminWellnessTab`, `readGarminWellnessEntries`
- `src/google/index.ts` — exports for new functions
- `src/components/GarminWellnessView.tsx` — new chart view component
- `src/hooks/useHashRouter.ts` — `wellness` route
- `src/components/GoogleAuth.tsx` — Wellness nav button (Stethoscope icon)
- `src/App.tsx` — state, lazy loading, route rendering
- `src/App.css` — wellness status legend styles
- `src/google/__tests__/garmin-wellness-data.test.ts` — parse tests
