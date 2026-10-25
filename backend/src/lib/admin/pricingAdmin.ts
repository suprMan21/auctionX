/**
 * S-ADMIN1 Ph3b — who may set prices and grant vouchers, and request shapes.
 *
 * Locked 2026-10-03: admin and super_admin only (no 'manager' role). Since
 * S-ADMIN2 Ph1 that is the manage_pricing permission, re-checked by the
 * database functions (`admin_actor_email`).
 */

import { z } from 'zod';
import { REASON_MIN } from '../../services/nfc/adminTagSchemas';
import { PRICE_KINDS } from '../tokenPrices';

const reason = z.string().trim().min(REASON_MIN, `Reason must be at least ${REASON_MIN} characters`).max(500);

/** Matches the token_prices CHECK: Stripe's $0.50 minimum, $1,000 ceiling. */
export const PRICE_MIN_CENTS = 50;
export const PRICE_MAX_CENTS = 100_000;

export const setPriceBodySchema = z.object({
  kind: z.enum(PRICE_KINDS),
  amountUsdCents: z.number().int().min(PRICE_MIN_CENTS).max(PRICE_MAX_CENTS),
  /** Omitted or null = now. A future time schedules the change. */
  effectiveFrom: z.string().datetime({ offset: true }).nullable().optional(),
  reason,
}).strict();

export const cancelPriceBodySchema = z.object({ reason }).strict();

export const VOUCHER_MAX_QUANTITY = 100;

export const grantVoucherBodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  quantity: z.number().int().min(1).max(VOUCHER_MAX_QUANTITY),
  reason,
  /** Omitted or null = never expires. */
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
}).strict();

export const revokeVoucherBodySchema = z.object({ reason }).strict();

export const listVouchersQuerySchema = z.object({
  /** Exact account email. Audit-logged before it runs. */
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(25),
}).strict();

export const idParamSchema = z.string().uuid();
