/**
 * Zod schemas for the token lifecycle API responses (S-NFC3-FE).
 *
 * Mirrors backend/src/controllers/tokenReadController.ts. `lifecycleStatus`
 * values come from the `nfc_lifecycle_status` enum in database.types.ts
 * (UPPERCASE), never from the locked domain Zod schemas.
 */

import { z } from 'zod';

export const LIFECYCLE_STATUSES = [
  'ENROLLED',
  'ASSOCIATED',
  'CLAIMED',
  'ACTIVE',
  'TRANSFERRED',
  'RELEASED',
  'RETIRED',
  'SUSPENDED',
] as const;

/** Unknown future enum values degrade to "unknown" instead of failing the page. */
const lifecycleStatus = z.string().nullable();

export const provenanceSchema = z.object({
  tag_id: z.string(),
  lifecycle_status: lifecycleStatus,
  is_valid: z.boolean().nullable(),
  claim_date: z.string().nullable(),
  creator_name: z.string().nullable(),
  origin_video_url: z.string().nullable(),
  origin_location: z.string().nullable(),
  origin_date: z.string().nullable(),
  current_ownership_id: z.string().nullable(),
  enrolled_at: z.string().nullable(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

export const tapResultSchema = z.discriminatedUnion('valid', [
  z.object({
    valid: z.literal(false),
    reason: z.string(),
  }),
  z.object({
    valid: z.literal(true),
    tagId: z.string(),
    lifecycleStatus,
    provenance: provenanceSchema.nullable(),
    tapSession: z.object({ token: z.string(), expiresAt: z.string() }).nullable(),
    viewer: z
      .object({
        youOwnThis: z.boolean(),
        canClaim: z.boolean(),
        pendingTransferId: z.string().nullable(),
      })
      .nullable(),
  }),
]);
export type TapResult = z.infer<typeof tapResultSchema>;
export type ValidTap = Extract<TapResult, { valid: true }>;

export const claimResultSchema = z.object({
  tagId: z.string(),
  lifecycleStatus: z.literal('ACTIVE'),
  ownershipId: z.string(),
});
export type ClaimResult = z.infer<typeof claimResultSchema>;

export const myTokenSchema = z.object({
  tagId: z.string(),
  lifecycleStatus,
  claimedAt: z.string().nullable(),
  title: z.string().nullable(),
  // Fallback names for an untitled token. Optional so an older backend still parses.
  chipName: z.string().nullable().optional(),
  serialSuffix: z.string().nullable().optional(),
  disclosure: z.record(z.boolean()),
  ownershipId: z.string().nullable(),
  // S-ANCHOR1: null while anchoring is pending. Optional so an older backend still parses.
  ownershipAnchor: z.object({ anchoredAt: z.string(), explorerUrl: z.string().nullable() }).nullable().optional(),
  provenance: provenanceSchema.nullable(),
  pendingTransfer: z
    .object({
      transferId: z.string(),
      transferType: z.enum(['sale', 'gift']),
      feePayer: z.string().nullable(),
      toEmail: z.string().nullable(),
      initiatedAt: z.string().nullable(),
    })
    .nullable(),
});
export type MyToken = z.infer<typeof myTokenSchema>;
export const myTokensSchema = z.object({ tokens: z.array(myTokenSchema) });

export const incomingTransferSchema = z.object({
  transferId: z.string(),
  tagId: z.string(),
  transferType: z.enum(['sale', 'gift']),
  feePayer: z.string().nullable(),
  listAmountUsdCents: z.number(),
  initiatedAt: z.string().nullable(),
  provenance: provenanceSchema.nullable(),
});
export type IncomingTransfer = z.infer<typeof incomingTransferSchema>;
export const incomingTransfersSchema = z.object({ transfers: z.array(incomingTransferSchema) });

export const ownershipLookupSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('stale'), message: z.string() }),
  z.object({
    status: z.literal('current'),
    youOwnThis: z.boolean(),
    provenance: provenanceSchema.nullable(),
  }),
]);
export type OwnershipLookup = z.infer<typeof ownershipLookupSchema>;

// ── Phase 2: transfer, release, disclosure, receipt ─────────────────────────

/** The four owner-controlled disclosure fields (backend DISCLOSURE_FIELDS). */
export const DISCLOSURE_FIELDS = ['origin_video', 'creator_name', 'claim_date', 'location'] as const;
export type DisclosureField = (typeof DISCLOSURE_FIELDS)[number];
export type DisclosureInput = Partial<Record<DisclosureField, boolean>>;

export const transferInitiateResultSchema = z.object({
  transferId: z.string(),
  status: z.literal('PENDING'),
  listAmountUsdCents: z.number(),
});
export type TransferInitiateResult = z.infer<typeof transferInitiateResultSchema>;

/**
 * POST /transfer/:id/complete (S-ADMIN1 Ph3b).
 *
 * Paid: still PENDING with a clientSecret; only the Stripe webhook completes it.
 * Free transfer (voucher): already COMPLETED, no clientSecret, nothing charged.
 * The two shapes are told apart by `voucherApplied`, so a null secret can never
 * reach Stripe. A response without `voucherApplied` (a backend from before
 * Ph3b) is read as paid.
 */
