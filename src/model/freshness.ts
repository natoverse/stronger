/**
 * Data-freshness labels.
 *
 * Synced data sources (Withings, Garmin) can lag behind "today" when a sync
 * fails or a device hasn't uploaded. Charts alone don't make that obvious, so
 * each synced section shows the date of its most recent data point, e.g.
 * "Monday, Sept. 4th".
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** AP-style month abbreviations; short months stay unabbreviated. */
const MONTH_LABELS = [
  'Jan.', 'Feb.', 'March', 'April', 'May', 'June',
  'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.',
];

const WEEKDAY_LABELS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

/** Returns the most recent YYYY-MM-DD date string, or null when there is none. */
export function latestDateString(dates: (string | undefined | null)[]): string | null {
  let latest: string | null = null;
  for (const date of dates) {
    if (!date || !ISO_DATE.test(date)) continue;
    if (latest === null || date > latest) latest = date;
  }
  return latest;
}

/** Returns the English ordinal suffix for a day of the month (1st, 2nd, 3rd...). */
export function ordinalSuffix(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

/**
 * Formats a YYYY-MM-DD date as "Monday, Sept. 4th".
 * Returns null for unparseable input.
 */
export function formatShortDate(iso: string | null): string | null {
  if (!iso) return null;
  const [year, month, day] = iso.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  // Reject dates that rolled over (e.g. Feb 31).
  if (Number.isNaN(d.getTime()) || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return `${WEEKDAY_LABELS[d.getDay()]}, ${MONTH_LABELS[month - 1]} ${day}${ordinalSuffix(day)}`;
}

/**
 * Builds a freshness label such as "Monday, Sept. 4th" from a set of data
 * dates. Returns null when no usable date exists.
 */
export function formatFreshnessLabel(dates: (string | undefined | null)[]): string | null {
  return formatShortDate(latestDateString(dates));
}
