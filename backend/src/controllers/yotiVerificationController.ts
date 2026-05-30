/**
 * Yoti verification controller (S22).
 *
 * Endpoints (mounted in `routes/yotiVerification.ts`):
 *   POST /api/v1/verification/start         — authenticated; creates a hosted Yoti session
 *   GET  /api/v1/verification/status        — authenticated; reads truth from users + latest yoti_sessions row
 *   POST /api/v1/webhooks/yoti              — public, HMAC-verified; updates DB state machine
 *
 * Admin endpoints live in `controllers/adminYotiVerificationController.ts`.
 *
 * Truth rules:
 * - `users.seller_verification_status` is the canonical seller-KYC flag. Only the
 *   webhook + admin-override paths write it.
 * - `users.age_verified` is the canonical age fact. Only the webhook writes it.
 * - `yoti_sessions` is the per-session forensic log. raw_payload is the verified
 *   webhook body. NEVER trust unverified payload data.
 */

import type { Response } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { AppError, toAppError } from '../lib/errors';
import { withLogContext } from '../lib/logger';
import type { Database } from '../types/database';
import type { AuthRequest } from '../middleware/auth';
import type { RequestWithId } from '../middleware/requestId';
import {
  getYotiClient,
  isYotiFeatureEnabled,
  YOTI_AGE_THRESHOLD,
  type YotiSessionPurpose,
  type YotiWebhookEnvelope,
} from '../lib/yoti';
import { notificationService } from '../lib/notifications/notificationService';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const getServiceClient = (): SupabaseClient<Database> =>
  createClient<Database>(supabaseUrl, supabaseServiceKey);

type VerificationStatus = Database['public']['Enums']['verification_status'];

const PURPOSE_VALUES = ['seller_kyc', 'age_gate', 'both'] as const;

const startSchema = z.object({
  purpose: z.enum(PURPOSE_VALUES),
  return_url: z.string().url().optional(),
});

// Raw payload Yoti IDV POSTs to our webhook endpoint — just session_id + topic.
// The webhook handler resolves the topic into a YotiWebhookEnvelope (and calls
// yotiClient.getSession on SESSION_COMPLETION to read the actual outcome).
const notificationSchema = z.object({
  session_id: z.string().min(1),
  topic: z.enum(['session_completion', 'check_completion', 'task_completion', 'resource_update']),
});

const formatError = (res: Response, error: unknown, fallback: string, requestId: string) => {
  const appErr = toAppError(error);
  return res.status(appErr.status).json({
    success: false,
    error: {
      code: appErr.code,
      message: appErr.message || fallback,
      requestId,
    },
  });
};

const respondAvailability = (res: Response, requestId: string) =>
  res.status(503).json({
    success: false,
    error: {
      code: 'YOTI_NOT_AVAILABLE',
      message: 'Identity verification is coming soon.',
      requestId,
    },
  });

const ALREADY_VERIFIED: ReadonlyArray<VerificationStatus> = ['VERIFIED', 'APPROVED'];

/**
 * POST /api/v1/verification/start
 * Body: { purpose, return_url? }
 *
 * - Flag-off → 503 + YOTI_NOT_AVAILABLE.
 * - Already VERIFIED → 412 + VERIFICATION_ALREADY_VERIFIED.
 * - Otherwise → ask the YotiClient for a hosted-session URL, insert a
 *   yoti_sessions row in 'created' state, set users.yoti_session_id +
 *   users.seller_verification_submitted_at + status=PENDING.
 */
