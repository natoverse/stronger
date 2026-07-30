import { describe, expect, it } from 'vitest';
import type { FoodItem, MealLogEntry } from '../types.ts';
import {
  buildNutritionChartData,
  deduplicateFoodSearchResults,
  nutritionColorKey,
  formatNutritionValue,
  suggestedMealCategory,
} from '../nutrition.ts';

function entry(date: string, over: Partial<MealLogEntry> = {}): MealLogEntry {
  return {
    id: `${date}-${Math.random()}`,
    date,
    name: 'x',
    category: 'Snacks',
    calories: 0,
    fat: 0,
    carbs: 0,
    fiber: 0,
    protein: 0,
    standardDrinks: 0,
    quantity: 1,
    ...over,
  };
}

function food(code: string, over: Partial<FoodItem> = {}): FoodItem {
  return {
    code,
    name: 'Peanut Butter',
    brand: 'Example Foods',
    servingLabel: '2 tbsp (32 g)',
    calories: 190,
    fat: 16,
    carbs: 7,
    fiber: 2,
    protein: 8,
    standardDrinks: 0,
    ...over,
  };
}

describe('deduplicateFoodSearchResults', () => {
  it('collapses repeated barcodes, including UPC/EAN leading-zero aliases', () => {
    const first = food('0123456789012');
    expect(deduplicateFoodSearchResults([first, food('123456789012')])).toEqual([first]);
  });

  it('collapses equivalent records with cosmetic label and serving differences', () => {
    const first = food('1');
    const duplicate = food('2', {
      name: '  peanut-butter ',
      brand: 'EXAMPLE FOODS',
      servingLabel: '32g',
    });
    expect(deduplicateFoodSearchResults([first, duplicate])).toEqual([first]);
  });

  it('keeps products with a different brand, name, or nutrition', () => {
    const foods = [
      food('1'),
      food('2', { brand: 'Other Foods' }),
      food('3', { name: 'Crunchy Peanut Butter' }),
      food('4', { calories: 200 }),
    ];
    expect(deduplicateFoodSearchResults(foods)).toEqual(foods);
  });
});

describe('suggestedMealCategory', () => {
  it.each([
    [0, 'Snacks'],
    [5, 'Snacks'],
    [6, 'Breakfast'],
    [10, 'Breakfast'],
    [11, 'Lunch'],
    [13, 'Lunch'],
    [14, 'Snacks'],
    [16, 'Snacks'],
    [17, 'Dinner'],
    [19, 'Dinner'],
    [20, 'Snacks'],
    [23, 'Snacks'],
  ] as const)('suggests %s:00 as %s', (hour, expected) => {
    expect(suggestedMealCategory(new Date(2026, 6, 30, hour))).toBe(expected);
  });
});

describe('nutritionColorKey', () => {
  it('returns empty when goal is disabled', () => {
    expect(nutritionColorKey(500, 0, 'calories')).toBe('');
  });
  it('bands under 90%, within 10%, and over 10% for calories', () => {
    expect(nutritionColorKey(89, 100, 'calories')).toBe('under');
    expect(nutritionColorKey(90, 100, 'calories')).toBe('met');
    expect(nutritionColorKey(110, 100, 'calories')).toBe('met');
    expect(nutritionColorKey(111, 100, 'calories')).toBe('over');
  });
  it('uses bonus (blue) instead of over (red) when protein exceeds goal', () => {
    expect(nutritionColorKey(111, 100, 'protein')).toBe('bonus');
    expect(nutritionColorKey(90, 100, 'protein')).toBe('met');
    expect(nutritionColorKey(89, 100, 'protein')).toBe('under');
  });
  it('uses bonus (blue) instead of over (red) when fiber exceeds goal', () => {
    expect(nutritionColorKey(111, 100, 'fiber')).toBe('bonus');
    expect(nutritionColorKey(90, 100, 'fiber')).toBe('met');
    expect(nutritionColorKey(89, 100, 'fiber')).toBe('under');
  });
  it('uses over (red) when drinks exceed goal, bonus (blue) when under goal', () => {
    expect(nutritionColorKey(111, 100, 'drinks')).toBe('over');
    expect(nutritionColorKey(89, 100, 'drinks')).toBe('bonus');
  });
});

describe('formatNutritionValue', () => {
  it('formats drinks as integers when whole', () => {
    expect(formatNutritionValue(2, 'drinks')).toBe('2');
    expect(formatNutritionValue(1.5, 'drinks')).toBe('1.5');
  });
  it('formats large calories with k suffix', () => {
    expect(formatNutritionValue(2100, 'calories')).toBe('2.1k');
  });
});

describe('buildNutritionChartData', () => {
  const today = new Date('2026-06-15T12:00:00');

  it('sums a metric scaled by servings into day buckets', () => {
    const entries = [
      entry('2026-06-14', { calories: 100, quantity: 2 }),
      entry('2026-06-14', { calories: 50 }),
      entry('2026-06-15', { calories: 300 }),
    ];
    const data = buildNutritionChartData(entries, 'calories', 'month', 0, today, 'day');
    const byLabel = new Map(data.buckets.map((b) => [b.label, b.value]));
    expect(byLabel.get('6/14')).toBe(250);
    expect(byLabel.get('6/15')).toBe(300);
    expect(data.total).toBe(550);
  });

  it('aggregates a per-day goal to 7 for a full week bucket', () => {
    // Two full past weeks worth of drinks; goal 1/day → weekly goal 7.
    const entries: MealLogEntry[] = [];
    for (let d = 1; d <= 7; d++) {
      entries.push(entry(`2026-06-0${d}`, { standardDrinks: 1, category: 'Drinks' }));
    }
    const data = buildNutritionChartData(entries, 'drinks', 'month', 1, today, 'week');
    // The bucket covering June 1-7 should have goal 7 and value 7 → met.
    const full = data.buckets.find((b) => b.value === 7);
    expect(full).toBeDefined();
    expect(full?.goal).toBe(7);
    expect(full?.colorKey).toBe('met');
  });

  it('does not count future days toward the goal', () => {
    // Range 'month' includes days after today; those buckets get no goal.
    const data = buildNutritionChartData([], 'calories', 'month', 2000, today, 'day');
    const future = data.buckets.filter((b) => b.label === '6/20');
    if (future.length > 0) {
      expect(future[0].goal).toBe(0);
      expect(future[0].colorKey).toBe('');
    }
    // A past day within range gets the daily goal.
    const past = data.buckets.find((b) => b.label === '6/10');
    expect(past?.goal).toBe(2000);
  });

  it('latestValue shows today bucket value even when 0 (e.g. no drinks today)', () => {
    // Yesterday had drinks; today has none.
    const entries = [entry('2026-06-14', { standardDrinks: 2, category: 'Drinks' })];
    const data = buildNutritionChartData(entries, 'drinks', 'month', 1, today, 'day');
    // latestValue should be today's value (0), not yesterday's (2).
    expect(data.latestValue).toBe(0);
  });
});
