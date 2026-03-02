import { z } from "zod";

/**
 * Module 10: Admin Overrides & Manual Intervention
 * Provider-neutral, audited, idempotent, concurrency-safe.
 *
 * Immutability:
 * - Document is created once.
 * - Only previously-null outcome fields may be set later.
 */

export const AdminTargetAggregateZ = z.enum([
  "AUCTION",
  "SETTLEMENT",
  "PAYMENT",
  "PAYOUT",
  "DISPUTE",
]);
export type AdminTargetAggregate = z.infer<typeof AdminTargetAggregateZ>;

export const AdminActorKindZ = z.enum(["HUMAN", "SYSTEM"]);
export type AdminActorKind = z.infer<typeof AdminActorKindZ>;

export const AdminReasonCodeZ = z.enum([
  "AUCTION_FRAUD_SUSPECTED",
  "AUCTION_SAFETY_RISK",
  "AUCTION_OPERATIONAL_RECOVERY",
  "AUCTION_LISTING_POLICY_VIOLATION",

  "SETTLEMENT_FRAUD_SUSPECTED",
  "SETTLEMENT_DUPLICATE_OR_BAD_STATE",
  "PAYMENT_PROVIDER_MISMATCH_OUT_OF_BAND",
  "PAYMENT_OPERATIONAL_RECOVERY",

  "PAYOUT_KYC_REVIEW",
  "PAYOUT_FRAUD_REVIEW",
  "PAYOUT_OPERATIONAL_RECOVERY",

  "DISPUTE_SUPPORT_REQUEST",
  "DISPUTE_FRAUD_SUSPECTED",
  "DISPUTE_OPERATIONAL_RECOVERY",
  "DISPUTE_CHARGEBACK_NOTICE_RECEIVED",
]);
export type AdminReasonCode = z.infer<typeof AdminReasonCodeZ>;

export const AdminReasonCodeVersionZ = z.literal("ADMIN_REASON_V1");
export type AdminReasonCodeVersion = z.infer<typeof AdminReasonCodeVersionZ>;

export const AdminActionKindZ = z.enum([
  "FORCE_CLOSE_AUCTION",
  "VOID_AUCTION",

  "VOID_SETTLEMENT",
  "CANCEL_SETTLEMENT_ACTION",

  "RECORD_PAYMENT_OUTCOME_FACT",

  "PLACE_PAYOUT_HOLD_ADMIN",
  "RELEASE_PAYOUT_HOLD_ADMIN",

  "CREATE_DISPUTE_ADMIN",
  "UPDATE_DISPUTE_STATUS_ADMIN",

  "RECORD_CHARGEBACK_FACT",
]);
export type AdminActionKind = z.infer<typeof AdminActionKindZ>;

export const AdminActionResultZ = z.enum([
  "PENDING",
  "APPLIED",
  "NOOP_ALREADY_APPLIED",
  "REJECTED_PRECONDITION",
  "FAILED_RETRYABLE",
  "FAILED_TERMINAL",
]);
export type AdminActionResult = z.infer<typeof AdminActionResultZ>;

export const AdminTargetZ = z.object({
  aggregate: AdminTargetAggregateZ,
  id: z.string().min(1),
  secondaryId: z.string().min(1).optional(),
});
export type AdminTarget = z.infer<typeof AdminTargetZ>;

export const AdminActorZ = z.object({
  kind: AdminActorKindZ,
  uid: z.string().min(1),
});
export type AdminActor = z.infer<typeof AdminActorZ>;

export const AdminFailureZ = z.object({
  code: z.string().min(1),
  messageSafe: z.string().min(1),
  atMs: z.number().int().nonnegative(),
});
export type AdminFailure = z.infer<typeof AdminFailureZ>;

export const AdminExplainSnapshotZ = z.record(z.string(), z.unknown());
export type AdminExplainSnapshot = z.infer<typeof AdminExplainSnapshotZ>;

export const AdminActionZ = z.object({
  id: z.string().min(1),

  actionKind: AdminActionKindZ,
  reasonCode: AdminReasonCodeZ,
  reasonCodeVersion: AdminReasonCodeVersionZ,

  actor: AdminActorZ,
  justification: z.string().min(10),

  requestId: z.string().min(1),
  expectedVersion: z.number().int().nonnegative().optional(),

  target: AdminTargetZ,
  caseId: z.string().min(1).optional(),

  createdAtMs: z.number().int().nonnegative(),

  appliedAtMs: z.number().int().nonnegative().optional(),
  result: AdminActionResultZ,

  preSnapshot: AdminExplainSnapshotZ.optional(),
  postSnapshot: AdminExplainSnapshotZ.optional(),

  failure: AdminFailureZ.optional(),
});
export type AdminAction = z.infer<typeof AdminActionZ>;

export const NewAdminActionInputZ = z.object({
  actionKind: AdminActionKindZ,
  reasonCode: AdminReasonCodeZ,
  actor: AdminActorZ,
  justification: z.string().min(10),
  requestId: z.string().min(1),
  expectedVersion: z.number().int().nonnegative().optional(),
  target: AdminTargetZ,
  caseId: z.string().min(1).optional(),
  preSnapshot: AdminExplainSnapshotZ.optional(),
});
export type NewAdminActionInput = z.infer<typeof NewAdminActionInputZ>;

export function adminActionIdFromRequestId(requestId: string): string {
  return `admin_${requestId}`;
}
