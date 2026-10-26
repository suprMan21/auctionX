/**
 * Audit-log time presets, in the admin's own time zone. Returned as ISO strings
 * (UTC "Z"); `from` is inclusive and `to` exclusive, matching the API.
 */

export const TIME_RANGES = [
  { value: '', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
] as const;

export type TimeRangeValue = (typeof TIME_RANGES)[number]['value'];

export const isTimeRange = (value: string): value is TimeRangeValue =>
  TIME_RANGES.some((r) => r.value === value);

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** The [from, to) range for a preset, or nothing for "Any time". */
export const timeRangeOf = (value: TimeRangeValue, now: Date = new Date()): { from?: string; to?: string } => {
  const today = startOfDay(now);
  switch (value) {
    case 'today':
      return { from: today.toISOString(), to: addDays(today, 1).toISOString() };
    case 'yesterday':
      return { from: addDays(today, -1).toISOString(), to: today.toISOString() };
    case '7d':
      return { from: addDays(today, -6).toISOString(), to: addDays(today, 1).toISOString() };
    case '30d':
      return { from: addDays(today, -29).toISOString(), to: addDays(today, 1).toISOString() };
    default:
      return {};
  }
};