export const startYotiSession = async (req: AuthRequest & RequestWithId, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: '/api/v1/verification/start' });
  try {
    if (!req.user) throw new AppError('unauthenticated', 'Authentication required');

    if (!isYotiFeatureEnabled()) {
      logger.info('yoti_start_blocked_flag_off', { userId: req.user.id });
      return respondAvailability(res, req.requestId);
    }

    const parsed = startSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError('invalid_argument', 'Invalid request body', parsed.error.issues);
    }
    const purpose = parsed.data.purpose as YotiSessionPurpose;

    const supabase = getServiceClient();
    const { data: existing, error: userErr } = await supabase
      .from('users')
      .select('id, seller_verification_status, age_verified')
      .eq('id', req.user.id)
      .single();
    if (userErr || !existing) throw new AppError('not_found', 'User not found');

    if (ALREADY_VERIFIED.includes(existing.seller_verification_status)) {
      const err = new AppError('failed_precondition', 'User is already verified');
      return res.status(err.status).json({
        success: false,
        error: {
          code: 'VERIFICATION_ALREADY_VERIFIED',
          message: err.message,
          requestId: req.requestId,
        },
      });
    }

    const defaultReturn = process.env.YOTI_RETURN_URL
      || `${process.env.FRONTEND_URL || 'http://localhost:5173'}/seller/verification/return`;
    const returnUrl = parsed.data.return_url ?? defaultReturn;

    const yoti = getYotiClient();
    let session;
    try {
      session = await yoti.createSession({ userId: req.user.id, purpose, returnUrl });
    } catch (err) {
      logger.error('yoti_create_session_failed', { err: err instanceof Error ? err.message : String(err) });
      throw new AppError('internal', 'YOTI_SESSION_CREATE_FAILED');
    }

    const now = new Date().toISOString();

    const { error: insertErr } = await supabase
      .from('yoti_sessions')
      .insert({
        user_id: req.user.id,
        yoti_session_id: session.sessionId,
        purpose,
        status: 'created',
        last_event_type: 'session.created',
        last_event_at: now,
      });
    if (insertErr) {
      logger.error('yoti_session_persist_failed', { err: String(insertErr) });
      throw new AppError('internal', 'Failed to persist Yoti session');
    }

    const { error: userUpdErr } = await supabase
      .from('users')
      .update({
        yoti_session_id: session.sessionId,
        yoti_last_event_at: now,
        seller_verification_submitted_at: now,
        seller_verification_status:
          existing.seller_verification_status === 'NONE'
            ? 'PENDING'
            : existing.seller_verification_status,
      })
      .eq('id', req.user.id);
    if (userUpdErr) {
      logger.error('yoti_user_update_failed', { err: String(userUpdErr) });
      throw new AppError('internal', 'Failed to update user verification state');
    }

    logger.info('yoti_session_started', { userId: req.user.id, sessionId: session.sessionId, purpose });

    return res.json({
      success: true,
      data: { session_url: session.sessionUrl, session_id: session.sessionId },
    });
  } catch (error) {
    return formatError(res, error, 'Failed to start verification', req.requestId);
  }
};

/**
 * GET /api/v1/verification/status
 * Returns the caller's verification facts + latest session row.
 */
export const getMyVerificationStatus = async (req: AuthRequest & RequestWithId, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: '/api/v1/verification/status' });
  try {
    if (!req.user) throw new AppError('unauthenticated', 'Authentication required');
    const supabase = getServiceClient();

    const { data: user, error: userErr } = await supabase
      .from('users')
      .select(
        'id, seller_verification_status, seller_verification_submitted_at, seller_verification_reviewed_at, seller_verification_rejection_reason, age_verified, age_verified_at, age_verification_provider, yoti_session_id'
      )
      .eq('id', req.user.id)
      .single();
    if (userErr || !user) throw new AppError('not_found', 'User not found');

    let lastSession: unknown = null;
    if (user.yoti_session_id) {
      // limit(1) returns an array; pick [0] rather than chaining maybeSingle on
      // top of it (cleaner and matches the harness pattern used elsewhere in
      // the codebase).
      const { data: sessRows } = await supabase
        .from('yoti_sessions')
        .select(
          'id, yoti_session_id, purpose, status, age_estimate, rejection_reason, last_event_type, last_event_at, created_at, updated_at'
        )
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false })
        .limit(1);
      lastSession = Array.isArray(sessRows) ? sessRows[0] ?? null : sessRows ?? null;
    }

    logger.info('yoti_status_read', { userId: req.user.id });

    return res.json({
      success: true,
      data: {
        seller_verification_status: user.seller_verification_status,
        submitted_at: user.seller_verification_submitted_at,
        reviewed_at: user.seller_verification_reviewed_at,
        rejection_reason: user.seller_verification_rejection_reason,
        age_verified: user.age_verified,
        age_verified_at: user.age_verified_at,
        age_verification_provider: user.age_verification_provider,
        last_session: lastSession,
        feature_enabled: isYotiFeatureEnabled(),
      },
    });
  } catch (error) {
    return formatError(res, error, 'Failed to read verification status', req.requestId);
  }
};

/**
 * Apply a verified Yoti webhook envelope. SHARED entry-point so the test suite
 * can exercise the state machine without spinning up Express.
 *
 * Critical: the caller MUST have already HMAC-verified `payload`. Trust the
 * session_id only; look up user_id from `yoti_sessions` row, NEVER from the
 * payload (defence in depth — Lesson #3 + service client bypasses RLS).
 *
 * Idempotency: dedupes on (session_id, event_type). If the most-recent stored
 * event for the session already matches event_type, we no-op without writes.
 */
