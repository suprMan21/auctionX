/**
 * Shared display helpers for the admin console: one placeholder for an empty
 * value, one date format, one money format. Keeps every page saying it the
 * same way (and keeps em dashes off the screen).
 */

import { formatMoney } from '@/features/tokens/lib/copy';
import { AdminApiError } from '../api/adminApi';

/** Shown wherever a value is missing. */
export const NONE = 'None';

/** Date and time, in the viewer's locale. */
export const formatWhen = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString() : NONE;

/** Date only, in the viewer's locale. */
export const formatDay = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString() : NONE;

/** Minor units (cents) as money, e.g. "$3.00". Currency defaults to USD. */
export const formatAmount = (cents: number | null | undefined, currency?: string | null): string =>
  cents === null || cents === undefined ? NONE : formatMoney(cents, currency ?? 'usd');

/** The first 8 characters of an ID, for compact lists. */
export const shortId = (id: string | null | undefined): string => (id ? `${id.slice(0, 8)}…` : NONE);

/** Shown when an action fails and we cannot say whether it went through. */
export const ACTION_FAILED = 'That did not work. Try again, or check the audit log to see if it went through.';

/** "Tokens could not be loaded. Try again." */
export const loadFailed = (what: string): string => `${what} could not be loaded. Try again.`;

/**
 * The server's own message when it refused the request (4xx: written for
 * staff), else `fallback`. Server errors (5xx), network failures and anything
 * else never show their raw text.
 */
export const errorMessage = (err: unknown, fallback: string): string =>
  err instanceof AdminApiError && err.status < 500 && err.message ? err.message : fallback;
