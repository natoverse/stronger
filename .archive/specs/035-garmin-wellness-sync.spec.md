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
| Overnight HRV | Color by hrvStatus: BALANCED/OPTIMAL → green, UNBALANCED → yellow, LOW → red |

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

## API field audit (post-implementation)

Verified all fields against the real Garmin Connect API response structures using the `python-garminconnect` typed models and recorded test cassettes.

### Confirmed correct
| Endpoint | Fields used | Notes |
|----------|------------|-------|
| `get_hrv_data` | `hrvSummary.lastNight`, `.weeklyAvg`, `.status` | ✅ All exist in real cassette |
| `get_sleep_data` | `dailySleepDTO.sleepTimeSeconds`, `.deepSleepSeconds`, `.lightSleepSeconds`, `.remSleepSeconds`, `.awakeSleepSeconds`, `.sleepScores.overall.value` | ✅ Confirmed via typed model |
| `get_training_readiness` | `entry.score`, `inputContext == "AFTER_WAKEUP_RESET"` | ✅ Confirmed via typed model |
| `get_user_summary` | `totalSteps`, `floorsAscended`, `restingHeartRate`, `bodyBatteryHighestValue`, `bodyBatteryLowestValue`, `moderateIntensityMinutes`, `vigorousIntensityMinutes` | ✅ Confirmed from real API cassette |
| `get_hill_score` / `get_endurance_score` | `allMetrics.metricsMap.HILL_SCORE[0].value` / `ENDURANCE_SCORE[0].value` | ✅ Correct (also tries `data.get("value")` first) |

### Bugs found and fixed
1. **`_fetch_hrv` — wrong nesting path**: The real response is `{"hrvSummary": {...}, "hrv": []}` where `hrv` is a raw readings array (often empty, always falsy). The original code `(data.get("hrv") or {}).get("hrvSummary")` returned `{}` for every call. Fixed to `data.get("hrvSummary") or {}`.

2. **`_fetch_training_status` — completely wrong keys**: The response uses `mostRecentTrainingStatus → latestTrainingStatusData → {sportKey: {trainingStatus, acuteTrainingLoadDTO: {dailyTrainingLoadAcute, dailyTrainingLoadChronic}}}`, not `trainingStatusDTO → latestTrainingStatusWeek → {acuteLoad, chronicLoad}`. Fixed to use the correct path.

3. **`_fetch_vo2max` — missing `allMetrics` wrapper**: The response has `item.allMetrics.metricsMap.VO2_MAX_RUNNING[].value`, not `item.metricsMap.VO2_MAX_RUNNING`. Fixed to navigate through `allMetrics`.

## Iteration log

- **Training load chart simplification (2026-07):** Replaced the separate acute-load and chronic-load charts with a single acute:chronic load ratio chart in the Training section. The ratio uses the aggregated acute and chronic bucket values, and its bars are color-coded yellow below `0.8`, green from `0.8` through `1.5`, and pink above `1.5`.
- **Body Battery range chart consolidation (2026-07-14):** Combined the separate Body Battery High/Low charts into a single floating-range chart in `GarminWellnessView` where each bar encodes the aggregated low→high spread for a bucket.
- **Body Battery tooltip + summary update (2026-07-14):** Updated hover and card summary text to show min→max values (`Avg low–high`) instead of separate high/low summaries.
- **Combined Activities + Wellness page (2026-07-14):** Merged the old separate activities (`#/garmin`) and wellness (`#/wellness`) views into one combined page with activities charts first, default range set to the current year, default aggregation set to day, and a single watch-icon toolbar entry point.
- **Combined Garmin page spacing cleanup (2026-07-14):** Removed the redundant Activities page heading on the merged Garmin page and rendered the activities + wellness sections inside one shared padded layout so the transition between them stays visually continuous.

## Follow-up extraction hardening

- Garmin exposes VO2 max in more than one shape depending on the endpoint payload and device profile. The sync now accepts top-level `generic`/`running` containers, direct `vo2Max*` keys, and both `VO2MAX_RUNNING` and `VO2_MAX_RUNNING` metric-map variants.
- Hill score and endurance score also arrive as direct `overallScore` values in some single-day responses, not only under `allMetrics.metricsMap.*`. The sync now prefers those single-day score fields and keeps the older metric-map fallback paths for compatibility.
- Added `scripts/test_garmin_wellness_sync.py` as an offline regression harness for these alternative response shapes so future Garmin API drift is easier to catch locally.

