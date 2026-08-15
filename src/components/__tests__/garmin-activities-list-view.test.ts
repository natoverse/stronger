import { describe, expect, it } from 'vitest';
import {
  formatDistance,
  formatDuration,
  formatElevation,
} from '../GarminActivitiesListView.js';

describe('Garmin activity card formatting', () => {
  it('formats duration as hours and zero-padded minutes', () => {
    expect(formatDuration(45 * 60)).toBe('0:45');
    expect(formatDuration(65 * 60)).toBe('1:05');
    expect(formatDuration(0)).toBe('—');
  });

  it('formats distance without a space before miles', () => {
    expect(formatDistance(1609.344)).toBe('1.00mi');
    expect(formatDistance(0)).toBe('');
  });

  it('formats elevation with a single quotation mark', () => {
    expect(formatElevation(30.48)).toBe('100‘');
    expect(formatElevation(0)).toBe('');
  });
});
