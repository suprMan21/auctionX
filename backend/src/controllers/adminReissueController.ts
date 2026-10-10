/**
 * S-ADMIN1 Ph2 — re-issue queue (/api/v1/admin/reissue-requests).
 *
 * Mounted behind verifyAdminAuth + adminRateLimit + requirePermission('manage_nfc').
 *
 *   PENDING --approve--> APPROVED + AWAITING_PAYMENT --webhook--> PAID --fulfil--> done
 *           --approve (waive)--> APPROVED + WAIVED --------------------fulfil--> done
 *           --reject--> REJECTED (nothing charged)
 *
 * Rules this file is responsible for:
 *   1. Every decision runs inside ONE database function (admin_review_reissue,
 *      admin_fulfil_reissue) that re-checks manage_nfc and writes the audit row.
 *   2. Nothing is fulfilled unpaid unless an admin waived the fee (Boss,
 *      2026-10-09). Enforced in the function AND by a table CHECK.
 *   3. Evidence photos are shown only through 5-minute presigned GETs from the
 *      private evidence bucket.
 *   4. Fulfil requires the typed serial suffix of the chip being retired.
 *   5. Owner emails never block or fail the action.
 */

import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../lib/errors';
import { withLogContext } from '../lib/logger';
import { emitSecurityEvent, type SecurityResult } from '../lib/security/securityEvent';
import { securityContext } from '../lib/security/requestContext';
import { mintOwnershipProof, type SecurityLogContext } from '../lib/ownership/ownershipProof';
import { evidenceViewUrl } from '../lib/reissueEvidence';
import { notifyReissueOwner } from '../lib/notifications/reissueEmails';
import {
  listReissueQuerySchema,
  reissueIdParamSchema,
  reissueApproveBodySchema,
  reissueRejectBodySchema,
  reissueFulfilBodySchema,
  confirmationSuffix,
  uidSuffix,
  UID_SUFFIX_LENGTH,
} from '../services/nfc/adminTagSchemas';

type AdminRequest = Request & { requestId?: string };

const getServiceClient = (): SupabaseClient =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const ok = <T>(res: Response, data: T, status = 200) =>
  res.status(status).json({ success: true, data, error: null });

const pathParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? '') : (value ?? '');

// One literal on purpose: schemaColumnDrift.test.ts reads `*COLUMNS` constants.
const ADMIN_REISSUE_COLUMNS =
  'id, tag_id, requester_id, status, payment_status, tap_session_id, photo_keys, list_amount_usd_cents, charged_amount, charged_currency, review_reason, waive_reason, reviewed_by, reviewed_at, paid_at, fulfilled_at, fulfilled_by, new_tag_id, created_at';

const QUEUE_TAG_COLUMNS = 'id, tag_uid, chip_serial, chip_name, lifecycle_status, current_owner_id, sdm_key_version';

type ReissueRow = {
  id: string;
  tag_id: string;
  requester_id: string;
  status: string;
  payment_status: string | null;
  tap_session_id: string | null;
  photo_keys: string[] | null;
  list_amount_usd_cents: number | null;
  charged_amount: number | null;
  charged_currency: string | null;
  review_reason: string | null;
  waive_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  fulfilled_by: string | null;
  new_tag_id: string | null;
  created_at: string;
};

type QueueTagRow = {
  id: string;
  tag_uid: string;
  chip_serial: string | null;
  chip_name: string | null;
  lifecycle_status: string | null;
  current_owner_id: string | null;
  sdm_key_version: number | null;
};

const adminContext = (req: AdminRequest, route: string): SecurityLogContext => ({
  ...securityContext(req, route, 'admin'),
  actorId: req.admin?.admin_id ?? null,
});

const requireAdminId = (req: AdminRequest): string => {
  const adminId = req.admin?.admin_id;
  if (!adminId) throw new AppError('unauthenticated', 'Admin authentication required');
  return adminId;
};

const parseRequestId = (req: AdminRequest): string => {
  const parsed = reissueIdParamSchema.safeParse(pathParam(req.params.id));
  if (!parsed.success) throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
  return parsed.data;
};

