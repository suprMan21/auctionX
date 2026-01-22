import { z } from "zod";

export const SettlementStatusSchema = z.enum([
  "CREATED",
  "ACTION_REQUIRED",
  "IN_PROGRESS",
  "SETTLED",
  "FAILED_RETRYABLE",
  "FAILED_TERMINAL",
  "VOIDED",
]);

export type SettlementStatus = z.infer<typeof SettlementStatusSchema>;

export const SettlementActionTypeSchema = z.enum([
  "COLLECT_AND_PAY",
]);

export type SettlementActionType = z.infer<typeof SettlementActionTypeSchema>;

export const SettlementActionStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
]);

export type SettlementActionStatus = z.infer<typeof SettlementActionStatusSchema>;

export const SettlementActionAttemptSchema = z.object({
  atMs: z.number().int().nonnegative(),
  ok: z.boolean(),
  code: z.string().nullable(),
  message: z.string().nullable(),
});

export type SettlementActionAttempt = z.infer<typeof SettlementActionAttemptSchema>;

export const SettlementActionSchema = z.object({
  id: z.string().min(1),
  type: SettlementActionTypeSchema,
  status: SettlementActionStatusSchema,
  attempts: z.array(SettlementActionAttemptSchema),
});

export type SettlementAction = z.infer<typeof SettlementActionSchema>;

export const SettlementCloseSnapshotSchema = z.object({
  closedAtMs: z.number().int().nonnegative(),
  reason: z.string().min(1),
  winnerUid: z.string().nullable(),
  winningPriceCents: z.number().int().nonnegative(),
});

export type SettlementCloseSnapshot = z.infer<typeof SettlementCloseSnapshotSchema>;

export const SettlementOutcomeKindSchema = z.enum([
  "PAYMENT_REQUIRED",
  "NO_BIDS",
]);

export type SettlementOutcomeKind = z.infer<typeof SettlementOutcomeKindSchema>;

export const SettlementLastRequestSchema = z.object({
  op: z.string().min(1),
  requestId: z.string().min(1),
  atMs: z.number().int().nonnegative(),
});

export type SettlementLastRequest = z.infer<typeof SettlementLastRequestSchema>;

// NEW: Import payment processor enum
import { PaymentProcessorSchema } from "./enums.schema";

export const SettlementPersistSchema = z.object({
  id: z.string().min(1),
  listingId: z.string().min(1),
  auctionId: z.string().min(1),

  status: SettlementStatusSchema,
  version: z.number().int().nonnegative(),

  createdAtMs: z.number().int().nonnegative(),
  updatedAtMs: z.number().int().nonnegative(),

  outcomeKind: SettlementOutcomeKindSchema,

  buyerUid: z.string().nullable(),
  sellerUid: z.string().nullable(),
  amountCents: z.number().int().nonnegative().nullable(),
  currency: z.string().min(1).nullable(),

  close: SettlementCloseSnapshotSchema,

  actions: z.array(SettlementActionSchema),

  lastRequest: SettlementLastRequestSchema.nullable(),
  lastFailure: z
    .object({
      atMs: z.number().int().nonnegative(),
      code: z.string().nullable(),
      message: z.string().nullable(),
      retryable: z.boolean(),
    })
    .nullable(),
  
  // NEW: Payment processor tracking (optional for backward compatibility)
  processor: PaymentProcessorSchema.optional(),
  processorFeePercent: z.number().min(0).max(100).optional(),
  processorFeeCents: z.number().int().nonnegative().optional(),
  processorTransactionId: z.string().min(1).optional(),
  processorCustomerId: z.string().optional(),
});

export type SettlementPersist = z.infer<typeof SettlementPersistSchema>;
