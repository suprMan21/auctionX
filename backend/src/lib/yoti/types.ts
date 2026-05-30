/**
 * Yoti integration types — the shape we depend on from the upstream vendor.
 * The MockYotiClient produces these directly; LiveYotiClient (S22.5) will
 * normalise the real Yoti SDK responses into the same shapes.
 */

export type YotiSessionPurpose = 'seller_kyc' | 'age_gate' | 'both';

export type YotiSessionStatus = 'created' | 'in_progress' | 'completed' | 'failed' | 'expired';

export type YotiEventType =
  | 'session.created'
  | 'session.in_progress'
  | 'session.completed'
  | 'session.failed'
  | 'session.expired';

export type YotiOutcome = 'completed_verified' | 'completed_rejected';

/** Body the backend hands to `yotiClient.createSession`. */
export interface CreateSessionInput {
  userId: string;
  purpose: YotiSessionPurpose;
  returnUrl: string;
  /** Used by MockYotiClient to deterministically simulate an outcome in tests. */
  mockOutcome?: YotiOutcome;
}

/** Returned by `yotiClient.createSession`. */
export interface CreateSessionResult {
  sessionId: string;
  sessionUrl: string;
}

/** Returned by `yotiClient.getSession`. Used by the webhook + status endpoints. */
export interface YotiSessionDetail {
  sessionId: string;
  status: YotiSessionStatus;
  outcome: YotiOutcome | null;
  ageEstimate: number | null;
  rejectionReason: string | null;
}

/**
 * Internal envelope shape used by the state machine in
 * `applyYotiWebhookEnvelope`. NOT the raw shape Yoti sends — Yoti IDV
 * webhooks deliver only `{ session_id, topic }`. The webhook handler calls
 * `yotiClient.getSession(session_id)` on `SESSION_COMPLETION` to read the
 * actual outcome + checks, then synthesizes this envelope before running it
 * through the state machine. Pre-S22.5 MockYotiClient tests also build this
 * shape directly (no network).
 */
export interface YotiWebhookEnvelope {
  event_type: YotiEventType;
  session_id: string;
  outcome?: YotiOutcome | null;
  age_estimate?: number | null;
  rejection_reason?: string | null;
  /** Unix-ms timestamp emitted by Yoti for the event. */
  occurred_at?: number;
}

/** Raw payload Yoti IDV POSTs to our webhook endpoint. */
export type YotiNotificationTopic =
  | 'session_completion'
  | 'check_completion'
  | 'task_completion'
  | 'resource_update';

export interface YotiNotificationPayload {
  session_id: string;
  topic: YotiNotificationTopic;
}

/** Result of `verifyWebhookAuth`. */
export interface VerifiedWebhook {
  payload: YotiNotificationPayload;
}

/** Minimum age (years) required for age-gate verification. Boss-locked. */
export const YOTI_AGE_THRESHOLD = 18;
