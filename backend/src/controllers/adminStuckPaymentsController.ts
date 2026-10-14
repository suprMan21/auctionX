/**
 * S-ADMIN1 Ph3a — stuck-payment queue (/api/v1/admin/stuck-payments).
 *
 * A stuck payment is a token fee Stripe took that did not apply. The queue
 * lists `payment_incidents`; the only actions are:
 *
 *   Re-apply  support+   re-runs the webhook's apply. Never a hand edit.
 *   Refund    admin+     full Stripe refund; a still-pending transfer is cancelled.
 *   Sweep     support+   run the reconciliation now instead of waiting 10 minutes.
 *
 * Rules this file is responsible for:
 *   1. Re-apply and Refund ask STRIPE what happened before touching anything.
 *      The incident row is a pointer; Stripe is the record of the money.
 *   2. Every decision runs inside ONE database function that re-checks the
 *      actor's role and writes the audit row (admin_reapply_payment,
 *      admin_refund_payment_incident).
 *   3. The refund goes to Stripe under an idempotency key derived from the
 *      incident, so a retry after a failed recording returns the same refund.
 *   4. Responses carry ids, codes and amounts. No email, no name.
 */

import type { Request, Response } from 'express';
import type Stripe from 'stripe';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../lib/errors';
import { withLogContext } from '../lib/logger';
import { getStripe } from '../lib/stripe';
import { emitSecurityEvent, type SecurityResult } from '../lib/security/securityEvent';
import { securityContext } from '../lib/security/requestContext';
import { mintOwnershipProof, type SecurityLogContext } from '../lib/ownership/ownershipProof';
import { notifyReissueOwner } from '../lib/notifications/reissueEmails';
import { isGithubIssuesConfigured } from '../lib/github/issues';
import { isSettled, readFeeIntent, type ApplyOutcome } from '../lib/payments/tokenFeeApply';
import {
  noteIncidentClosed,
  PAYMENT_INCIDENT_COLUMNS,
  type IncidentRow,
} from '../lib/payments/paymentIncidents';
import { isRefunded, runTokenFeeSweep } from '../lib/payments/tokenFeeSweep';
import {
  canRefundPayments,
  incidentIdParamSchema,
  intentSuffix,
  listIncidentsQuerySchema,
  reapplyBodySchema,
  refundBodySchema,
} from '../lib/admin/paymentAdmin';

type AdminRequest = Request & { requestId?: string };

const getServiceClient = (): SupabaseClient =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const ok = <T>(res: Response, data: T, status = 200) =>
  res.status(status).json({ success: true, data, error: null });

const pathParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? '') : (value ?? '');

const adminContext = (req: AdminRequest, route: string): SecurityLogContext => ({
  ...securityContext(req, route, 'admin'),
  actorId: req.admin?.admin_id ?? null,
});

const requireAdminId = (req: AdminRequest): string => {
  const adminId = req.admin?.admin_id;
  if (!adminId) throw new AppError('unauthenticated', 'Admin authentication required');
  return adminId;
};

const parseIncidentId = (req: AdminRequest): string => {
  const parsed = incidentIdParamSchema.safeParse(pathParam(req.params.id));
  if (!parsed.success) throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
  return parsed.data;
};

const emitAction = (
  ctx: SecurityLogContext,
  action: 'reapply' | 'refund' | 'sweep',
  incidentId: string | null,
  result: SecurityResult,
): void => {
  emitSecurityEvent({
    event: 'admin.payment_action',
    action,
    incident_id: incidentId,
    result,
    request_id: ctx.requestId,
    actor_id: ctx.actorId,
    actor_type: 'admin',
    ip: ctx.ip,
    route: ctx.route,
  });
};

const loadIncident = async (supabase: SupabaseClient, incidentId: string): Promise<IncidentRow> => {
  const { data, error } = await supabase
    .from('payment_incidents')
    .select(PAYMENT_INCIDENT_COLUMNS)
    .eq('id', incidentId)
    .maybeSingle();
  if (error) throw new AppError('unavailable', 'The payment could not be loaded');
  if (!data) throw new AppError('not_found', 'Stuck payment not found');
  return data as unknown as IncidentRow;
};

