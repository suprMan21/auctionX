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
  disclosure: z.record(z.boolean()),
  ownershipId: z.string().nullable(),
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