const transferCompleteBase = {
  transferId: z.string(),
  listAmountUsdCents: z.number(),
  chargedAmount: z.number(),
  chargedCurrency: z.string(),
  fxRate: z.number().nullable().optional(),
};
export const transferCompletePaidSchema = z.object({
  ...transferCompleteBase,
  voucherApplied: z.literal(false).optional().transform((): false => false),
  status: z.literal('PENDING'),
  clientSecret: z.string().min(1),
});
export const transferCompleteFreeSchema = z.object({
  ...transferCompleteBase,
  voucherApplied: z.literal(true),
  status: z.literal('COMPLETED'),
  clientSecret: z.null(),
});
export const transferCompleteResultSchema = z.union([
  transferCompletePaidSchema,
  transferCompleteFreeSchema,
]);
export type TransferCompleteResult = z.infer<typeof transferCompleteResultSchema>;
export type TransferCompletePaid = z.infer<typeof transferCompletePaidSchema>;

/** GET /nfc/prices — prices in effect now, USD cents. */
export const tokenPricesSchema = z.object({
  currency: z.literal('usd'),
  transferUsdCents: z.number().int(),
  reissueUsdCents: z.number().int(),
  tokenUsdCents: z.number().int(),
});
export type TokenPrices = z.infer<typeof tokenPricesSchema>;

/** GET /nfc/vouchers/mine — free transfers the caller can use now. */
export const myVouchersSchema = z.object({ freeTransfers: z.number().int().min(0) });
export type MyVouchers = z.infer<typeof myVouchersSchema>;

/** GET /transfer/:id. `status` is a text column (PENDING, COMPLETED, CANCELLED, …). */
export const transferStatusSchema = z.object({
  transferId: z.string(),
  tagId: z.string(),
  status: z.string(),
  role: z.enum(['sender', 'recipient']),
  transferType: z.enum(['sale', 'gift']),
  feePayer: z.string().nullable(),
  listAmountUsdCents: z.number(),
  chargedAmount: z.number().nullable(),
  chargedCurrency: z.string().nullable(),
  initiatedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type TransferStatus = z.infer<typeof transferStatusSchema>;

export const transferCancelResultSchema = z.object({
  transferId: z.string(),
  status: z.literal('CANCELLED'),
});

export const releaseResultSchema = z.object({
  tagId: z.string(),
  lifecycleStatus: z.literal('RELEASED'),
  irreversible: z.literal(true),
});
export type ReleaseResult = z.infer<typeof releaseResultSchema>;

export const disclosureResultSchema = z.object({
  tagId: z.string(),
  disclosure: z.record(z.boolean()),
});

/** GET /:tagId/receipt — the private half of the Ownership ID. */
export const receiptSchema = z.object({
  ownershipId: z.string(),
  ownershipEventId: z.string(),
  ownershipEventType: z.string(),
  tagRef: z.string(),
  saltHex: z.string(),
  issuedAt: z.string().nullable(),
  algorithm: z.object({ hash: z.string(), preimage: z.string() }),
  // S-ANCHOR1: where the Ownership ID was published. Optional so an older backend still parses.
  anchor: z
    .discriminatedUnion('status', [
      z.object({ status: z.literal('pending') }),
      z.object({
        status: z.literal('anchored'),
        mode: z.enum(['daily_batch', 'per_event']),
        chainId: z.number(),
        registryAddress: z.string(),
        txHash: z.string(),
        blockNumber: z.number(),
        anchoredAt: z.string(),
        anchoredValue: z.string(),
        merkleProof: z.array(z.string()),
        leafEncoding: z.string().nullable(),
        explorerUrl: z.string().nullable(),
      }),
    ])
    .optional(),
});
export type Receipt = z.infer<typeof receiptSchema>;

// ── Re-issue (S-ADMIN1 Ph2) ─────────────────────────────────────────────────
// A replacement chip for one that is coming loose, before it falls off.

/** One of the owner's own re-issue requests. `status`/`paymentStatus` are text columns. */
export const ownerReissueSchema = z.object({
  id: z.string(),
  tagId: z.string(),
  status: z.string(),
  paymentStatus: z.string().nullable(),
  listAmountUsdCents: z.number().nullable(),
  chargedAmount: z.number().nullable(),
  chargedCurrency: z.string().nullable(),
  createdAt: z.string(),
  reviewedAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  fulfilledAt: z.string().nullable(),
  newTagId: z.string().nullable(),
});
export type OwnerReissue = z.infer<typeof ownerReissueSchema>;
export const myReissueRequestsSchema = z.object({ requests: z.array(ownerReissueSchema) });

export const reissueCreatedSchema = z.object({
  reissueRequestId: z.string(),
  status: z.literal('PENDING'),
  listAmountUsdCents: z.number(),
  chargedAmount: z.number(),
  chargedCurrency: z.string(),
});
export type ReissueCreated = z.infer<typeof reissueCreatedSchema>;

export const reissuePhotoUrlSchema = z.object({
  uploadUrl: z.string().url(),
  key: z.string(),
  contentType: z.literal('image/jpeg'),
});

/** POST /reissue-requests/:id/pay. Still unpaid: only the Stripe webhook marks it PAID. */
export const reissuePaySchema = z.object({
  reissueRequestId: z.string(),
  clientSecret: z.string(),
  chargedAmount: z.number(),
  chargedCurrency: z.string(),
  listAmountUsdCents: z.number().nullable(),
});
export type ReissuePay = z.infer<typeof reissuePaySchema>;

export const reissueCancelSchema = z.object({
  reissueRequestId: z.string(),
  status: z.literal('CANCELLED'),
});