/** Known function errors -> API errors. The raw DB text never reaches the client. */
const rpcError = (error: { message?: string } | null): { appError: AppError; result: SecurityResult } => {
  const key = (error?.message ?? '').split(':')[0].trim();
  switch (key) {
    case 'admin_forbidden':
      return { appError: new AppError('permission_denied', 'Forbidden'), result: 'forbidden' };
    case 'reason_required':
      return { appError: new AppError('invalid_argument', 'A reason of at least 10 characters is required'), result: 'invalid_argument' };
    case 'incident_not_found':
      return { appError: new AppError('not_found', 'Stuck payment not found'), result: 'not_found' };
    case 'incident_not_open':
      return { appError: new AppError('conflict', 'This payment has already been resolved'), result: 'conflict' };
    default:
      return { appError: new AppError('internal', 'The action could not be completed'), result: 'internal' };
  }
};

/** Why a Re-apply changed nothing, in words an admin can act on. */
const NOT_APPLIED_COPY: Record<Exclude<ApplyOutcome, 'applied' | 'already_completed' | 'already_paid'>, string> = {
  not_found: 'The transfer or request this payment names no longer exists. Refund it instead.',
  intent_mismatch: 'This payment is not the one its transfer or request is waiting for. Refund it instead.',
  not_payable: 'The transfer or request was cancelled or changed after payment. Refund it instead.',
  no_recipient: 'The transfer has no recipient account yet. Ask the recipient to sign in and accept, then try again.',
  failed: 'Applying the payment failed again. The debug team has the details.',
};

/**
 * The PaymentIntent as Stripe has it now. Re-apply and Refund both start here:
 * an incident row says a payment looked stuck when it was recorded, not that
 * the money is still there.
 */
const fetchIntent = async (intentId: string): Promise<Stripe.PaymentIntent> => {
  try {
    return await getStripe().paymentIntents.retrieve(intentId, { expand: ['latest_charge'] });
  } catch {
    throw new AppError('unavailable', 'Stripe could not be reached. Nothing was changed.');
  }
};

// ── GET /api/v1/admin/stuck-payments ────────────────────────────────────────

const QUEUE_TRANSFER_COLUMNS = 'id, tag_id, status';
const QUEUE_REISSUE_COLUMNS = 'id, tag_id, status, payment_status';
const QUEUE_TAG_COLUMNS = 'id, chip_name';

