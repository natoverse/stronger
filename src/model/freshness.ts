/**
 * Data-freshness labels.
 *
 * Synced data sources (Withings, Garmin) can lag behind "today" when a sync
 * fails or a device hasn't uploaded. Charts alone don't make that obvious, so
 * each synced section shows the date of its most recent data point, e.g.
 * "Withings: Sep. 4".
 */

/** Returns the most recent YYYY-MM-DD date string, or null when there is none. */
export function latestDateString(dates: (string | undefined | null)[]): string | null {
  let latest: string | null = null;
  for (const date of dates) {
    if (!date) continue;
    if (latest === null || date > latest) latest = date;
  }
  return latest;
}

/** Formats a YYYY-MM-DD date as "Sep. 4". Returns null for unparseable input. */
export function formatShortDate(iso: string | null): string | null {
  if (!iso) return null;
  const [year, month, day] = iso.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const d = new Date(year, month - 1, day);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleDateString('en-US', { month: 'short' })}. ${d.getDate()}`;
}

/**
 * Builds a source freshness label such as "Withings: Sep. 4" from a set of
 * data dates. Returns null when no usable date exists.
 */
export function formatFreshnessLabel(
  source: string,
  dates: (string | undefined | null)[],
): string | null {
  const formatted = formatShortDate(latestDateString(dates));
  return formatted === null ? null : `${source}: ${formatted}`;
}
