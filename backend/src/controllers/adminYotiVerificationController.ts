/**
 * Admin verifications controller (S22). Mounts under /api/v1/admin/verifications.
 *
 * Permission: `review_sellers` (already granted via migration 20260320000003).
 *
 * The override action uses the existing `seller_verification_reviews` table
 * for the audit trail (additive — we don't add a new table). The action label
 * `override_verification` matches what the auditLog middleware writes into
 * `audit_logs.action`.
 */

import type { Request, Response } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { AppError, toAppError } from '../lib/errors';
import { withLogContext } from '../lib/logger';
import type { Database } from '../types/database';
import type { RequestWithId } from '../middleware/requestId';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const getServiceClient = (): SupabaseClient<Database> =>
  createClient<Database>(supabaseUrl, supabaseServiceKey);

type VerificationStatus = Database['public']['Enums']['verification_status'];

const VERIFICATION_STATUSES: ReadonlyArray<VerificationStatus> = [
  'NONE',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'VIDEO_UPLOADED',
  'NFC_PROGRAMMED',
  'VERIFIED',
  'FLAGGED',
  'REVOKED',
];

const isVerificationStatus = (v: string): v is VerificationStatus =>
  (VERIFICATION_STATUSES as ReadonlyArray<string>).includes(v);

const overrideSchema = z.object({
  new_status: z.enum(VERIFICATION_STATUSES as unknown as [VerificationStatus, ...VerificationStatus[]]),
  reason: z.string().min(10, 'reason must be at least 10 characters'),
});

const formatError = (res: Response, error: unknown, fallback: string, requestId: string) => {
  const appErr = toAppError(error);
  return res.status(appErr.status).json({
    success: false,
    error: { code: appErr.code, message: appErr.message || fallback, requestId },
  });
};

/**
 * GET /api/v1/admin/verifications
 * Lists users with at least one yoti_sessions row + recent sessions matching
 * the filters. The list is keyed by user — we surface user + latest session.
 *
 * Filters: status (verification_status), brand (preferred_brand), search (email/display_name)
 */
export const listVerifications = async (req: Request & RequestWithId, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });
  try {
    const page = Math.max(parseInt((req.query.page as string) ?? '1', 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) ?? '25', 10) || 25, 1), 100);
    const offset = (page - 1) * limit;

    const statusRaw = (req.query.status as string | undefined)?.trim();
    const statuses = statusRaw
      ? statusRaw.split(',').map((s) => s.trim()).filter(isVerificationStatus)
      : [];

    const search = (req.query.search as string | undefined)?.trim() || undefined;

    const supabase = getServiceClient();

    let query = supabase
      .from('users')
      .select(
        'id, email, display_name, seller_verification_status, seller_verification_submitted_at, seller_verification_reviewed_at, seller_verification_rejection_reason, age_verified, age_verified_at, yoti_session_id, yoti_last_event_at, created_at',
        { count: 'exact' }
      )
      .not('yoti_session_id', 'is', null);

    if (statuses.length > 0) {
      query = query.in('seller_verification_status', statuses);
    }
    if (search) {
      query = query.or(`email.ilike.%${search}%,display_name.ilike.%${search}%`);
    }

    query = query.order('yoti_last_event_at', { ascending: false, nullsFirst: false });
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    const total = count ?? 0;
    const totalPages = Math.ceil(total / limit);

    const results = (data ?? []).map((row) => ({
      user_id: row.id,
      email: row.email,
      display_name: row.display_name,
      status: row.seller_verification_status,
      submitted_at: row.seller_verification_submitted_at,
      reviewed_at: row.seller_verification_reviewed_at,
      rejection_reason: row.seller_verification_rejection_reason,
      age_verified: row.age_verified,
      age_verified_at: row.age_verified_at,
      yoti_session_id: row.yoti_session_id,
      yoti_last_event_at: row.yoti_last_event_at,
      joined_at: row.created_at,
    }));

    logger.info('admin_list_verifications', { total, page, limit, statuses, search });

    return res.json({ success: true, data: { results, total, page, totalPages } });
  } catch (error) {
    return formatError(res, error, 'Failed to list verifications', req.requestId);
  }
};