## Iteration notes
- The Recovery HRV chart now plots `hrvWeeklyAvg` instead of `hrvLastNight` so the visual trend reflects Garmin's rolling weekly signal rather than the noisier overnight reading.
- HRV bar colors continue to come from `hrvStatus` for the same underlying rows, with BALANCED/OPTIMAL = green, UNBALANCED = yellow, and LOW = red.
- Training status now normalizes Garmin's numeric/status-phrase variants to stable enum text before writing or reading sheet rows. The sync prefers `trainingStatusFeedbackPhrase` / `trainingStatusKey` when available, and falls back to numeric-code mapping so values like `4` render as `MAINTAINING` instead of a raw number.
- VO₂ Max, Hill Score, and Endurance Score charts now use fixed threshold palettes instead of the default accent color so their bars show Garmin-style fitness bands at a glance. The VO₂ Max request specified a `fair` band without a color, which is implemented as orange to keep the palette aligned with the other wellness threshold charts.
- Training Status now hides its full legend by default and exposes the palette as compact header swatches that open a popover, so the label can be inspected one color at a time without permanently taking chart space.
- Added a toolbar visibility toggle in Settings for the combined Garmin page (`app.showGarminTab`). The Garmin/Wellness tab is off by default and only shown when enabled.
- Garmin wellness chart legends are now title-triggered popovers (no always-visible swatches), with updated threshold text for Training Readiness, Load Ratio, VO₂ Max, Hill Score, Endurance Score, and HRV Status. In day aggregation, the header now appends the active legend band label beside the numeric value for those charts.
- Goal harvesting fix (2026-07-14): `_fetch_goals` fetched the daily user summary but read the floors goal from the wrong key (`floorsAscendedGoal`; Garmin uses `userFloorsAscendedGoal`). Because the code passed each raw value through `_num` (which returns `""` for a missing field) and then called `int("")`, a single missing/renamed field raised `ValueError`, which the broad `except` swallowed — so *no* goals were written to the Settings tab. Extracted a pure `parse_goals(data)` helper that coerces each field with a tolerant `_positive_int` (None/zero/invalid → skipped, never raises) and accepts field aliases for all three goals. Regression coverage added to `scripts/test_garmin_wellness_sync.py`.
- Garmin page split cleanup (2026-07-18): the combined `#/garmin` page was simplified back to wellness-only content, keeping its shared range / aggregation controls and switching the toolbar entry to a Heart Pulse icon labeled “Wellness.” The separate `#/garmin-activities` page now owns the Garmin activity charts plus the searchable activity list, with the same range / aggregation buttons copied over so all activity-specific data lives on one tab.
- Hourly cadence + 24-hour window (2026-07-22): The scheduled sync now defaults to a last-24-hours window (`ROLLING_DAYS = 2`, today + yesterday to cover midnight) instead of a 14-day rolling window, and runs every hour on the hour (`cron: "0 * * * *"`) instead of once daily. The cron is intentionally kept simple with no time-zone/DST gating — since the sync only looks back 24 hours, running around the clock is cheap and guarantees near-continual updates. Manual `workflow_dispatch` runs can still pass `--backfill` for a full since-2021 index. If an hourly scheduled run fails (e.g. Garmin API rate limits), the workflow opens/comments a single deduplicated `garmin-sync`-labeled issue so the cron can be tuned.
- Wellness sync lookback extension (2026-08-04): Expanded the default overwrite window to 72 hours (`ROLLING_DAYS = 4`, today plus the prior three calendar days). This lets the hourly sync repair rows that were only partially populated while the device was offline.
- Daily stress estimation (2026-07-22): Added an `avgStress` column (26th column, Z) to the wellness sync and sheet schema, sourced from `get_user_summary().averageStressLevel`. Garmin's no-data sentinels (`-1`/`-2`, device not worn) are coerced to blank via a dedicated `_stress` helper. The Recovery section now renders a Stress bar chart **above** the HRV chart, using fixed color bands: 0–25 Rest (blue), 26–50 Low (yellow), 51–75 Medium (orange), 76–100 High (red). Offline coverage added in `scripts/test_garmin_wellness_sync.py`.
- Heat + altitude acclimation charts (2026-07-23): The wellness sync now harvests Garmin acclimation data from the training-status payload, accepting both the top-level `heatAltitudeAcclimationDTO` shape and the older `mostRecentVO2Max.heatAltitudeAcclimation` fallback. The sheet schema grew to 29 columns (A:AC) with `heatAcclimationPct`, `altitudeAcclimationPct`, and `currentAltitude`, and the Wellness page now renders uncoded Heat Acclimation and Altitude Acclimation bar charts at the bottom of the Training section.
- Training Status categorical dot chart (2026-08-15): Replaced the full-height status bars with dots positioned on a fixed nine-level categorical y-axis. The legend and scale run from Peaking at 9 through No status at 1, preserving the existing relative status order between those endpoints.
- Altitude chart correction (2026-08-04): Garmin's `altitudeAcclimationPct` value is an acclimated elevation in meters despite the legacy field name, not a percentage. The Wellness page now combines current altitude bars with an altitude-adaptation line on one shared axis and converts both series to feet for display.
- Selected chart dots (2026-08-15): Replaced bars with filled dots for Training Readiness, Load Ratio, Low/High Aerobic Load, Anaerobic Load, VO₂ Max, Hill Score, Endurance Score, HRV Status, Resting Heart Rate, and Sleep Score. Axes, dimensions, colors, range overlays, summaries, and tooltips remain unchanged; all other wellness charts retain their existing visualization.
- Chart dot sizing (2026-08-15): Tripled the radius of Garmin wellness chart dots, including active dots and load-focus dots, to improve visibility.
- Additional chart cleanup (2026-08-15): Reduced all wellness dot radii by 10%, switched Heat Acclimation and Stress from bars to dots, and rounded Hill Score and Endurance Score display values to whole numbers.
- Sleep-hours goal (2026-08-15): Added a manually configurable daily sleep target under Garmin Goals. The sleep-duration bars now use the same below/met/exceeded colors and legend as steps and floors, with the hours setting converted to seconds for chart comparisons.
- Sleep-hours goal correction (2026-08-15): Sleep chart buckets are already converted from seconds to average hours, so goal coloring now compares those displayed hours directly with the daily hours goal for every aggregation. This fixes nights above the goal incorrectly appearing below goal.
- Intensity-minutes goal scaling (2026-08-15): The Garmin intensity target is weekly. Daily bars compare against one seventh of that target, weekly bars use it directly, and monthly bars compare against the computed daily target multiplied by the number of calendar days represented in the bucket.
