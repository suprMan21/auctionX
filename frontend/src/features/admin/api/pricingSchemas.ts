/**
 * S-ADMIN1 Ph3b — response shapes for admin prices and free-transfer vouchers.
 * Every response is validated: a shape the page does not expect is an error.
 */

import { z } from 'zod';

export const PRICE_KINDS = ['transfer', 'reissue', 'token'] as const;
export type PriceKind = (typeof PRICE_KINDS)[number];

const priceSet = z.object({ transfer: z.number().int(), token: z.number().int(), reissue: z.number().int() });

export const priceChangeSchema = z.object({
  id: z.string(),
  kind: z.enum(PRICE_KINDS),
  amountUsdCents: z.number().int(),
  effectiveFrom: z.string(),
  reason: z.string(),
  status: z.enum(['scheduled', 'in_effect', 'superseded', 'cancelled']),
  /** Email of the admin who set it; null = the launch default. */
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  cancelledAt: z.string().nullable(),
  cancelledBy: z.string().nullable(),
  cancelReason: z.string().nullable(),
});
export type AdminPriceChange = z.infer<typeof priceChangeSchema>;

export const adminPricingSchema = z.object({
  current: priceSet,
  defaults: priceSet,
  history: z.array(priceChangeSchema),
});
export type AdminPricing = z.infer<typeof adminPricingSchema>;

export const setPriceResultSchema = z.object({
  id: z.string(),
  kind: z.enum(PRICE_KINDS),
  amountUsdCents: z.number().int(),
  effectiveFrom: z.string(),
});

export const cancelPriceResultSchema = z.object({ id: z.string(), cancelledAt: z.string() });

export const voucherGrantSchema = z.object({
  id: z.string(),
  userEmail: z.string().nullable(),
  quantity: z.number().int(),
  remaining: z.number().int(),
  used: z.number().int(),
  reason: z.string(),
  expiresAt: z.string().nullable(),
  status: z.enum(['active', 'used_up', 'expired', 'revoked']),
  grantedBy: z.string().nullable(),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
  revokedBy: z.string().nullable(),
  revokeReason: z.string().nullable(),
});
export type AdminVoucherGrant = z.infer<typeof voucherGrantSchema>;

export const voucherListSchema = z.object({
  grants: z.array(voucherGrantSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
});
export type AdminVoucherList = z.infer<typeof voucherListSchema>;

export const grantVoucherResultSchema = z.object({
  id: z.string(),
  userEmail: z.string().nullable(),
  quantity: z.number().int(),
  remaining: z.number().int(),
  expiresAt: z.string().nullable(),
});

export const revokeVoucherResultSchema = z.object({ id: z.string(), revokedAt: z.string(), unused: z.number().int() });

/** Unwraps `{ success, data }` and validates `data`. */
const envelopeSchema = z.object({ success: z.literal(true), data: z.unknown() });

export const parseEnvelope = <T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, body: unknown): T => {
  const envelope = envelopeSchema.safeParse(body);
  const parsed = envelope.success ? schema.safeParse(envelope.data.data) : null;
  if (!parsed?.success) throw new Error('Unexpected response from the server.');
  return parsed.data;
};
