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
  standardDrinks: 0,
};

describe('meal item data', () => {
  it('round-trips a saved meal item with all macros', () => {
    expect(parseMealItemRow(mealItemToRow(item).map(String))).toEqual(item);
  });

  it('round-trips a saved item that records standard drinks', () => {
    const beer = { ...item, id: 'beer', name: 'IPA', category: 'Drinks' as const, standardDrinks: 1.5 };
    expect(parseMealItemRow(mealItemToRow(beer).map(String))).toEqual(beer);
  });

  it('rejects missing names, invalid categories, and negative macros', () => {
    expect(parseMealItemRow(['id', '', 'Breakfast', '1', '0', '0', '0', '0'])).toBeNull();
    expect(parseMealItemRow(['id', 'Oats', 'Other', '1', '0', '0', '0', '0'])).toBeNull();
    expect(parseMealItemRow(['id', 'Oats', 'Breakfast', '-1', '0', '0', '0', '0'])).toBeNull();
  });

  it('defaults legacy item rows without a standardDrinks column to 0', () => {
    const legacyRow = ['oats', 'Oats', 'Breakfast', '150', '3', '27', '4', '5'];
    expect(parseMealItemRow(legacyRow)?.standardDrinks).toBe(0);
  });

  it('round-trips a daily log entry', () => {
    const entry = { ...item, id: 'log-1', date: '2026-07-12', quantity: 1 };
    expect(parseMealLogRow(mealLogEntryToRow(entry).map(String))).toEqual(entry);
  });

  it('round-trips a fractional serving quantity', () => {
    const entry = { ...item, id: 'log-2', date: '2026-07-12', quantity: 0.5 };
    expect(parseMealLogRow(mealLogEntryToRow(entry).map(String))).toEqual(entry);
  });

  it('round-trips a log entry with standard drinks', () => {
    const entry = { ...item, id: 'log-drink', name: 'IPA', category: 'Drinks' as const, date: '2026-07-12', quantity: 2, standardDrinks: 1 };
    expect(parseMealLogRow(mealLogEntryToRow(entry).map(String))).toEqual(entry);
  });

  it('defaults legacy log rows without quantity/standardDrinks columns', () => {
    const legacyRow = ['2026-07-12', 'log-3', 'Oats', 'Breakfast', '150', '3', '27', '4', '5'];
    const parsed = parseMealLogRow(legacyRow);
    expect(parsed?.quantity).toBe(1);
    expect(parsed?.standardDrinks).toBe(0);
  });
});
