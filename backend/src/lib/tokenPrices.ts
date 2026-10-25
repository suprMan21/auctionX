/**
 * Admin-set token prices and free-transfer vouchers — S-ADMIN1 Ph3b.
 *
 * Prices live in `token_prices` (effective-dated, with history). The price in
 * effect is the newest uncancelled row whose `effective_from` has passed. With
 * no row at all, the env defaults in tokenFees.ts apply, so a fresh database
 * still charges the launch prices.
 *
 * When a price is locked:
 *   transfer  when the sender starts it (stored on the transfer row)
 *   reissue   when the request is created (stored on the request row)
 * A later price change never touches a transfer or request already under way.
 *
 * Vouchers: N free transfers granted to an account (never codes). The fee payer's
 * voucher is used automatically at completion. `hasUsableVoucher` is only a cheap
 * pre-check to skip a database call; `redeem_transfer_voucher` decides.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from './errors';
import { REISSUE_FEE_CENTS, TOKEN_PRICE_CENTS, TRANSFER_FEE_CENTS } from './tokenFees';

export const PRICE_KINDS = ['transfer', 'token', 'reissue'] as const;
export type PriceKind = (typeof PRICE_KINDS)[number];

export const DEFAULT_PRICE_CENTS: Readonly<Record<PriceKind, number>> = {
  transfer: TRANSFER_FEE_CENTS,
  token: TOKEN_PRICE_CENTS,
  reissue: REISSUE_FEE_CENTS,
};

/**
 * The price in effect now, in USD cents. Throws (fails closed) when the lookup
 * itself fails: guessing a price in a payment path would be a wrong charge.
 */
export const currentPriceCents = async (supabase: SupabaseClient, kind: PriceKind): Promise<number> => {
  const { data, error } = await supabase
    .from('token_prices')
    .select('amount_usd_cents')
    .eq('kind', kind)
    .is('cancelled_at', null)
    .lte('effective_from', new Date().toISOString())
    .order('effective_from', { ascending: false })
    .limit(1);

  if (error) throw new AppError('unavailable', 'Prices are unavailable right now. Please try again.');
  const cents = (data?.[0] as { amount_usd_cents?: unknown } | undefined)?.amount_usd_cents;
  return typeof cents === 'number' && Number.isInteger(cents) && cents > 0 ? cents : DEFAULT_PRICE_CENTS[kind];
};

export const currentPrices = async (supabase: SupabaseClient): Promise<Record<PriceKind, number>> => {
  const [transfer, token, reissue] = await Promise.all(PRICE_KINDS.map((k) => currentPriceCents(supabase, k)));
  return { transfer, token, reissue };
};

interface GrantRow {
  remaining: number;
  expires_at: string | null;
}

/** Free transfers the user can use right now. Throws if the lookup fails. */
export const availableVoucherCount = async (supabase: SupabaseClient, userId: string): Promise<number> => {
  const { data, error } = await supabase
    .from('transfer_voucher_grants')
    .select('remaining, expires_at')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .gt('remaining', 0);

  if (error) throw new AppError('unavailable', 'Vouchers are unavailable right now. Please try again.');
  const now = Date.now();
  return ((data ?? []) as GrantRow[])
    .filter((g) => g.expires_at === null || Date.parse(g.expires_at) > now)
    .reduce((sum, g) => sum + g.remaining, 0);
};
