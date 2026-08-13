# Feature: Nutrition trend charts

## What

Add three bar charts to the bottom of the Nutrition page — total calories, grams of
protein, and number of alcoholic drinks — matching the Garmin-page chart styling.
Each chart draws a goal line and color-codes its bars against the (aggregated) goal.

## Decisions

- **Metrics & goals**: calories and protein reuse the existing `app.dailyCalorieGoal`
  and `app.dailyProteinGoalGrams` settings. A new per-day setting
  `app.drinksPerDayGoal` (default `0` = disabled) drives the alcoholic-drinks chart.
- **Tracking alcoholic drinks**: `MealItem`/`MealLogEntry` gained a `standardDrinks`
  field (number of standard drinks per serving, default `0`). It is entered via an
  "Alcoholic drinks" input in the Save-Item and Quick-Add forms and scaled by the
  logged serving quantity, so a double counts as 2 and half a glass as 0.5.
- **Color banding** (uniform across all three charts): yellow when under 90% of the
  bucket goal, green when within ±10%, red when over the goal by more than 10%.
  The same banding colors the day's totals summary chips.
- **Aggregation**: day/week/month buttons plus the shared time-range buttons live in
  the Trends section at the bottom of the page (defaults: month range, day
  aggregation). Food management (search, saved items, quick add) stays at the top.
- **Goal aggregation**: each bucket's goal is `dailyGoal × elapsed days in the
  bucket`, so a "1 drink/day" goal shows a weekly goal line at 7 and a monthly line
  at ~30. Future days are not counted, and in-progress buckets scale to the days so
  far, keeping the goal-vs-actual color comparison fair. The goal line only connects
  buckets that have a goal (skips future buckets).

## Notes

- **Storage schema**: `Stronger - Meal Items` now spans `A:I` (`…`, `protein`,
  `standardDrinks`). `Stronger - Meal Log` now spans `A:K`; `standardDrinks` is
  appended *after* `quantity` (column K) so the existing `quantity` column keeps its
  index 9 — legacy rows without either column default `quantity` to 1 and
  `standardDrinks` to 0.
- **Model**: `src/model/nutrition.ts` builds the bucketed chart data, reusing the
  strava.ts bucketing engine (`generateBucketSlots`, `getBucketKey`,
  `getRangeStart`, `getRangeEnd`; `getBucketKey` was exported for this). It exposes
  `buildNutritionChartData`, `nutritionColorKey`, `nutritionColor`, and
  `formatNutritionValue`.
- **UI**: `src/components/NutritionCharts.tsx` renders the SVG bar charts, reusing the
  shared `strava-chart-*` / `strava-bar` / `strava-goal-line` CSS classes and the
  `useChartTooltip` hook. Bars are filled per-bucket via `nutritionColor`.
- **Tests**: `src/model/__tests__/nutrition.test.ts` covers color banding, value
  formatting, serving-scaled bucket sums, weekly goal aggregation to 7, and exclusion
  of future days. `src/google/__tests__/meal-data.test.ts` covers the new column with
  backward-compatible legacy-row parsing.

## Merge update (nutrition food-finder revamp, spec 036)

This charts feature was merged on top of the OFF food-finder revamp
(`specs/036-nutrition-food-finder.spec.md`), which replaced the saved Meal
Items library and Quick-Add forms with a favorites/recents/search finder.
Decisions adapted during the merge:

- The `Stronger - Meal Items` tab (and its `verify`/`create` helpers) was removed
  by the food-finder revamp. `standardDrinks` therefore lives only on the meal
  **log** (`Stronger - Meal Log`, still `A:K`, `standardDrinks` at column K after
  `quantity`) plus the shared `MealItem` type used for log serialization.
- Alcoholic drinks are now entered in the food finder: when a food's meal is set
  to **Drinks**, a compact "Alcoholic drinks" input appears in the food row and is
  scaled by the logged serving quantity. The old Save-Item/Quick-Add drink inputs
  no longer exist.
- The Trends charts and their day/week/month controls render at the bottom of the
  finder page, below "Today's Meals"; the goal-banded totals chips (including the
  drinks chip) remain at the top.

## Iteration: daily fiber goal, display, and chart

Added a fiber goal that mirrors protein end-to-end:

- **Setting**: new per-day `app.dailyFiberGoalGrams` (default `0` = disabled),
  added to `AppSettings`/`AppNumericSettingKey`, `DEFAULT_APP_SETTINGS`, and the
  Settings tab number-key map (0–1000g). A "Daily Fiber" input sits below
  "Daily Protein" in `SettingsView`.
- **Display**: the Fiber totals chip is now color-coded (`fiberGoalStatus`) and
  shows `current / goal` g, exactly like protein.
- **Chart**: a Fiber chart renders directly below the Protein chart. The `fiber`
  metric was added to `NutritionMetric` (label `Fiber`, unit `g`, `entryValue`
  reads `entry.fiber`). Like protein, fiber over goal is a positive outcome
  (blue `bonus`); under goal is a yellow `under` warning.

## Iteration: aggregate chart summaries

- Nutrition chart headers always show the total across the active date range first.
  They then append the most recent bucket as `Last …`, allowing weekly and monthly
  views to distinguish the period total from the latest period.
