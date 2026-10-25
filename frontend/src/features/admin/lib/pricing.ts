/**
 * S-ADMIN1 Ph3b — helpers for the admin Pricing and Free transfers pages.
 */

import { formatMoney } from '@/features/tokens/lib/copy';
import type { PriceKind } from '../api/pricingSchemas';

/** Matches the backend and the token_prices CHECK: Stripe's $0.50 minimum, $1,000 ceiling. */
export const PRICE_MIN_CENTS = 50;
export const PRICE_MAX_CENTS = 100_000;
export const VOUCHER_MAX_QUANTITY = 100;

export const PRICE_LABEL: Record<PriceKind, string> = {
  transfer: 'Transfer fee',
  reissue: 'Re-issue fee',
  token: 'New token price',
};

export const usd = (cents: number): string => formatMoney(cents, 'usd');

/**
 * "3", "3.5", "3.50", "$1,000" -> integer cents. Null when it is not a plain
 * dollar amount with at most two decimals. No floating-point maths.
 */
export const parseDollarsToCents = (input: string): number | null => {
  const cleaned = input.trim().replace(/^\$/, '').replace(/,/g, '');
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const dollars = Number(match[1]);
  const cents = Number((match[2] ?? '').padEnd(2, '0'));
  return dollars * 100 + cents;
};

const pad = (n: number): string => String(n).padStart(2, '0');

/** A Date as ISO 8601 with the browser's own offset, e.g. 2026-11-01T09:00:00-04:00. */
export const toIsoWithOffset = (date: Date): string => {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
};

/** A datetime-local value ("2026-11-01T09:00") read as local time. Null when empty or invalid. */
export const parseLocalDateTime = (value: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** A date input value ("2026-11-30") as the end of that day, local time. */
export const endOfLocalDay = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const fmtDateTime = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString() : '—');
export const fmtDate = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString() : '—');
