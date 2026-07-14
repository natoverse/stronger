import { describe, expect, it } from 'vitest';
import { hrvStatusColor } from '../GarminWellnessView.js';

describe('hrvStatusColor', () => {
  it('maps balanced, low, and unbalanced HRV statuses to the requested colors', () => {
    expect(hrvStatusColor('BALANCED')).toBe('var(--color-good)');
    expect(hrvStatusColor('LOW')).toBe('var(--color-bad)');
    expect(hrvStatusColor('UNBALANCED')).toBe('var(--color-warning)');
  });
});
