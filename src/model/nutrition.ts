/**
 * Nutrition chart model — aggregates daily meal-log values (calories, protein,
 * alcoholic drinks) into day/week/month buckets for the charts at the bottom of
 * the Nutrition page.
 *
 * Reuses the strava.ts bucketing engine (`generateBucketSlots`, `getBucketKey`,
 * `getRangeStart`, `getRangeEnd`) so the aggregation matches the rest of the app.
 *
 * Unlike the strava charts (which prorate a single annual goal), nutrition goals
 * are per-day targets. Each bucket's goal is the daily goal multiplied by the
 * number of elapsed days that fall inside the bucket, so a "1 drink/day" goal
 * shows a weekly goal line at 7 while an in-progress bucket scales to the days
 * so far — keeping the goal-vs-actual color coding fair.
 */
import type { FoodItem, MealCategory, MealLogEntry } from './types.js';
import type { StravaAggregation, StravaTimeRange } from './strava.js';
import { generateBucketSlots, getBucketKey, getRangeStart, getRangeEnd } from './strava.js';

export type NutritionMetric = 'calories' | 'protein' | 'fiber' | 'drinks';

export interface NutritionBucket {
  label: string;
  value: number;
  /** Aggregated goal for this bucket (0 when no goal is configured or the bucket has no elapsed days). */
  goal: number;
  colorKey: NutritionColorKey;
}

export interface NutritionChartData {
  metric: NutritionMetric;
  buckets: NutritionBucket[];
  /** Sum of the metric across the whole range. */
  total: number;
  /** The configured per-day goal (0 = disabled). */
  goalPerDay: number;
  /** Value of the most recent non-empty bucket, or null. */
  latestValue: number | null;
}

export const NUTRITION_METRIC_LABELS: Record<NutritionMetric, string> = {
  calories: 'Calories',
  protein: 'Protein',
  fiber: 'Fiber',
  drinks: 'Alcoholic Drinks',
};

export const NUTRITION_METRIC_UNITS: Record<NutritionMetric, string> = {
  calories: 'cal',
  protein: 'g',
  fiber: 'g',
  drinks: 'drinks',
};

/** Goal-band colors: yellow under 90%, green within ±10%, red over by >10% (blue for protein over). */
export const NUTRITION_YELLOW = '#ffea00';
export const NUTRITION_GREEN = '#00e676';
export const NUTRITION_RED = '#ff1744';
export const NUTRITION_BLUE = '#2979ff';

/** Suggest the meal category for a new entry based on the user's local time. */
export function suggestedMealCategory(now: Date = new Date()): MealCategory {
  const hour = now.getHours();
  if (hour >= 6 && hour < 11) return 'Breakfast';
  if (hour >= 11 && hour < 14) return 'Lunch';
  if (hour >= 14 && hour < 17) return 'Snacks';
  if (hour >= 17 && hour < 20) return 'Dinner';
  return 'Snacks';
}

