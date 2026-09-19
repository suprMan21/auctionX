/**
 * Token-platform list prices and presentment currency — S-NFC3.
 *
 * Prices are LISTED in USD. An account whose billing country is Canada is
 * charged the CAD conversion of the USD list price, and the converted amount is
 * shown before payment. Every fee row records `list_amount_usd_cents`,
 * `charged_amount`, `charged_currency` and `fx_rate`, so a charge can be
 * reconstructed later without re-querying Stripe.
 *
 * ── OPEN QUESTION carried in from the S-NFC3 TODO ──────────────────────────
 * CAD presentment has NOT been confirmed available on the Stripe sandbox
 * account. The TODO's instruction if it is not: "ship USD-only and defer CAD
 * with a note."
 *
 * So CAD is implemented but gated behind FEATURE_CAD_PRESENTMENT, default OFF.
 * With the flag off every account is charged in USD and `fx_rate` is 1 — a
 * correct, fully reconcilable charge, not a degraded one. Turning the flag on
 * requires BOTH a confirmed CAD-capable Stripe account and a configured rate;
 * if either is missing the resolver falls back to USD rather than guessing a
 * rate, because a wrong rate is a wrong charge.
 *
 * The rate is env-configured rather than fetched live: a fee of a few dollars
 * does not justify a runtime dependency on an FX feed in the payment path, and
 * an env value is auditable against the row it produced.
 */

const truthy = (raw: string | undefined): boolean => raw === 'true' || raw === '1';

/** List prices, USD cents. */
export const TRANSFER_FEE_CENTS = readIntEnv('TRANSFER_FEE_CENTS', 250);
export const TOKEN_PRICE_CENTS = readIntEnv('TOKEN_PRICE_CENTS', 1000);
export const REISSUE_FEE_CENTS = readIntEnv('REISSUE_FEE_CENTS', 1000);

export type PresentmentCurrency = 'usd' | 'cad';

export interface ChargeAmount {
  readonly listAmountUsdCents: number;
  readonly chargedAmount: number;
  readonly chargedCurrency: PresentmentCurrency;
  readonly fxRate: number;
}

/**
 * FEATURE_CAD_PRESENTMENT — default OFF until CAD presentment is confirmed on
 * the Stripe account actually in use.
 */
export const isCadPresentmentEnabled = (): boolean =>
  truthy(process.env.FEATURE_CAD_PRESENTMENT);

/**
 * Resolves what to actually charge for a USD list price.
 *
 * `billingCountry` is the account's billing country (ISO-3166 alpha-2).
 * Anything other than a confirmed Canadian account on a CAD-enabled deployment
 * is charged in USD.
 */
export const resolveCharge = (
  listAmountUsdCents: number,
  billingCountry: string | null | undefined,
): ChargeAmount => {
  const usd: ChargeAmount = {
    listAmountUsdCents,
    chargedAmount: listAmountUsdCents,
    chargedCurrency: 'usd',
    fxRate: 1,
  };

  if (!isCadPresentmentEnabled()) return usd;
  if (billingCountry?.trim().toUpperCase() !== 'CA') return usd;

  const rate = readFloatEnv('USD_CAD_RATE');
  // No configured rate => charge USD. Never invent a rate in a payment path.
  if (rate === null || !Number.isFinite(rate) || rate <= 0) return usd;

  return {
    listAmountUsdCents,
    // Round half-up to the cent. Stripe amounts are integers.
    chargedAmount: Math.round(listAmountUsdCents * rate),
    chargedCurrency: 'cad',
    fxRate: rate,
  };
};

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readFloatEnv(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
