/**
 * Structured logging at orchestration boundaries ONLY.
 * Mechanics & repos must not log.
 */

export type OrchestrationOutcome =
  | "success"
  | "noop"
  | "validation_failed"
  | "precondition_failed"
  | "version_conflict"
  | "not_found"
  | "repo_error"
  | "unexpected_error";

export type OrchestrationEventName =
  | "attempt"
  | "success"
  | "noop"
  | "validation_failed"
  | "precondition_failed"
  | "version_conflict"
  | "not_found"
  | "repo_error"
  | "unexpected_error";

export type OrchestrationLogPayload = {
  requestId: string;
  op: string;
  aggregate: string;

  // Domain identifiers (include what you have; omit what you don't)
  auctionId?: string;
  listingId?: string;
  bidId?: string;
  actorId?: string;

  expectedVersion?: string | number;

  outcome: OrchestrationOutcome;

  // Lightweight patch metadata (never dump full patch unless you explicitly want to later)
  patchSummary?: {
    paths?: string[];
    size?: number;
    hash?: string;
  };

  durationMs: number;

  error?: {
    code: string;
    message: string;
  };
};

/**
 * Minimal logger interface so orchestration can be tested without your real logger.
 * Adapter to your existing logger lives at composition time (handlers / service factories).
 */
export type OrchestrationLogger = {
  info: (event: string, payload: OrchestrationLogPayload) => void;
  warn: (event: string, payload: OrchestrationLogPayload) => void;
  error: (event: string, payload: OrchestrationLogPayload) => void;
};

export const orchEvent = (op: string, name: OrchestrationEventName) => `orch.${op}.${name}`;