export const applyYotiWebhookEnvelope = async (
  payload: YotiWebhookEnvelope,
  options?: { supabase?: SupabaseClient<Database>; requestId?: string }
): Promise<{ applied: boolean; reason?: 'no_matching_session' | 'duplicate_event' }> => {
  const logger = withLogContext({
    requestId: options?.requestId ?? null,
    route: 'webhook:yoti',
  });
  const supabase = options?.supabase ?? getServiceClient();

  const { data: existing, error: lookupErr } = await supabase
    .from('yoti_sessions')
    .select('id, user_id, last_event_type, status, purpose')
    .eq('yoti_session_id', payload.session_id)
    .maybeSingle();
  if (lookupErr) {
    logger.error('yoti_webhook_session_lookup_failed', { err: String(lookupErr) });
    throw new AppError('internal', 'Failed to look up Yoti session');
  }
  if (!existing) {
    logger.warn('yoti_webhook_no_matching_session', { sessionId: payload.session_id });
    return { applied: false, reason: 'no_matching_session' };
  }

  if (existing.last_event_type === payload.event_type) {
    logger.info('yoti_webhook_duplicate_event', {
      sessionId: payload.session_id,
      eventType: payload.event_type,
    });
    return { applied: false, reason: 'duplicate_event' };
  }

  const now = new Date().toISOString();
  const userId = existing.user_id;
  const purpose = existing.purpose;

  // Map event → DB transition. Brief §5.4.
  let sessionStatus: Database['public']['Tables']['yoti_sessions']['Update']['status'] | null = null;
  let userPatch: Database['public']['Tables']['users']['Update'] = {
    yoti_last_event_at: now,
  };
  let userStatusOverride: VerificationStatus | null = null;
  const rejectionReason = payload.rejection_reason ?? null;
  const ageEstimate = payload.age_estimate ?? null;

  switch (payload.event_type) {
    case 'session.created':
      sessionStatus = 'created';
      userStatusOverride = 'PENDING';
      break;
    case 'session.in_progress':
      sessionStatus = 'in_progress';
      userStatusOverride = 'PENDING';
      break;
    case 'session.completed':
      sessionStatus = 'completed';
      if (payload.outcome === 'completed_verified') {
        userStatusOverride = 'VERIFIED';
        userPatch.seller_verification_reviewed_at = now;
        userPatch.seller_verification_rejection_reason = null;
        if (ageEstimate !== null && ageEstimate >= YOTI_AGE_THRESHOLD) {
          userPatch.age_verified = true;
          userPatch.age_verified_at = now;
          userPatch.age_verification_provider = 'yoti';
          userPatch.yoti_age_estimate = ageEstimate;
        } else if (ageEstimate !== null) {
          userPatch.yoti_age_estimate = ageEstimate;
        }
      } else {
        // completed_rejected (or missing outcome treated as rejection)
        userStatusOverride = 'REJECTED';
        userPatch.seller_verification_reviewed_at = now;
        userPatch.seller_verification_rejection_reason = rejectionReason ?? 'Verification rejected by Yoti';
      }
      break;
    case 'session.failed':
      sessionStatus = 'failed';
      userStatusOverride = 'NONE';
      userPatch.seller_verification_submitted_at = null;
      break;
    case 'session.expired':
      sessionStatus = 'expired';
      userStatusOverride = 'NONE';
      userPatch.seller_verification_submitted_at = null;
      break;
  }

  if (userStatusOverride) {
    userPatch.seller_verification_status = userStatusOverride;
  }

  const { error: sessUpdErr } = await supabase
    .from('yoti_sessions')
    .update({
      status: sessionStatus ?? existing.status,
      last_event_type: payload.event_type,
      last_event_at: now,
      age_estimate: ageEstimate,
      rejection_reason: rejectionReason,
      raw_payload: payload as unknown as Database['public']['Tables']['yoti_sessions']['Update']['raw_payload'],
    })
    .eq('id', existing.id);
  if (sessUpdErr) {
    logger.error('yoti_session_update_failed', { err: String(sessUpdErr) });
    throw new AppError('internal', 'Failed to persist Yoti session update');
  }

  const { error: userUpdErr } = await supabase.from('users').update(userPatch).eq('id', userId);
  if (userUpdErr) {
    logger.error('yoti_webhook_user_update_failed', { err: String(userUpdErr) });
    throw new AppError('internal', 'Failed to update user verification state');
  }

  logger.info('yoti_webhook_applied', {
    sessionId: payload.session_id,
    eventType: payload.event_type,
    userId,
    purpose,
    newStatus: userStatusOverride,
    ageVerified: userPatch.age_verified ?? null,
  });

  // Post-state-transition notifications (S23). notificationService is
  // preference-aware, idempotent at the persistence layer, and never throws —
  // safe to fire-and-await here without wrapping in try/catch.
  if (userStatusOverride === 'VERIFIED') {
    await notificationService.send(supabase, {
      userId,
      type: 'SELLER_VERIFICATION_APPROVED',
      title: 'Your seller verification is approved',
      body: 'Your identity check came back clean — seller tools are unlocked on your account.',
    });
  } else if (userStatusOverride === 'REJECTED') {
    await notificationService.send(supabase, {
      userId,
      type: 'SELLER_VERIFICATION_REJECTED',
      title: 'Action needed: seller verification could not be completed',
      body: rejectionReason
        ? `We weren't able to verify your identity. Reason: ${rejectionReason}.`
        : "We weren't able to verify your identity. You can retry from your account settings.",
      metadata: rejectionReason ? { rejectionReason } : undefined,
    });
  }

  return { applied: true };
};

