import { describe, expect, it } from 'vitest';
import { hrvStatusColor } from '../GarminWellnessView.js';

describe('hrvStatusColor', () => {
  it('maps balanced, low, and unbalanced HRV statuses to the requested colors', () => {
    expect(hrvStatusColor('BALANCED')).toBe('#00e676');
    expect(hrvStatusColor('LOW')).toBe('#ff5252');
    expect(hrvStatusColor('UNBALANCED')).toBe('#ffd740');
  });
});
