import { describe, expect, it } from 'vitest';
import { mealItemToRow, mealLogEntryToRow, parseMealItemRow, parseMealLogRow } from '../sheets.ts';

const item = {
  id: 'oats',
  name: 'Oats',
  category: 'Breakfast' as const,
  calories: 150,
  fat: 3,
  carbs: 27,
  fiber: 4,
  protein: 5,
};

describe('meal item data', () => {
  it('round-trips a saved meal item with all macros', () => {
    expect(parseMealItemRow(mealItemToRow(item).map(String))).toEqual(item);
  });

  it('rejects missing names, invalid categories, and negative macros', () => {
    expect(parseMealItemRow(['id', '', 'Breakfast', '1', '0', '0', '0', '0'])).toBeNull();
    expect(parseMealItemRow(['id', 'Oats', 'Other', '1', '0', '0', '0', '0'])).toBeNull();
    expect(parseMealItemRow(['id', 'Oats', 'Breakfast', '-1', '0', '0', '0', '0'])).toBeNull();
  });

  it('round-trips a daily log entry', () => {
    const entry = { ...item, id: 'log-1', date: '2026-07-12', quantity: 1 };
    expect(parseMealLogRow(mealLogEntryToRow(entry).map(String))).toEqual(entry);
  });

  it('round-trips a fractional serving quantity', () => {
    const entry = { ...item, id: 'log-2', date: '2026-07-12', quantity: 0.5 };
    expect(parseMealLogRow(mealLogEntryToRow(entry).map(String))).toEqual(entry);
  });

  it('defaults legacy log rows without a quantity column to 1 serving', () => {
    const legacyRow = ['2026-07-12', 'log-3', 'Oats', 'Breakfast', '150', '3', '27', '4', '5'];
    expect(parseMealLogRow(legacyRow)?.quantity).toBe(1);
  });
});
