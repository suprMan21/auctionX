import { z } from "zod";

/**
 * Provider-neutral dispute aggregate.
 * - No provider concepts (no "Stripe dispute", no "chargeback object", etc.)
 * - Holds/refunds/chargebacks are represented as provider-agnostic sub-structures.
 * - requestId idempotency is tracked in-doc (bounded cleanup is TODO).
 */

export const DisputeReasonCodeSchema = z.enum([
  "ITEM_NOT_RECEIVED",
  "NOT_AS_DESCRIBED",
  "UNAUTHORIZED",
  "OTHER",
]);

export const DisputeStatusSchema = z.enum([
  "OPEN",
  "EVIDENCE_REQUIRED",
  "UNDER_REVIEW",
  "RESOLVED",
  "CANCELED",
]);

export const DisputeHoldStatusSchema = z.enum(["NONE", "PLACED", "RELEASED"]);

export const DisputeRefundStatusSchema = z.enum([
  "NONE",
  "INTENT_RECORDED",
  "IN_PROGRESS",
  "SUCCEEDED",
  "FAILED",
]);

export const DisputeChargebackStatusSchema = z.enum([
  "NONE",
  "REPORTED",
  "WON",
  "LOST",
]);

export const DisputeOutcomeKindSchema = z.enum([
  "NO_ACTION",
  "REFUND_ISSUED",
  "PARTIAL_REFUND",
  "CHARGEBACK_WON",
  "CHARGEBACK_LOST",
]);

export const DisputeActorSchema = z.enum(["SYSTEM", "ADMIN", "BUYER", "SELLER"]);

export const DisputeEventTypeSchema = z.enum([
  "CREATED",
  "STATUS_CHANGED",
  "HOLD_PLACED",
  "HOLD_RELEASED",
  "REFUND_INTENT_RECORDED",
  "REFUND_STATUS_CHANGED",
  "CHARGEBACK_REPORTED",
  "CHARGEBACK_STATUS_CHANGED",
  "RESOLVED",
  "CANCELED",
]);

export const DisputeEventSchema = z.object({
  type: DisputeEventTypeSchema,
  atMs: z.number().int().nonnegative(),
  actor: DisputeActorSchema,
  note: z.string().max(2000).optional(),
});

export const DisputeEvidenceKindSchema = z.enum([
  "MESSAGE",
  "PHOTO_REF",
  "DOC_REF",
  "OTHER_REF",
]);

export const DisputeEvidenceSchema = z.object({
  kind: DisputeEvidenceKindSchema,
  ref: z.string().max(2000),
  submittedByUid: z.string().min(1),
  submittedAtMs: z.number().int().nonnegative(),
  note: z.string().max(2000).optional(),
});

export const DisputeHoldSchema = z.object({
  status: DisputeHoldStatusSchema,
  placedAtMs: z.number().int().nonnegative().nullable(),
  releasedAtMs: z.number().int().nonnegative().nullable(),
  note: z.string().max(2000).optional(),
});

export const DisputeRefundSchema = z.object({
  status: DisputeRefundStatusSchema,
  currency: z.string().min(1).default("CAD"),
  amountCents: z.number().int().nonnegative().nullable(),
  intentAtMs: z.number().int().nonnegative().nullable(),
  updatedAtMs: z.number().int().nonnegative().nullable(),
  note: z.string().max(2000).optional(),
});

export const DisputeChargebackSchema = z.object({
  status: DisputeChargebackStatusSchema,
  amountCents: z.number().int().nonnegative().nullable(),
  reportedAtMs: z.number().int().nonnegative().nullable(),
  updatedAtMs: z.number().int().nonnegative().nullable(),
  note: z.string().max(2000).optional(),
  externalRef: z
    .object({
      system: z.string().min(1),
      id: z.string().min(1),
    })
    .nullable()
    .optional(),
});

export const DisputeIdempotencyEntrySchema = z.object({
  op: z.string().min(1),
  atMs: z.number().int().nonnegative(),
});

export const DisputeSchema = z.object({
  id: z.string().min(1),

  listingId: z.string().min(1),
  auctionId: z.string().min(1),

  settlementId: z.string().min(1).nullable(),
  payoutId: z.string().min(1).nullable(),

  buyerUid: z.string().min(1),
  sellerUid: z.string().min(1),

  reasonCode: DisputeReasonCodeSchema,
  reasonText: z.string().max(2000).nullable(),

  status: DisputeStatusSchema,
  outcomeKind: DisputeOutcomeKindSchema.nullable(),

  hold: DisputeHoldSchema,
  refund: DisputeRefundSchema,
  chargeback: DisputeChargebackSchema,

  evidence: z.array(DisputeEvidenceSchema).default([]),
  events: z.array(DisputeEventSchema).default([]),

  version: z.number().int().nonnegative(),
  createdAtMs: z.number().int().nonnegative(),
  updatedAtMs: z.number().int().nonnegative(),

  idempotency: z.record(z.string(), DisputeIdempotencyEntrySchema).default({}),
});

export type Dispute = z.infer<typeof DisputeSchema>;