export const listStuckPayments = async (req: AdminRequest, res: Response) => {
  const parsed = listIncidentsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
  const { status, page, limit } = parsed.data;

  const supabase = getServiceClient();
  let query = supabase
    .from('payment_incidents')
    .select(PAYMENT_INCIDENT_COLUMNS, { count: 'exact' })
    .order('last_seen_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (status !== 'ALL') query = query.eq('status', status);

  const { data, error, count } = await query;
  if (error) throw new AppError('unavailable', 'Stuck payments could not be loaded');
  const rows = (data ?? []) as unknown as IncidentRow[];

  // What each incident points at, as it is now (ids and states only).
  const transferIds = rows.flatMap((r) => (r.transfer_id ? [r.transfer_id] : []));
  const reissueIds = rows.flatMap((r) => (r.reissue_request_id ? [r.reissue_request_id] : []));

  type Target = { tagId: string | null; status: string | null; paymentStatus: string | null };
  const targets = new Map<string, Target>();

  if (transferIds.length > 0) {
    const { data: transfers, error: transferError } = await supabase
      .from('ownership_transfers')
      .select(QUEUE_TRANSFER_COLUMNS)
      .in('id', transferIds);
    if (transferError) throw new AppError('unavailable', 'Stuck payments could not be loaded');
    for (const t of (transfers ?? []) as Array<{ id: string; tag_id: string | null; status: string | null }>) {
      targets.set(t.id, { tagId: t.tag_id, status: t.status, paymentStatus: null });
    }
  }
  if (reissueIds.length > 0) {
    const { data: requests, error: requestError } = await supabase
      .from('reissue_requests')
      .select(QUEUE_REISSUE_COLUMNS)
      .in('id', reissueIds);
    if (requestError) throw new AppError('unavailable', 'Stuck payments could not be loaded');
    for (const r of (requests ?? []) as Array<{ id: string; tag_id: string; status: string; payment_status: string | null }>) {
      targets.set(r.id, { tagId: r.tag_id, status: r.status, paymentStatus: r.payment_status });
    }
  }

  const tagIds = [...new Set([...targets.values()].flatMap((t) => (t.tagId ? [t.tagId] : [])))];
  const chipNames = new Map<string, string | null>();
  if (tagIds.length > 0) {
    const { data: tags, error: tagError } = await supabase
      .from('nfc_tags')
      .select(QUEUE_TAG_COLUMNS)
      .in('id', tagIds);
    if (tagError) throw new AppError('unavailable', 'Stuck payments could not be loaded');
    for (const t of (tags ?? []) as Array<{ id: string; chip_name: string | null }>) chipNames.set(t.id, t.chip_name);
  }

  const items = rows.map((r) => {
    const target = targets.get(r.transfer_id ?? r.reissue_request_id ?? '') ?? null;
    return {
      id: r.id,
      kind: r.kind,
      reason: r.reason,
      status: r.status,
      resolution: r.resolution,
      transferId: r.transfer_id,
      reissueRequestId: r.reissue_request_id,
      paymentIntentId: r.stripe_payment_intent_id,
      amount: r.amount,
      currency: r.currency,
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
      seenCount: r.seen_count,
      lastError: r.last_error,
      githubIssueNumber: r.github_issue_number,
      githubIssueUrl: r.github_issue_url,
      resolvedAt: r.resolved_at,
      refundId: r.stripe_refund_id,
      target: target
        ? {
            tagId: target.tagId,
            chipName: target.tagId ? (chipNames.get(target.tagId) ?? null) : null,
            status: target.status,
            paymentStatus: target.paymentStatus,
          }
        : null,
    };
  });

  return ok(res, {
    items,
    total: count ?? items.length,
    page,
    limit,
    canRefund: canRefundPayments(req.admin?.role),
    // Shown as a warning in the console: without these, nobody is told.
    githubIssuesConfigured: isGithubIssuesConfigured(),
    sweepConfigured: !!process.env.TOKEN_FEE_SWEEP_SECRET?.trim(),
  });
};

// ── POST /api/v1/admin/stuck-payments/:id/reapply ───────────────────────────

export const reapplyStuckPayment = async (req: AdminRequest, res: Response) => {
  const route = '/api/v1/admin/stuck-payments/:id/reapply';
  const ctx = adminContext(req, route);
  const logger = withLogContext({ requestId: req.requestId, route });
  const adminId = requireAdminId(req);
  const incidentId = parseIncidentId(req);

  const parsed = reapplyBodySchema.safeParse(req.body);
  if (!parsed.success) {
    emitAction(ctx, 'reapply', incidentId, 'invalid_argument');
    throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
  }

  const supabase = getServiceClient();
  const incident = await loadIncident(supabase, incidentId);
  if (incident.status !== 'OPEN') {
    emitAction(ctx, 'reapply', incidentId, 'conflict');
    throw new AppError('conflict', 'This payment has already been resolved');
  }

  // Stripe first: the payment must still be there, and still be this payment.
  const intent = await fetchIntent(incident.stripe_payment_intent_id);
  const fee = readFeeIntent(intent);
  const sameTarget =
    fee !== null &&
    fee.kind === incident.kind &&
    fee.transferId === incident.transfer_id &&
    fee.reissueRequestId === incident.reissue_request_id;

  if (intent.status !== 'succeeded' || isRefunded(intent)) {
    emitAction(ctx, 'reapply', incidentId, 'payment_required');
    throw new AppError('failed_precondition', 'Stripe no longer shows this payment as paid. It cannot be applied.');
  }
  if (!sameTarget) {
    emitAction(ctx, 'reapply', incidentId, 'conflict');
    throw new AppError('conflict', NOT_APPLIED_COPY.not_found);
  }

  // A transfer needs a fresh Ownership ID. Minted BEFORE the database is
  // touched: a missing salt key must fail while nothing has changed.
  let proof: { ownershipId: string; tagRef: string; saltEnc: string } | null = null;
  if (incident.kind === 'transfer_fee' && incident.transfer_id) {
    const { data: transfer, error: transferError } = await supabase
      .from('ownership_transfers')
      .select('id, tag_id')
      .eq('id', incident.transfer_id)
      .maybeSingle();
    if (transferError) throw new AppError('unavailable', 'The transfer could not be loaded');
    const tagId = (transfer?.tag_id as string | null) ?? null;
    if (!tagId) {
      emitAction(ctx, 'reapply', incidentId, 'conflict');
      throw new AppError('conflict', NOT_APPLIED_COPY.not_found);
    }
    try {
      proof = mintOwnershipProof(
        { tagId, ownershipEventId: incident.transfer_id, ownershipEventType: 'transfer' },
        ctx,
      );
    } catch {
      logger.error('admin_payment_reapply_mint_failed', { incidentId });
      emitAction(ctx, 'reapply', incidentId, 'internal');
      throw new AppError('unavailable', 'The Ownership ID could not be created. Nothing was changed.');
    }
  }

  const { data, error } = await supabase.rpc('admin_reapply_payment', {
    p_incident: incidentId,
    p_admin: adminId,
    p_reason: parsed.data.reason,
    p_ownership_id: proof?.ownershipId ?? null,
    p_tag_ref: proof?.tagRef ?? null,
    p_salt_enc: proof?.saltEnc ?? null,
  });

  if (error) {
    const mapped = rpcError(error);
    if (mapped.result === 'internal') logger.error('admin_payment_reapply_failed', { incidentId });
    emitAction(ctx, 'reapply', incidentId, mapped.result);
    throw mapped.appError;
  }

  const result = data as { outcome: ApplyOutcome; requester_id?: string | null; charged_amount?: number | null };
  const outcome = result.outcome;

  emitSecurityEvent({
    event: 'payment.reconcile',
    source: 'reapply',
    fee_kind: incident.kind,
    transfer_id: incident.transfer_id,
    reissue_request_id: incident.reissue_request_id,
    outcome,
    result: 'ok',
    request_id: ctx.requestId,
    actor_id: ctx.actorId,
    actor_type: 'admin',
    ip: ctx.ip,
    route: ctx.route,
  });

  if (!isSettled(outcome)) {
    // The attempt is in the audit log (the function wrote it). Nothing moved.
    emitAction(ctx, 'reapply', incidentId, 'conflict');
    throw new AppError('conflict', NOT_APPLIED_COPY[outcome as keyof typeof NOT_APPLIED_COPY] ?? NOT_APPLIED_COPY.failed);
  }

  if (outcome === 'applied' && incident.transfer_id) {
    emitSecurityEvent({
      event: 'transfer.state_change',
      transfer_id: incident.transfer_id,
      from: 'PENDING',
      to: 'COMPLETED',
      trigger: 'reapply',
      result: 'ok',
      request_id: ctx.requestId,
      actor_id: ctx.actorId,
      actor_type: 'admin',
      ip: ctx.ip,
      route: ctx.route,
    });
  }
  if (outcome === 'applied' && incident.reissue_request_id && result.requester_id) {
    await notifyReissueOwner(supabase, 'paid', {
      id: incident.reissue_request_id,
      requesterId: result.requester_id,
      chargedAmount: result.charged_amount ?? null,
    });
  }

  emitAction(ctx, 'reapply', incidentId, 'ok');
  await noteIncidentClosed(supabase, incidentId, 'reapply');

  return ok(res, { incidentId, status: 'RESOLVED', outcome });
};

// ── POST /api/v1/admin/stuck-payments/:id/refund ────────────────────────────

export const refundStuckPayment = async (req: AdminRequest, res: Response) => {
  const route = '/api/v1/admin/stuck-payments/:id/refund';
  const ctx = adminContext(req, route);
  const logger = withLogContext({ requestId: req.requestId, route });
  const adminId = requireAdminId(req);
  const incidentId = parseIncidentId(req);

  // The route already requires admin or super_admin; checked again here so the
  // rule holds even if the route file is ever rearranged.
  if (!canRefundPayments(req.admin?.role)) {
    emitAction(ctx, 'refund', incidentId, 'forbidden');
    throw new AppError('permission_denied', 'Forbidden');
  }

  const parsed = refundBodySchema.safeParse(req.body);
  if (!parsed.success) {
    emitAction(ctx, 'refund', incidentId, 'invalid_argument');
    throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
  }
  const { reason, confirmSuffix } = parsed.data;

  const supabase = getServiceClient();
  const incident = await loadIncident(supabase, incidentId);
  if (incident.status !== 'OPEN') {
    emitAction(ctx, 'refund', incidentId, 'conflict');
    throw new AppError('conflict', 'This payment has already been resolved');
  }
  if (intentSuffix(incident.stripe_payment_intent_id) !== confirmSuffix) {
    emitAction(ctx, 'refund', incidentId, 'invalid_argument');
    throw new AppError('invalid_argument', 'The confirmation does not match this payment');
  }

  const intent = await fetchIntent(incident.stripe_payment_intent_id);
  if (intent.status !== 'succeeded') {
    emitAction(ctx, 'refund', incidentId, 'conflict');
    throw new AppError('failed_precondition', 'Stripe does not show this payment as paid, so there is nothing to refund.');
  }

  const stripe = getStripe();
  let refundId: string;
  try {
    if (isRefunded(intent)) {
      // Refunded already (an earlier attempt, or by hand in the Stripe
      // dashboard). Record that refund rather than asking for a second.
      const existing = await stripe.refunds.list({ payment_intent: intent.id, limit: 1 });
      const found = existing.data[0]?.id;
      if (!found) throw new Error('refund_not_listed');
      refundId = found;
    } else {
      const refund = await stripe.refunds.create(
        {
          payment_intent: intent.id,
          reason: 'requested_by_customer',
          metadata: { incident_id: incident.id, kind: incident.kind },
        },
        // One refund per incident, however many times this is retried.
        { idempotencyKey: `token-fee-refund-${incident.id}` },
      );
      refundId = refund.id;
    }
  } catch {
    logger.error('admin_payment_refund_stripe_failed', { incidentId });
    emitAction(ctx, 'refund', incidentId, 'internal');
    throw new AppError('unavailable', 'Stripe did not accept the refund. Nothing was changed.');
  }

  const { data, error } = await supabase.rpc('admin_refund_payment_incident', {
    p_incident: incidentId,
    p_admin: adminId,
    p_reason: reason,
    p_refund_id: refundId,
  });

  if (error) {
    const mapped = rpcError(error);
    // The money HAS gone back; only our record is missing. Loud, with the ids
    // needed to reconcile by hand. Pressing Refund again is safe (same key).
    logger.error('admin_payment_refund_record_failed', { incidentId, refundId });
    emitAction(ctx, 'refund', incidentId, mapped.result);
    throw mapped.result === 'internal'
      ? new AppError('internal', 'The refund was sent, but recording it failed. Press Refund again to finish.')
      : mapped.appError;
  }

  emitAction(ctx, 'refund', incidentId, 'ok');
  await noteIncidentClosed(supabase, incidentId, 'refund');

  const result = data as { transfer_cancelled?: boolean };
  return ok(res, {
    incidentId,
    status: 'REFUNDED',
    refundId,
    transferCancelled: result.transfer_cancelled === true,
  });
};

// ── POST /api/v1/admin/stuck-payments/sweep ─────────────────────────────────

export const sweepStuckPayments = async (req: AdminRequest, res: Response) => {
  const route = '/api/v1/admin/stuck-payments/sweep';
  const ctx = adminContext(req, route);
  const logger = withLogContext({ requestId: req.requestId, route });
  requireAdminId(req);

  try {
    const summary = await runTokenFeeSweep(getServiceClient(), getStripe(), ctx);
    emitAction(ctx, 'sweep', null, 'ok');
    return ok(res, summary);
  } catch {
    logger.error('admin_payment_sweep_failed', {});
    emitAction(ctx, 'sweep', null, 'internal');
    throw new AppError('unavailable', 'The check could not be completed. Try again in a minute.');
  }
};