function normalizeFoodLabel(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function canonicalFoodCode(code: string): string {
  if (!/^\d+$/.test(code)) return code;
  return code.replace(/^0+(?=\d)/, '');
}

function foodSearchFingerprint(food: FoodItem): string {
  return [
    normalizeFoodLabel(food.name),
    normalizeFoodLabel(food.brand),
    food.calories,
    food.fat,
    food.carbs,
    food.fiber,
    food.protein,
    food.standardDrinks,
  ].join('\u0000');
}

/**
 * Remove repeated OFF search results while preserving the API's relevance order.
 * OFF can return the same product under UPC/EAN aliases or separate records with
 * cosmetic label differences, so identity includes both barcode and food data.
 */
export function deduplicateFoodSearchResults(foods: FoodItem[]): FoodItem[] {
  const seenCodes = new Set<string>();
  const seenFingerprints = new Set<string>();
  return foods.filter((food) => {
    const code = canonicalFoodCode(food.code);
    const fingerprint = foodSearchFingerprint(food);
    if (seenCodes.has(code) || seenFingerprints.has(fingerprint)) return false;
    seenCodes.add(code);
    seenFingerprints.add(fingerprint);
    return true;
  });
}

/** Goal-band colors: yellow under, green met, red over (calories/alcohol), blue over (protein) or under (alcohol). */
export type NutritionColorKey = 'under' | 'met' | 'over' | 'bonus' | '';

/** Resolve a color-band value/goal comparison into a color key. */
export function nutritionColorKey(value: number, goal: number, metric: NutritionMetric): NutritionColorKey {
  if (goal <= 0) return '';
  const ratio = value / goal;
  if (ratio < 0.9) {
    // Under-drinking is a positive outcome (blue); under-eating calories/protein/fiber is a warning (yellow).
    return metric === 'drinks' ? 'bonus' : 'under';
  }
  if (ratio <= 1.1) return 'met';
  // Protein/fiber over goal is a positive outcome (blue); calories/alcohol over is negative (red).
  return metric === 'protein' || metric === 'fiber' ? 'bonus' : 'over';
}

/** Map a color key to its rendered fill color; `fallback` for the empty key. */
export function nutritionColor(colorKey: NutritionColorKey, fallback: string): string {
  switch (colorKey) {
    case 'under': return NUTRITION_YELLOW;
    case 'met': return NUTRITION_GREEN;
    case 'over': return NUTRITION_RED;
    case 'bonus': return NUTRITION_BLUE;
    default: return fallback;
  }
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The value a single log entry contributes to a metric (scaled by servings). */
function entryValue(entry: MealLogEntry, metric: NutritionMetric): number {
  const base = metric === 'calories' ? entry.calories
    : metric === 'protein' ? entry.protein
    : metric === 'fiber' ? entry.fiber
    : entry.standardDrinks;
  return base * entry.quantity;
}

/**
 * Build bucketed chart data for a nutrition metric.
 *
 * @param entries    all meal-log entries (filtered internally to the range).
 * @param metric     which value to sum.
 * @param range      time-range key (shared with strava/garmin ranges).
 * @param goalPerDay per-day goal (0 disables the goal line and color coding).
 * @param today      reference "now" for range bounds and elapsed-day counting.
 * @param aggregation day/week/month.
 */
export function buildNutritionChartData(
  entries: MealLogEntry[],
  metric: NutritionMetric,
  range: StravaTimeRange,
  goalPerDay: number,
  today: Date = new Date(),
  aggregation: StravaAggregation = 'week',
): NutritionChartData {
  const start = getRangeStart(range, today);
  const end = getRangeEnd(range, today);
  const startISO = toISODate(start);
  const endISO = toISODate(end);
  const todayISO = toISODate(today);

  const slots = generateBucketSlots(range, aggregation, today);

  const valueByBucket = new Map<string, number>();
  const goalDaysByBucket = new Map<string, number>();
  for (const { key } of slots) {
    valueByBucket.set(key, 0);
    goalDaysByBucket.set(key, 0);
  }

  // Sum logged values into buckets.
  for (const entry of entries) {
    if (entry.date < startISO || entry.date > endISO) continue;
    const key = getBucketKey(entry.date, aggregation);
    if (!valueByBucket.has(key)) continue;
    valueByBucket.set(key, (valueByBucket.get(key) ?? 0) + entryValue(entry, metric));
  }

  // Count elapsed days per bucket for goal aggregation (never beyond today).
  const goalEnd = endISO < todayISO ? endISO : todayISO;
  const cursor = new Date(start);
  while (toISODate(cursor) <= goalEnd) {
    const key = getBucketKey(toISODate(cursor), aggregation);
    if (goalDaysByBucket.has(key)) {
      goalDaysByBucket.set(key, (goalDaysByBucket.get(key) ?? 0) + 1);
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  let total = 0;
  const buckets: NutritionBucket[] = slots.map(({ key, label }) => {
    const value = valueByBucket.get(key) ?? 0;
    total += value;
    const goal = goalPerDay > 0 ? goalPerDay * (goalDaysByBucket.get(key) ?? 0) : 0;
    return { label, value, goal, colorKey: nutritionColorKey(value, goal, metric) };
  });

  // Show the value for the bucket that contains today (even if 0), rather than
  // the last bucket that happened to have a non-zero value.
  const todayKey = getBucketKey(todayISO, aggregation);
  const todayBucket = slots.findIndex(({ key }) => key === todayKey);
  const latestValue = todayBucket >= 0
    ? buckets[todayBucket].value
    : ([...buckets].reverse().find((b) => b.value > 0)?.value ?? null);

  return { metric, buckets, total, goalPerDay, latestValue };
}

/** Format a nutrition value for axis labels and headers. */
export function formatNutritionValue(v: number, metric: NutritionMetric): string {
  if (metric === 'drinks') {
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (v >= 100) return String(Math.round(v));
  if (v >= 10) return v.toFixed(0);
  return v.toFixed(1);
}
