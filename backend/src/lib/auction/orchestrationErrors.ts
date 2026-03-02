/**
 * @module Module 02 Port — Auction Mechanics
 * Orchestration-level error types (no HTTP concerns).
 * Ported from functions/src/v1/services/orchestration/orchestration.errors.ts
 */

export type OrchestrationErrorCode =
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "PRECONDITION_FAILED"
  | "VERSION_CONFLICT"
  | "REPOSITORY_ERROR"
  | "UNEXPECTED_ERROR";

/** Structured error returned by orchestration functions (never thrown). */
export type OrchestrationError = {
  code: OrchestrationErrorCode | string; // allow domain-specific codes too
  message: string;
  details?: unknown;
};

/** Build an OrchestrationError literal. */
export const orchErr = (code: OrchestrationError["code"], message: string, details?: unknown): OrchestrationError => ({
  code,
  message,
  ...(details !== undefined ? { details } : {}),
});

/** Type-guard for OrchestrationError. */
export const isOrchError = (e: unknown): e is OrchestrationError =>
  typeof e === "object" &&
  e !== null &&
  "code" in e &&
  "message" in e &&
  typeof (e as any).code === "string" &&
  typeof (e as any).message === "string";