const emitReissueAction = (
  ctx: SecurityLogContext,
  action: 'approve' | 'approve_waived' | 'reject' | 'fulfil',
  reissueRequestId: string,
  tagId: string | null,
  result: SecurityResult,
  newTagId: string | null = null,
): void => {
  emitSecurityEvent({
    event: 'admin.reissue_action',
    action,
    reissue_request_id: reissueRequestId,
    tag_id: tagId,
    new_tag_id: newTagId,
    result,
    request_id: ctx.requestId,
    actor_id: ctx.actorId,
    actor_type: 'admin',
    ip: ctx.ip,
    route: ctx.route,
  });
};

/** Known function errors -> API errors. The raw DB text never reaches the client. */
const rpcError = (error: { message?: string } | null): { appError: AppError; result: SecurityResult } => {
  const key = (error?.message ?? '').split(':')[0].trim();
  switch (key) {
    case 'admin_forbidden':
      return { appError: new AppError('permission_denied', 'Forbidden'), result: 'forbidden' };
    case 'reason_required':
      return { appError: new AppError('invalid_argument', 'A reason of at least 10 characters is required'), result: 'invalid_argument' };
    case 'request_not_found':
      return { appError: new AppError('not_found', 'Request not found'), result: 'not_found' };
    case 'request_invalid_state':
      return { appError: new AppError('conflict', 'This request is no longer in a state that allows this action'), result: 'conflict' };
    case 'already_fulfilled':
      return { appError: new AppError('conflict', 'This request has already been fulfilled'), result: 'conflict' };
    case 'not_paid':
      return { appError: new AppError('failed_precondition', 'This request has not been paid'), result: 'payment_required' };
    case 'requester_not_owner':
      return { appError: new AppError('conflict', 'The requester no longer owns this token'), result: 'conflict' };
    case 'tag_invalid_state':
    case 'old_tag_invalid_state':
      return { appError: new AppError('conflict', 'Only an active or suspended token can be re-issued'), result: 'conflict' };
    case 'old_tag_no_owner':
      return { appError: new AppError('conflict', 'The token has no owner'), result: 'conflict' };
    case 'new_tag_not_found':
      return { appError: new AppError('not_found', 'Replacement chip not found'), result: 'not_found' };
    case 'new_tag_not_enrolled':
      return { appError: new AppError('conflict', 'The replacement chip must be enrolled and unclaimed'), result: 'conflict' };
    case 'same_tag':
      return { appError: new AppError('invalid_argument', 'The replacement chip must be a different chip'), result: 'invalid_argument' };
    case 'transfer_pending':
      return { appError: new AppError('conflict', 'A transfer is pending on this token; it must finish or be cancelled first'), result: 'transfer_pending' };
    case 'tag_retired':
      return { appError: new AppError('conflict', 'A retired chip cannot be changed or reused'), result: 'token_retired' };
    default:
      return { appError: new AppError('internal', 'The action could not be completed'), result: 'internal' };
  }
};

