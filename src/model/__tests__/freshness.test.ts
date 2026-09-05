import { describe, it, expect } from 'vitest';
import { formatFreshnessLabel, formatShortDate, latestDateString } from '../freshness.js';

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

describe('formatShortDate', () => {
  it('formats as "Mon. D"', () => {
    expect(formatShortDate('2026-09-04')).toBe('Sep. 4');
  });

  it('returns null for missing or invalid input', () => {
    expect(formatShortDate(null)).toBeNull();
    expect(formatShortDate('not-a-date')).toBeNull();
    expect(formatShortDate('2026-13-45')).toBeNull();
    expect(formatShortDate('2026-02-31')).toBeNull();
  });

  it('omits the period for unabbreviated months', () => {
    expect(formatShortDate('2026-05-04')).toBe('May 4');
  });
});

describe('formatFreshnessLabel', () => {
  it('prefixes the source name', () => {
    expect(formatFreshnessLabel('Withings', ['2026-09-01', '2026-09-04'])).toBe('Withings: Sep. 4');
    expect(formatFreshnessLabel('Garmin', ['2026-12-25'])).toBe('Garmin: Dec. 25');
  });

  it('returns null when there is no data', () => {
    expect(formatFreshnessLabel('Garmin', [])).toBeNull();
  });
});
