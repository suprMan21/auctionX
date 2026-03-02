/**
 * Structured logging at orchestration boundaries ONLY.
 * Mechanics & repos must not log.
 */

export type OrchestrationOutcome =
  | "attempt"
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

  auctionId?: string;
  listingId?: string;
  bidId?: string;
  actorId?: string;

  expectedVersion?: string | number;

  outcome: OrchestrationOutcome;
  durationMs: number;

  patchSummary?: {
    paths?: string[];
    size?: number;
    hash?: string;
  };

  error?: {
    code: string;
    message: string;
  };
};

/**
 * Minimal logger interface so orchestration can be tested without the real logger.
 */
export type OrchestrationLogger = {
  info: (event: string, payload: OrchestrationLogPayload) => void;
  warn: (event: string, payload: OrchestrationLogPayload) => void;
  error: (event: string, payload: OrchestrationLogPayload) => void;
};

export const orchEvent = (op: string, name: OrchestrationEventName) => `orch.${op}.${name}`;