/**
 * GET /api/v1/admin/verifications/:userId
 * User detail + ALL yoti_sessions rows + ALL seller_verification_reviews rows.
 */
export const getVerificationDetail = async (req: Request & RequestWithId, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });
  try {
    const userId = req.params.userId;
    if (typeof userId !== 'string' || !userId) throw new AppError('invalid_argument', 'userId is required');

    const supabase = getServiceClient();

    const { data: user, error: userErr } = await supabase
      .from('users')
      .select(
        'id, email, display_name, role, seller_verification_status, seller_verification_submitted_at, seller_verification_reviewed_at, seller_verification_rejection_reason, age_verified, age_verified_at, age_verification_provider, yoti_session_id, yoti_age_estimate, yoti_last_event_at, created_at'
      )
      .eq('id', userId)
      .single();
    if (userErr || !user) throw new AppError('not_found', 'User not found');

    const [sessionsRes, reviewsRes] = await Promise.all([
      supabase
        .from('yoti_sessions')
        .select(
          'id, yoti_session_id, purpose, status, age_estimate, rejection_reason, last_event_type, last_event_at, created_at, updated_at'
        )
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      supabase
        .from('seller_verification_reviews')
        .select('id, admin_id, action, notes, previous_status, new_status, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
    ]);
    if (sessionsRes.error) throw sessionsRes.error;
    if (reviewsRes.error) throw reviewsRes.error;

    logger.info('admin_get_verification_detail', { userId });

    return res.json({
      success: true,
      data: {
        user,
        sessions: sessionsRes.data ?? [],
        reviews: reviewsRes.data ?? [],
      },
    });
  } catch (error) {
    return formatError(res, error, 'Failed to fetch verification detail', req.requestId);
  }
};

/**
 * POST /api/v1/admin/verifications/:userId/override
 * Body: { new_status, reason }
 *
 * Writes seller_verification_reviews row for audit + updates user. Action label
 * passed to the auditLog middleware is `override_verification`.
 */
export const overrideVerification = async (req: Request & RequestWithId, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });
  try {
    const userId = req.params.userId;
    if (typeof userId !== 'string' || !userId) throw new AppError('invalid_argument', 'userId is required');

    const parsed = overrideSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError('invalid_argument', 'Invalid override body', parsed.error.issues);
    }
    const { new_status, reason } = parsed.data;

    if (!req.admin) throw new AppError('unauthenticated', 'Admin context missing');

    const supabase = getServiceClient();
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, seller_verification_status')
      .eq('id', userId)
      .single();
    if (userErr || !user) throw new AppError('not_found', 'User not found');

    const previousStatus = user.seller_verification_status;

    if (previousStatus === new_status) {
      throw new AppError('failed_precondition', `User is already in status ${new_status}`);
    }

    const now = new Date().toISOString();

    const { error: updErr } = await supabase
      .from('users')
      .update({
        seller_verification_status: new_status,
        seller_verification_reviewed_at: now,
        seller_verification_rejection_reason:
          new_status === 'REJECTED' || new_status === 'REVOKED' ? reason : null,
      })
      .eq('id', userId);
    if (updErr) throw new AppError('internal', 'Failed to update user status');

    const { error: reviewErr } = await supabase.from('seller_verification_reviews').insert({
      user_id: userId,
      admin_id: req.admin.admin_id,
      action: 'override',
      notes: reason,
      previous_status: previousStatus,
      new_status,
    });
    if (reviewErr) {
      // Audit row failed but user was updated — log and surface 500 so admin
      // can investigate / re-issue the override.
      logger.error('admin_override_audit_insert_failed', { userId, err: String(reviewErr) });
      throw new AppError('internal', 'Override applied but audit row failed');
    }

    logger.info('admin_override_verification', {
      userId,
      adminId: req.admin.admin_id,
      previousStatus,
      newStatus: new_status,
    });

    return res.json({
      success: true,
      data: { user_id: userId, previous_status: previousStatus, new_status, reason },
    });
  } catch (error) {
    return formatError(res, error, 'Failed to override verification', req.requestId);
  }
};
