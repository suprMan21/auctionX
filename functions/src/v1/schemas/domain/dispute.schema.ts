import { z } from "zod";

export const DisputeStatusSchema = z.enum([
  "OPEN",
  "UNDER_REVIEW",
  "ACTION_REQUIRED",
  "RESOLVED",
  "CLOSED",
]);

export const DisputeReasonCodeSchema = z.enum([
  "ITEM_NOT_RECEIVED",
  "NOT_AS_DESCRIBED",
  "FRAUD",
  "OTHER",
]);

export const DisputePayoutImpactSchema = z.enum([
  "NONE",
  "HOLD_REQUESTED",
  "HOLD_ACTIVE",
  "RELEASE_ALLOWED",
  "REVERSAL_REQUIRED",
]);

export const DisputeBuyerImpactSchema = z.enum([
  "NONE",
  "REFUND_REQUESTED",
  "REFUND_RECORDED",
]);

export const DisputeSellerImpactSchema = z.enum([
  "NONE",
  "DEBIT_REQUIRED",
  "DEBIT_RECORDED",
]);

export const DisputeEventKindSchema = z.enum([
  "DISPUTE_CREATED",
  "DISPUTE_UPDATED",
  "DISPUTE_RESOLVED",
  "DISPUTE_CLOSED",
  "NOTE_ADDED",
]);

export const DisputeEventSchema = z.object({
  atMs: z.number().int().nonnegative(),
  kind: DisputeEventKindSchema,
  actor: z.object({
    kind: z.enum(["SYSTEM", "USER", "ADMIN"]),
    id: z.string().min(1),
  }),
  requestId: z.string().min(1),
  note: z.string().max(2000).optional(),
});

export const DisputeRefundRecordSchema = z.object({
  refundId: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  currency: z.enum(["CAD"]),
  reasonCode: z.enum(["DISPUTE_RESOLUTION", "BUYER_COMP", "PLATFORM_COMP"]),
  decidedAtMs: z.number().int().nonnegative(),
  recordedAtMs: z.number().int().nonnegative(),
  paymentRef: z.string().max(200).optional(),
});

export const DisputeChargebackRecordSchema = z.object({
  externalRef: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  currency: z.enum(["CAD"]),
  stage: z.enum(["NOTICE", "OPEN", "WON", "LOST"]),
  occurredAtMs: z.number().int().nonnegative(),
});

export const DisputeSchema = z.object({
  id: z.string().min(1),

  settlementId: z.string().min(1),
  listingId: z.string().min(1),
  auctionId: z.string().min(1),

  buyerUid: z.string().min(1),
  sellerUid: z.string().min(1),

  status: DisputeStatusSchema,
  reasonCode: DisputeReasonCodeSchema,
  detail: z.string().max(4000).optional(),

  payoutImpact: DisputePayoutImpactSchema,
  buyerImpact: DisputeBuyerImpactSchema,
  sellerImpact: DisputeSellerImpactSchema,

  refunds: z.array(DisputeRefundRecordSchema).default([]),
  chargebacks: z.array(DisputeChargebackRecordSchema).default([]),

  events: z.array(DisputeEventSchema).default([]),

  lastMutation: z
    .object({
      requestId: z.string().min(1),
      op: z.enum(["createDispute", "updateDispute", "resolveDispute", "closeDispute"]),
      atMs: z.number().int().nonnegative(),
    })
    .optional(),

  version: z.number().int().nonnegative(),
  createdAtMs: z.number().int().nonnegative(),
  updatedAtMs: z.number().int().nonnegative(),
});

export type Dispute = z.infer<typeof DisputeSchema>;
