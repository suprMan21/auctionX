/**
 * Admin console UX-3 — time frames for the dashboard growth charts, in the
 * viewer's own days (same rule as the audit log time filter). Dates are local
 * calendar days as YYYY-MM-DD, both ends inclusive; the server applies the
 * viewer's time zone.
 */

import type { GrowthBucket } from '../api/growthSchemas';

export type GrowthPreset = 'month' | 'year' | 'custom';

export interface GrowthRange {
  from: string;
  to: string;
  bucket: GrowthBucket;
}

/** Caps match the server (lib/admin/growthStats.ts). */
export const MAX_DAYS = 366;
export const MAX_MONTHS = 60;
/** A custom range up to this many days is shown by day; longer, by month. */
export const DAILY_UP_TO = 92;

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar day of a Date as YYYY-MM-DD. */
export const localDay = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const parseDay = (day: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return localDay(d) === day ? d : null;
};

/** Whole days from `from` to `to`, counting both ends. */
export const daysInclusive = (from: string, to: string): number => {
  const a = parseDay(from);
  const b = parseDay(to);
  if (!a || !b) return NaN;
  // Date.UTC avoids a clock-change day counting as 23 or 25 hours.
  const ms = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  return Math.round(ms / 86_400_000) + 1;
};

const monthsInclusive = (from: string, to: string): number => {
  const a = parseDay(from);
  const b = parseDay(to);
  if (!a || !b) return NaN;
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
};

/** Month: the last 30 days, one point a day. Year: the last 12 months, one point a month. */
export const presetRange = (preset: Exclude<GrowthPreset, 'custom'>, now: Date = new Date()): GrowthRange => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === 'month') {
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
    return { from: localDay(from), to: localDay(today), bucket: 'day' };
  }
  const from = new Date(today.getFullYear(), today.getMonth() - 11, 1);
  return { from: localDay(from), to: localDay(today), bucket: 'month' };
};

/** A custom from/to, or the reason it cannot be shown. */
export const customRange = (from: string, to: string): GrowthRange | { error: string } => {
  if (!parseDay(from) || !parseDay(to)) return { error: 'Pick both dates.' };
  const days = daysInclusive(from, to);
  if (days < 1) return { error: 'From must be on or before To.' };
  if (days <= DAILY_UP_TO) return { from, to, bucket: 'day' };
  if (monthsInclusive(from, to) > MAX_MONTHS) return { error: `Pick at most ${MAX_MONTHS / 12} years.` };
  return { from, to, bucket: 'month' };
};

/** The viewer's IANA time zone; UTC if the browser does not say. */
export const viewerTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/** Axis / table label for a bucket start. */
export const bucketLabel = (start: string, bucket: GrowthBucket, style: 'short' | 'long' = 'short'): string => {
  const d = parseDay(start);
  if (!d) return start;
  if (bucket === 'month') {
    return d.toLocaleDateString(undefined, style === 'short' ? { month: 'short' } : { month: 'long', year: 'numeric' });
  }
  return d.toLocaleDateString(undefined, style === 'short' ? { month: 'short', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};
