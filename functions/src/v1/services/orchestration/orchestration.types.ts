import { z } from "zod";

/**
 * These are orchestration-layer primitives.
 * - Mechanics remain pure/deterministic.
 * - Repos remain IO + validation only.
 * - Orchestration coordinates + logs + error mapping.
 */

/**
 * Optimistic concurrency token returned by repositories.
 * This may be a number, string, Firestore updateTime token, etc.
 * Keep it flexible to avoid binding orchestration to Firestore specifics.
 */
export const VersionTokenSchema = z.union([z.string(), z.number()]);
export type VersionToken = z.infer<typeof VersionTokenSchema>;

/**
 * Preconditions are produced by mechanics and enforced by repositories.
 * We keep this intentionally abstract: mechanics decide the meaning; repos enforce.
 */
export const PreconditionSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type Precondition = z.infer<typeof PreconditionSchema>;

export const PreconditionsSchema = z.array(PreconditionSchema);
export type Preconditions = z.infer<typeof PreconditionsSchema>;

/**
 * Patch is produced by mechanics (immutable) and applied by repositories.
 * Keep it unknown at this layer; domain-specific orchestrators provide schemas.
 */
export type DomainPatch = unknown;

export type RepoReadResult<T> = {
  value: T;
  version: VersionToken;
};

export type ApplyPatchArgs<TPatch> = {
  expectedVersion: VersionToken;
  preconditions: Preconditions;
  patch: TPatch;
};

export type RepoApplyPatchResult<T> = {
  value: T;
  version: VersionToken;
};

/**
 * Generic orchestration result shape. (No HTTP concerns here.)
 */
export type OrchestrationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: OrchestrationError };
/**
 * NOTE: OrchestrationError is defined in orchestration.errors.ts
 */
export type OrchestrationError = {
  code: string;
  message: string;
  details?: unknown;
};
