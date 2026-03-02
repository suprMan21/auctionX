/**
 * @module Module 02 Port — Auction Mechanics
 * Generic orchestration-layer primitives (version tokens, patch args, repo results).
 * Ported from functions/src/v1/services/orchestration/orchestration.types.ts
 */

import { z } from "zod";

/**
 * Optimistic concurrency token returned by repositories.
 * Kept as number | string to avoid binding to any specific backend.
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
  /** Preconditions from mechanics; kept unknown so core stays domain-agnostic. */
  preconditions: unknown;
  patch: TPatch;
};

export type RepoApplyPatchResult<T> = {
  value: T;
  version: VersionToken;
};