const loadRequest = async (supabase: SupabaseClient, id: string): Promise<ReissueRow> => {
  const { data, error } = await supabase
    .from('reissue_requests')
    .select(ADMIN_REISSUE_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new AppError('unavailable', 'Request could not be loaded');
  if (!data) throw new AppError('not_found', 'Request not found');
  return data as unknown as ReissueRow;
};

// ── GET /api/v1/admin/reissue-requests ──────────────────────────────────────

export const listReissueRequests = async (req: AdminRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: '/api/v1/admin/reissue-requests' });
  const parsed = listReissueQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
  const q = parsed.data;

  const supabase = getServiceClient();
  let query = supabase.from('reissue_requests').select(ADMIN_REISSUE_COLUMNS, { count: 'exact' });

  switch (q.status) {
    case 'PENDING':
      query = query.eq('status', 'PENDING');
      break;
    case 'AWAITING_PAYMENT':
      query = query.eq('status', 'APPROVED').eq('payment_status', 'AWAITING_PAYMENT');
      break;
    case 'READY':
      query = query.eq('status', 'APPROVED').in('payment_status', ['PAID', 'WAIVED']).is('fulfilled_at', null);
      break;
    case 'DONE':
      query = query.not('fulfilled_at', 'is', null);
      break;
    case 'REJECTED':
    case 'CANCELLED':
      query = query.eq('status', q.status);
      break;
    case 'ALL':
      break;
  }

  const offset = (q.page - 1) * q.limit;
  const { data, error, count } = await query
    .order('created_at', { ascending: q.status === 'PENDING' || q.status === 'READY' })
    .range(offset, offset + q.limit - 1);

  if (error) {
    logger.error('admin_reissue_list_failed', { error: error.message });
    throw new AppError('unavailable', 'The re-issue queue could not be loaded');
  }
  const rows = (data ?? []) as unknown as ReissueRow[];

  const tagIds = [...new Set(rows.map((r) => r.tag_id))];
  const sessionIds = rows.map((r) => r.tap_session_id).filter((id): id is string => !!id);

  const [tags, sessions] = await Promise.all([
    tagIds.length
      ? supabase.from('nfc_tags').select(QUEUE_TAG_COLUMNS).in('id', tagIds)
      : Promise.resolve({ data: [], error: null }),
    sessionIds.length
      ? supabase.from('nfc_tap_sessions').select('id, created_at, consumed_at').in('id', sessionIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const [name, part] of Object.entries({ tags, sessions })) {
    if (part.error) {
      logger.error('admin_reissue_list_part_failed', { part: name, error: part.error.message });
      throw new AppError('unavailable', 'The re-issue queue could not be loaded');
    }
  }
  const tagById = new Map(((tags.data ?? []) as QueueTagRow[]).map((t) => [t.id, t]));
  const sessionById = new Map(
    ((sessions.data ?? []) as Array<{ id: string; created_at: string; consumed_at: string | null }>).map((s) => [s.id, s]),
  );

  // Photos only for requests still awaiting a decision or a chip; closed ones
  // do not need fresh view links on every list load.
  const wantsPhotos = (r: ReissueRow) => r.status === 'PENDING' || (r.status === 'APPROVED' && !r.fulfilled_at);

  const requests = await Promise.all(rows.map(async (r) => {
    const tag = tagById.get(r.tag_id);
    const tap = r.tap_session_id ? sessionById.get(r.tap_session_id) : undefined;
    let photoUrls: string[] = [];
    if (wantsPhotos(r) && r.photo_keys?.length) {
      try {
        photoUrls = await Promise.all(r.photo_keys.map(evidenceViewUrl));
      } catch (err) {
        logger.warn('admin_reissue_photo_urls_failed', {
          reissueRequestId: r.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return {
      id: r.id,
      tagId: r.tag_id,
      tag: tag
        ? {
            chipName: tag.chip_name,
            uidSuffix: uidSuffix(tag.tag_uid),
            serialSuffix: tag.chip_serial ? tag.chip_serial.slice(-UID_SUFFIX_LENGTH).toUpperCase() : null,
            lifecycleStatus: tag.lifecycle_status,
            sdmKeyVersion: tag.sdm_key_version,
            requesterStillOwner: tag.current_owner_id === r.requester_id,
          }
        : null,
      requesterAccountId: r.requester_id,
      status: r.status,
      paymentStatus: r.payment_status,
      listAmountUsdCents: r.list_amount_usd_cents,
      chargedAmount: r.charged_amount,
      chargedCurrency: r.charged_currency,
      photoCount: r.photo_keys?.length ?? 0,
      photoUrls,
      tappedAt: tap?.created_at ?? null,
      reviewReason: r.review_reason,
      waiveReason: r.waive_reason,
      reviewedBy: r.reviewed_by,
      reviewedAt: r.reviewed_at,
      paidAt: r.paid_at,
      fulfilledAt: r.fulfilled_at,
      newTagId: r.new_tag_id,
      createdAt: r.created_at,
    };
  }));

  return ok(res, { requests, pagination: { page: q.page, limit: q.limit, total: count ?? 0 } });
};

// ── POST /api/v1/admin/reissue-requests/:id/approve | /reject ───────────────

const review = (approve: boolean) => async (req: AdminRequest, res: Response) => {
  const route = `/api/v1/admin/reissue-requests/:id/${approve ? 'approve' : 'reject'}`;
  const ctx = adminContext(req, route);
  const logger = withLogContext({ requestId: req.requestId, route });
  const adminId = requireAdminId(req);
  const requestId = parseRequestId(req);

  const parsed = approve
    ? reissueApproveBodySchema.safeParse(req.body)
    : reissueRejectBodySchema.safeParse(req.body);
  const waive = approve && parsed.success && (parsed.data as { waive?: boolean }).waive === true;
  const action = !approve ? 'reject' : waive ? 'approve_waived' : 'approve';

  if (!parsed.success) {
    emitReissueAction(ctx, action, requestId, null, 'invalid_argument');
    throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc('admin_review_reissue', {
    p_request: requestId,
    p_admin: adminId,
    p_approve: approve,
    p_waive: waive,
    p_reason: parsed.data.reason,
  });

  if (error) {
    const mapped = rpcError(error);
    if (mapped.result === 'internal') logger.error('admin_reissue_review_failed', { error: error.message });
    emitReissueAction(ctx, action, requestId, null, mapped.result);
    throw mapped.appError;
  }

  const result = data as { status: string; payment_status: string | null };
  const row = await loadRequest(supabase, requestId).catch(() => null);
  emitReissueAction(ctx, action, requestId, row?.tag_id ?? null, 'ok');

  if (row) {
    await notifyReissueOwner(supabase, !approve ? 'rejected' : waive ? 'waived' : 'approved', {
      id: row.id,
      requesterId: row.requester_id,
      chargedAmount: row.charged_amount,
    });
  }

  return ok(res, { reissueRequestId: requestId, status: result.status, paymentStatus: result.payment_status });
};

export const approveReissue = review(true);
export const rejectReissue = review(false);

// ── POST /api/v1/admin/reissue-requests/:id/fulfil ──────────────────────────

/**
 * Moves the token onto a new ENROLLED chip (Ph1 reset, same transaction) once
 * the request is PAID or WAIVED. The proof is minted BEFORE the database is
 * touched: a missing salt key must fail while nothing has changed.
 */
export const fulfilReissue = async (req: AdminRequest, res: Response) => {
  const route = '/api/v1/admin/reissue-requests/:id/fulfil';
  const ctx = adminContext(req, route);
  const logger = withLogContext({ requestId: req.requestId, route });
  const adminId = requireAdminId(req);
  const requestId = parseRequestId(req);

  const parsed = reissueFulfilBodySchema.safeParse(req.body);
  if (!parsed.success) {
    emitReissueAction(ctx, 'fulfil', requestId, null, 'invalid_argument');
    throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
  }
  const { newTagId, reason, confirmSuffix } = parsed.data;

  const supabase = getServiceClient();
  const request = await loadRequest(supabase, requestId);

  const { data: oldTag, error: tagError } = await supabase
    .from('nfc_tags')
    .select('id, tag_uid, chip_serial')
    .eq('id', request.tag_id)
    .maybeSingle();
  if (tagError) {
    logger.error('admin_reissue_fulfil_load_failed', { error: tagError.message });
    throw new AppError('unavailable', 'Tag could not be loaded');
  }
  if (!oldTag) {
    emitReissueAction(ctx, 'fulfil', requestId, request.tag_id, 'not_found', newTagId);
    throw new AppError('not_found', 'Tag not found');
  }

  if (confirmationSuffix(oldTag as { tag_uid: string; chip_serial: string | null }) !== confirmSuffix.toUpperCase()) {
    emitReissueAction(ctx, 'fulfil', requestId, request.tag_id, 'invalid_argument', newTagId);
    throw new AppError('invalid_argument', 'The confirmation does not match the chip being retired');
  }

  const custodyRecordId = randomUUID();
  const minted = mintOwnershipProof(
    { tagId: newTagId, ownershipEventId: custodyRecordId, ownershipEventType: 'transfer' },
    ctx,
  );

  const { error } = await supabase.rpc('admin_fulfil_reissue', {
    p_request: requestId,
    p_new_tag: newTagId,
    p_admin: adminId,
    p_reason: reason,
    p_custody_id: custodyRecordId,
    p_ownership_id: minted.ownershipId,
    p_tag_ref: minted.tagRef,
    p_salt_enc: minted.saltEnc,
  });

  if (error) {
    const mapped = rpcError(error);
    if (mapped.result === 'internal') logger.error('admin_reissue_fulfil_failed', { error: error.message });
    emitReissueAction(ctx, 'fulfil', requestId, request.tag_id, mapped.result, newTagId);
    throw mapped.appError;
  }

  emitReissueAction(ctx, 'fulfil', requestId, request.tag_id, 'ok', newTagId);
  await notifyReissueOwner(supabase, 'fulfilled', {
    id: request.id,
    requesterId: request.requester_id,
    chargedAmount: request.charged_amount,
  });

  return ok(res, {
    reissueRequestId: requestId,
    oldTagId: request.tag_id,
    newTagId,
    oldLifecycleStatus: 'RETIRED',
    newLifecycleStatus: 'ACTIVE',
    destructionStatus: 'PENDING',
  });
};
