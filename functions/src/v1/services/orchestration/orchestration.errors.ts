/**
 * Orchestration-level errors:
 * - No HTTP concerns (that stays at handlers).
 * - Map cleanly into your existing standard error model shape later.
 */

export type OrchestrationErrorCode =
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "PRECONDITION_FAILED"
  | "VERSION_CONFLICT"
  | "REPOSITORY_ERROR"
  | "UNEXPECTED_ERROR";

export type OrchestrationError = {
  code: OrchestrationErrorCode | string; // allow domain-specific codes too
  message: string;
  details?: unknown;
};

export const orchErr = (code: OrchestrationError["code"], message: string, details?: unknown): OrchestrationError => ({
  code,
  message,
  ...(details !== undefined ? { details } : {}),
});

export const isOrchError = (e: unknown): e is OrchestrationError =>
  typeof e === "object" &&
  e !== null &&
  "code" in e &&
  "message" in e &&
  typeof (e as any).code === "string" &&
  typeof (e as any).message === "string";
