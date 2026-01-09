import { z } from "zod";

/**
 * Orchestration-layer primitives.
 * Mechanics remain pure/deterministic.
 * Repos remain IO + validation only.
 * Orchestration coordinates + logs + error mapping.
 */

/**
 * Optimistic concurrency token returned by repositories.
 * Keep flexible (number/string) to avoid binding to Firestore specifics.
 */
export const VersionTokenSchema = z.union([z.string(), z.number()]);
export type VersionToken = z.infer<typeof VersionTokenSchema>;

export type DomainPatch = unknown;

export type RepoReadResult<T> = {
  value: T;
  version: VersionToken;
};

export type ApplyPatchArgs<TPatch> = {
  expectedVersion: VersionToken;

  /**
   * Preconditions come from mechanics (canonical schemas live in auction.types etc).
   * Kept as unknown here so orchestration core stays domain-agnostic.
   */
  preconditions: unknown;

  patch: TPatch;
};

export type RepoApplyPatchResult<T> = {
  value: T;
  version: VersionToken;
};
