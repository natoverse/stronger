import { describe, it, expect } from 'vitest';
import { formatFreshnessLabel, formatShortDate, latestDateString, ordinalSuffix } from '../freshness.js';

describe('latestDateString', () => {
  it('returns the most recent date', () => {
    expect(latestDateString(['2026-08-31', '2026-09-04', '2026-01-15'])).toBe('2026-09-04');
  });

  it('ignores missing values', () => {
    expect(latestDateString([undefined, '', null, '2026-02-02'])).toBe('2026-02-02');
    expect(latestDateString([])).toBeNull();
  });

  it('ignores malformed dates that would sort above valid ones', () => {
    expect(latestDateString(['2026-02-02', 'not-a-date'])).toBe('2026-02-02');
  });
});

describe('ordinalSuffix', () => {
  it('handles the common cases', () => {
    expect(ordinalSuffix(1)).toBe('st');
    expect(ordinalSuffix(2)).toBe('nd');
    expect(ordinalSuffix(3)).toBe('rd');
    expect(ordinalSuffix(4)).toBe('th');
    expect(ordinalSuffix(21)).toBe('st');
  });

  it('handles the teens', () => {
    expect(ordinalSuffix(11)).toBe('th');
    expect(ordinalSuffix(12)).toBe('th');
    expect(ordinalSuffix(13)).toBe('th');
  });
});

describe('formatShortDate', () => {
  it('formats as "Weekday, Mon. Dth"', () => {
    expect(formatShortDate('2026-09-04')).toBe('Friday, Sept. 4th');
    expect(formatShortDate('2026-12-01')).toBe('Tuesday, Dec. 1st');
  });

  it('leaves short month names unabbreviated', () => {
    expect(formatShortDate('2026-05-03')).toBe('Sunday, May 3rd');
    expect(formatShortDate('2026-06-22')).toBe('Monday, June 22nd');
  });

  it('returns null for missing or invalid input', () => {
    expect(formatShortDate(null)).toBeNull();
    expect(formatShortDate('not-a-date')).toBeNull();
    expect(formatShortDate('2026-13-45')).toBeNull();
    expect(formatShortDate('2026-02-31')).toBeNull();
  });
});

describe('formatFreshnessLabel', () => {
  it('uses the most recent date, with no platform prefix', () => {
    expect(formatFreshnessLabel(['2026-09-01', '2026-09-04'])).toBe('Friday, Sept. 4th');
  });

  it('returns null when there is no data', () => {
    expect(formatFreshnessLabel([])).toBeNull();
  });
});