/**
 * Map a Yoti notification topic to our internal event_type. Only
 * SESSION_COMPLETION carries enough signal to drive a final state transition;
 * other topics get treated as in-progress noise and acknowledged without DB
 * writes (S22.6 can wire CHECK_COMPLETION → progress updates if useful).
 */
const TOPIC_TO_EVENT: Record<string, 'session.completed' | 'session.in_progress'> = {
  session_completion: 'session.completed',
  check_completion: 'session.in_progress',
  task_completion: 'session.in_progress',
  resource_update: 'session.in_progress',
};

/**
 * POST /api/v1/webhooks/yoti
 *
 * Raw-body route. Yoti IDV POSTs `{ session_id, topic }` with
 * `Authorization: Bearer <YOTI_WEBHOOK_SECRET>`. Reject 401 on bad token,
 * 400 on bad shape. On SESSION_COMPLETION we call `yoti.getSession()` to
 * read the actual outcome + rejection reason, then run it through the
 * existing state machine.
 */
export const yotiWebhook = async (req: AuthRequest & RequestWithId, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: '/api/v1/webhooks/yoti' });
  try {
    const yoti = getYotiClient();
    const authHeader = req.headers['authorization'] as string | undefined;
    const rawBody = req.body as Buffer | undefined;
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      logger.error('yoti_webhook_missing_raw_body');
      return res.status(400).json({ success: false, error: { code: 'invalid_argument', message: 'Missing raw body', requestId: req.requestId } });
    }

    let verified;
    try {
      verified = yoti.verifyWebhookAuth(rawBody, authHeader);
    } catch (err) {
      logger.warn('yoti_webhook_auth_invalid', { err: err instanceof Error ? err.message : String(err) });
      return res.status(401).json({
        success: false,
        error: {
          code: 'YOTI_WEBHOOK_AUTH_INVALID',
          message: 'Invalid webhook token',
          requestId: req.requestId,
        },
      });
    }

    const parsed = notificationSchema.safeParse(verified.payload);
    if (!parsed.success) {
      logger.warn('yoti_webhook_payload_invalid', { issues: parsed.error.issues });
      return res.status(400).json({
        success: false,
        error: { code: 'invalid_argument', message: 'Invalid webhook payload', requestId: req.requestId },
      });
    }

    const { session_id, topic } = parsed.data;
    const eventType = TOPIC_TO_EVENT[topic];

    // For SESSION_COMPLETION, call getSession to read the actual outcome —
    // the notification itself doesn't carry it. For in-progress topics, we
    // ack without DB writes.
    let envelope: YotiWebhookEnvelope;
    if (eventType === 'session.completed') {
      let detail;
      try {
        detail = await yoti.getSession(session_id);
      } catch (err) {
        logger.error('yoti_webhook_get_session_failed', {
          sessionId: session_id,
          err: err instanceof Error ? err.message : String(err),
        });
        throw new AppError('internal', 'YOTI_SESSION_READ_FAILED');
      }
      envelope = {
        event_type: 'session.completed',
        session_id,
        outcome: detail.outcome,
        age_estimate: detail.ageEstimate,
        rejection_reason: detail.rejectionReason,
      };
    } else {
      envelope = {
        event_type: eventType,
        session_id,
      };
    }

    const result = await applyYotiWebhookEnvelope(envelope, {
      requestId: req.requestId,
    });

    return res.json({ success: true, data: { received: true, topic, ...result } });
  } catch (error) {
    return formatError(res, error, 'Failed to process Yoti webhook', req.requestId);
  }
};
