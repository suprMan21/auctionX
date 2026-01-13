import { z } from "zod";

export const PayoutStatusSchema = z.enum([
  "NOT_READY",
  "READY",
  "ON_HOLD",
  "RELEASE_REQUESTED",
  "RELEASED",
  "FAILED_RETRYABLE",
  "FAILED_TERMINAL",
  "VOIDED",
]);

export type PayoutStatus = z.infer<typeof PayoutStatusSchema>;

export const FeeQuoteSchema = z.object({
  rulesetVersion: z.string().min(1),
  platformFeeBps: z.number().int().min(0).max(10000),
  platformFeeFixedCents: z.number().int().min(0),
  platformFeeCents: z.number().int().min(0),
});

export type FeeQuote = z.infer<typeof FeeQuoteSchema>;

export const TaxQuoteSchema = z.object({
  rulesetVersion: z.string().min(1),
  jurisdictionCode: z.string().min(1).nullable(),
  sellerWithholdingBps: z.number().int().min(0).max(10000),
  sellerWithheldCents: z.number().int().min(0),
  platformFeeTaxBps: z.number().int().min(0).max(10000),
  platformFeeTaxCents: z.number().int().min(0),
});

export type TaxQuote = z.infer<typeof TaxQuoteSchema>;

export const PayoutHoldSchema = z
  .object({
    heldAtMs: z.number().int().nonnegative(),
    reasonCode: z.string().min(1),
    reasonDetail: z.string().min(1).nullable(),
  })
  .nullable();

export type PayoutHold = z.infer<typeof PayoutHoldSchema>;

export const PayoutReleaseSchema = z
  .object({
    requestedAtMs: z.number().int().nonnegative(),
    releasedAtMs: z.number().int().nonnegative().nullable(),
  })
  .nullable();

export type PayoutRelease = z.infer<typeof PayoutReleaseSchema>;

export const PayoutLastRequestSchema = z.object({
  op: z.string().min(1),
  requestId: z.string().min(1),
  atMs: z.number().int().nonnegative(),
});

export type PayoutLastRequest = z.infer<typeof PayoutLastRequestSchema>;

export const PayoutPersistSchema = z.object({
  id: z.string().min(1),

  settlementId: z.string().min(1),
  listingId: z.string().min(1),
  auctionId: z.string().min(1),

  buyerUid: z.string().nullable(),
  sellerUid: z.string().nullable(),

  currency: z.string().min(1).nullable(),

  grossAmountCents: z.number().int().nonnegative().nullable(),
  fee: FeeQuoteSchema,
  tax: TaxQuoteSchema,
  netAmountCents: z.number().int().nonnegative().nullable(),

  status: PayoutStatusSchema,
  version: z.number().int().nonnegative(),

  createdAtMs: z.number().int().nonnegative(),
  updatedAtMs: z.number().int().nonnegative(),

  hold: PayoutHoldSchema,
  release: PayoutReleaseSchema,

  lastRequest: PayoutLastRequestSchema.nullable(),
  lastFailure: z
    .object({
      atMs: z.number().int().nonnegative(),
      code: z.string().nullable(),
      message: z.string().nullable(),
      retryable: z.boolean(),
    })
    .nullable(),
});

export type PayoutPersist = z.infer<typeof PayoutPersistSchema>;
