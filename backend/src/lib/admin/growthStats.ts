/**
 * Admin console UX-3, AC 6 — dashboard growth request shape.
 *
 * The database function `admin_growth_series` re-checks every rule here; this
 * schema rejects a malformed request early with a message the console can show.
 */

import { z } from 'zod';
import { PERMISSIONS, type AdminPermission } from './permissions';

export const GROWTH_SERIES = ['tokens', 'accounts'] as const;
export const GROWTH_BUCKETS = ['day', 'month'] as const;
export type GrowthSeries = (typeof GROWTH_SERIES)[number];

/** Longest range per bucket (both ends inclusive). Matches the database function. */
export const MAX_DAYS = 366;
export const MAX_MONTHS = 60;
export const MAX_TZ_LENGTH = 64;

/** Who may read each series. */
export const SERIES_PERMISSION: Record<GrowthSeries, AdminPermission> = {
  tokens: PERMISSIONS.manageNfc,
  accounts: PERMISSIONS.viewUsers,
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date in YYYY-MM-DD (2026-02-30 is refused). */
const isCalendarDate = (value: string): boolean => {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
};

export const isValidTimeZone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const dayNumber = (value: string): number => {
  const [y, m, d] = value.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/** Days from `from` to `to`, both inclusive. */
export const daysInclusive = (from: string, to: string): number => dayNumber(to) - dayNumber(from) + 1;

/** Months from `from`'s month to `to`'s month, both inclusive. */
export const monthsInclusive = (from: string, to: string): number => {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
};

const localDate = (label: string) =>
  z.string({ required_error: `${label} is required.` })
    .refine(isCalendarDate, `${label} must be a real date in YYYY-MM-DD form.`);

export const growthQuerySchema = z.object({
  series: z.enum(GROWTH_SERIES, { errorMap: () => ({ message: 'Series must be tokens or accounts.' }) }),
  from: localDate('From'),
  to: localDate('To'),
  bucket: z.enum(GROWTH_BUCKETS, { errorMap: () => ({ message: 'Bucket must be day or month.' }) }),
  tz: z.string({ required_error: 'Time zone is required.' })
    .max(MAX_TZ_LENGTH, 'Time zone is not valid.')
    .refine(isValidTimeZone, 'Time zone is not valid.'),
}).strict().superRefine((q, ctx) => {
  if (q.from > q.to) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['from'], message: 'From must be on or before To.' });
    return;
  }
  if (q.bucket === 'day' && daysInclusive(q.from, q.to) > MAX_DAYS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: `Daily view covers at most ${MAX_DAYS} days. Pick a shorter range or view by month.` });
  }
  if (q.bucket === 'month' && monthsInclusive(q.from, q.to) > MAX_MONTHS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: `Monthly view covers at most ${MAX_MONTHS} months. Pick a shorter range.` });
  }
});

export type GrowthQuery = z.infer<typeof growthQuerySchema>;
