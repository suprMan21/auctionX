/**
 * S-2FA Ph3a — two-admin approval (/api/v1/admin/approvals + the gated actions).
 *
 *   POST /admin/tags/:tagId/reset | /suspend, /admin/users/:id/suspend | /retire
 *        flag FEATURE_ADMIN_TWO_PERSON on and the caller lacks act_without_approval:
 *        202 { approvalRequired: true, approvalId, expiresAt }; nothing runs yet.
 *   GET  /admin/approvals?status=waiting_for_me|open|closed|all
 *   POST /admin/approvals/:id/approve   different admin, same permission, passkey step-up
 *   POST /admin/approvals/:id/reject    { reason }   different admin
 *   POST /admin/approvals/:id/cancel    requester only
 *
 * The decision commits with its audit row before the action runs. The stored
 * payload runs as stored (hash checked), with the APPROVER as the acting admin,
 * through the same code path as a direct action. Its outcome is recorded on the
 * request either way.
 */

import type { Request, Response } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../lib/errors';
import { withLogContext } from '../lib/logger';
import {
  APPROVAL_ERRORS,
  APPROVAL_PERMISSION,
  approvalIdParamSchema,
  approvalRequired,
  emptyBodySchema,
  listApprovalsQuerySchema,
  payloadHash,
  rejectBodySchema,
  visibleApprovalActions,
  type ApprovalAction,
} from '../lib/admin/approvals';
import { hasPermission } from '../lib/admin/permissions';
import {
  checkResetConfirmation,
  loadEmailsByIds,
  parseResetBody,
  parseSuspensionBody,
  runTagReset,
  runTagSuspension,
  tagIdFrom,
} from './adminTagController';
import {
  accountIdFrom,
  parseReasonBody,
  parseSuspendAccountBody,
  runRetireAccount,
  runSuspendAccount,
} from './adminAccountsController';

type AdminRequest = Request & { requestId?: string };

const getServiceClient = (): SupabaseClient =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const ok = <T>(res: Response, data: T, status = 200) =>
  res.status(status).json({ success: true, data, error: null });

const pathParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? '') : (value ?? '');

const requireAdminId = (req: AdminRequest): string => {
  const adminId = req.admin?.admin_id;
  if (!adminId) throw new AppError('unauthenticated', 'Your session has ended. Sign in again.');
  return adminId;
};

const invalid = (issues?: unknown) =>
  new AppError('invalid_argument', 'Some details are missing or not valid. Check the form and try again.', issues);

/** Known approval function errors; anything else is passed through or becomes internal. */
const approvalRpcError = (error: { message?: string } | null): AppError => {
  const key = (error?.message ?? '').split(':')[0].trim();
  const known = APPROVAL_ERRORS[key];
  return known ? new AppError(known[0], known[1]) : new AppError('internal', 'That did not work. Nothing was changed. Try again.');
};

// ── The gated actions ───────────────────────────────────────────────────────

interface ActionSpec<B> {
  /** The record the action changes, from the route. */
  target: (req: AdminRequest) => string;
  /** Parses (and on failure records) a request body or a stored payload. */
  parse: (req: AdminRequest, target: string, raw: unknown) => B;
  /** Checks that can fail fast before a request is stored (they run again at approval). */
  precheck?: (req: AdminRequest, target: string, body: B) => Promise<void>;
  run: (req: AdminRequest, target: string, body: B) => Promise<unknown>;
  reason: (body: B) => string;
}

type AnySpec = ActionSpec<Record<string, unknown>>;
/** Erases the body type so the four specs fit one table (each spec parses its own body). */
const spec = <B>(s: ActionSpec<B>): AnySpec => s as unknown as AnySpec;

const SPECS: Record<ApprovalAction, AnySpec> = {
  tag_reset: spec({
    target: tagIdFrom,
    parse: parseResetBody,
    precheck: checkResetConfirmation,
    run: runTagReset,
    reason: (b) => b.reason,
  }),
  tag_suspend: spec({
    target: tagIdFrom,
    parse: (req, target, raw) => parseSuspensionBody(req, target, raw, true),
    run: (req, target, body) => runTagSuspension(req, target, body, true),
    reason: (b) => b.reason,
  }),
  account_suspend: spec({
    target: accountIdFrom,
    parse: (_req, _target, raw) => parseSuspendAccountBody(raw),
    run: runSuspendAccount,
    reason: (b) => b.reason,
  }),
  account_retire: spec({
    target: accountIdFrom,
    parse: (_req, _target, raw) => parseReasonBody(raw),
    run: runRetireAccount,
    reason: (b) => b.reason,
  }),
};

const specFor = (action: ApprovalAction): AnySpec => SPECS[action];

/**
 * The route handler for a destructive action. It runs at once for a caller who
 * may act alone (or with the flag off); otherwise the parsed body is stored as
 * a request for a second admin and the response is 202.
 */
export const approvalGated = (action: ApprovalAction) => async (req: AdminRequest, res: Response) => {
  const adminId = requireAdminId(req);
  const gated = specFor(action);
  const target = gated.target(req);
  const body = gated.parse(req, target, req.body);

  if (!approvalRequired(req.admin)) return ok(res, await gated.run(req, target, body));

  await gated.precheck?.(req, target, body);
  const { data, error } = await getServiceClient().rpc('admin_request_approval', {
    p_admin: adminId,
    p_action: action,
    p_target: target,
    p_payload: body,
    p_payload_hash: payloadHash(body),
    p_reason: gated.reason(body),
  });
  if (error) {
    const mapped = approvalRpcError(error);
    if (mapped.code === 'internal') {
      withLogContext({ requestId: req.requestId, route: '/api/v1/admin/approvals' }).error('approval_request_failed', { action, error: error.message.slice(0, 200) });
    }
    throw mapped;
  }
  const created = data as { id: string; expires_at: string };
  withLogContext({ requestId: req.requestId, route: '/api/v1/admin/approvals' }).info('approval_requested', { action, approvalId: created.id, adminId });
  return ok(res, { approvalRequired: true, approvalId: created.id, expiresAt: created.expires_at }, 202);
};

// ── GET /admin/approvals ────────────────────────────────────────────────────

type ApprovalRow = {
  id: string;
  action: ApprovalAction;
  target_id: string;
  payload: Record<string, unknown>;
  reason: string;
  requested_by: string;
  requested_at: string;
  expires_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision: 'approved' | 'rejected' | 'cancelled' | 'expired' | null;
  decision_note: string | null;
  executed_at: string | null;
  result: { ok?: boolean; message?: string } | null;
};

// One literal on purpose: schemaColumnDrift.test.ts reads `*COLUMNS` constants.
const APPROVAL_COLUMNS =
  'id, action, target_id, payload, reason, requested_by, requested_at, expires_at, decided_by, decided_at, decision, decision_note, executed_at, result';

type ChipLabel = { chipName: string | null; serialSuffix: string | null };

const loadChipLabels = async (supabase: SupabaseClient, ids: string[]): Promise<Map<string, ChipLabel>> => {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase.from('nfc_tags').select('id, chip_name, chip_serial').in('id', unique);
  if (error) throw new AppError('unavailable', 'Approval requests could not be loaded. Try again.');
  return new Map(((data ?? []) as { id: string; chip_name: string | null; chip_serial: string | null }[]).map((t) => [
    t.id,
    { chipName: t.chip_name, serialSuffix: t.chip_serial ? t.chip_serial.slice(-6).toUpperCase() : null },
  ]));
};

const statusOf = (row: ApprovalRow, now: number): 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired' =>
  row.decision ?? (Date.parse(row.expires_at) <= now ? 'expired' : 'pending');

export const listApprovals = async (req: AdminRequest, res: Response) => {
  const adminId = requireAdminId(req);
  const parsed = listApprovalsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw invalid(parsed.error.issues);
  const q = parsed.data;
  const actions = visibleApprovalActions(req.admin);
  if (actions.length === 0) throw new AppError('permission_denied', 'Your staff role cannot do this.');

  const supabase = getServiceClient();
  const nowIso = new Date().toISOString();
  let query = supabase
    .from('admin_action_approvals')
    .select(APPROVAL_COLUMNS, { count: 'exact' })
    .in('action', actions)
    .order('requested_at', { ascending: false })
    .range((q.page - 1) * q.limit, q.page * q.limit - 1);
  if (q.status === 'open' || q.status === 'waiting_for_me') query = query.is('decision', null).gt('expires_at', nowIso);
  if (q.status === 'waiting_for_me') query = query.neq('requested_by', adminId);
  if (q.id) query = query.eq('id', q.id);
  if (q.status === 'closed') query = query.or(`decision.not.is.null,expires_at.lte.${nowIso}`);

  const { data, error, count } = await query;
  if (error) throw new AppError('unavailable', 'Approval requests could not be loaded. Try again.');
  const rows = (data ?? []) as unknown as ApprovalRow[];

  const tagIds = rows.flatMap((r) =>
    r.action === 'tag_reset' ? [r.target_id, String(r.payload.newTagId ?? '')] : r.action === 'tag_suspend' ? [r.target_id] : [],
  ).filter(Boolean);
  const [emails, chips] = await Promise.all([
    loadEmailsByIds(supabase, rows.flatMap((r) => [r.requested_by, r.decided_by, r.action.startsWith('account_') ? r.target_id : null])),
    loadChipLabels(supabase, tagIds),
  ]);

  const now = Date.now();
  const approvals = rows.map((r) => {
    const status = statusOf(r, now);
    const isTag = r.action.startsWith('tag_');
    return {
      id: r.id,
      action: r.action,
      status,
      target: isTag
        ? { kind: 'token' as const, id: r.target_id, ...(chips.get(r.target_id) ?? { chipName: null, serialSuffix: null }) }
        : { kind: 'account' as const, id: r.target_id, email: emails.get(r.target_id) ?? null },
      // Only what the approver needs to decide; never the typed confirmation.
      details: r.action === 'tag_reset'
        ? { newTagId: r.payload.newTagId ?? null, newChip: chips.get(String(r.payload.newTagId ?? '')) ?? null }
        : r.action === 'account_suspend'
          ? { hours: r.payload.hours ?? null }
          : {},
      reason: r.reason,
      requestedBy: { id: r.requested_by, email: emails.get(r.requested_by) ?? null },
      requestedAt: r.requested_at,
      expiresAt: r.expires_at,
      decidedBy: r.decided_by ? { id: r.decided_by, email: emails.get(r.decided_by) ?? null } : null,
      decidedAt: r.decided_at,
      decisionNote: r.decision_note,
      executedAt: r.executed_at,
      outcome: r.result ? { ok: r.result.ok === true, message: r.result.ok === true ? null : (r.result.message ?? null) } : null,
      canApprove: status === 'pending' && r.requested_by !== adminId && hasPermission(req.admin, APPROVAL_PERMISSION[r.action]),
      canCancel: status === 'pending' && r.requested_by === adminId,
    };
  });

  const total = count ?? approvals.length;
  return ok(res, { approvals, pagination: { page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) } });
};

// ── POST /admin/approvals/:id/approve | /reject | /cancel ───────────────────

const approvalIdFrom = (req: AdminRequest): string => {
  const parsed = approvalIdParamSchema.safeParse(pathParam(req.params.id));
  if (!parsed.success) throw invalid(parsed.error.issues);
  return parsed.data;
};

type Decided = {
  id: string;
  action: ApprovalAction;
  target_id: string;
  payload: Record<string, unknown>;
  payload_hash: string;
  requested_by: string;
};

const decide = async (adminId: string, id: string, decision: 'approved' | 'rejected' | 'cancelled', note: string | null): Promise<Decided> => {
  const { data, error } = await getServiceClient().rpc('admin_decide_approval', {
    p_admin: adminId, p_id: id, p_decision: decision, p_note: note,
  });
  if (error) {
    const mapped = approvalRpcError(error);
    if (mapped.code === 'internal') {
      withLogContext({ route: '/api/v1/admin/approvals' }).error('approval_decide_failed', { approvalId: id, decision, error: (error.message ?? '').slice(0, 200) });
    }
    throw mapped;
  }
  return data as Decided;
};

const recordResult = async (req: AdminRequest, id: string, result: Record<string, unknown>): Promise<void> => {
  const { error } = await getServiceClient().rpc('admin_record_approval_result', { p_id: id, p_result: result });
  // The action has already run (or failed); a lost result is logged, not retried.
  if (error) withLogContext({ requestId: req.requestId, route: '/api/v1/admin/approvals' }).error('approval_result_not_recorded', { approvalId: id, error: error.message.slice(0, 200) });
};

export const approveApproval = async (req: AdminRequest, res: Response) => {
  const adminId = requireAdminId(req);
  const id = approvalIdFrom(req);
  const bodyParsed = emptyBodySchema.safeParse(req.body ?? {});
  if (!bodyParsed.success) throw invalid(bodyParsed.error.issues);

  const decided = await decide(adminId, id, 'approved', null);
  const logger = withLogContext({ requestId: req.requestId, route: '/api/v1/admin/approvals/:id/approve' });

  if (payloadHash(decided.payload) !== decided.payload_hash) {
    logger.error('approval_payload_mismatch', { approvalId: id });
    await recordResult(req, id, { ok: false, code: 'internal', message: 'The stored request did not match. Nothing was changed.' });
    throw new AppError('internal', 'That did not work. Nothing was changed. Try again.');
  }

  const approved = specFor(decided.action);
  try {
    const body = approved.parse(req, decided.target_id, decided.payload);
    const data = await approved.run(req, decided.target_id, body);
    await recordResult(req, id, { ok: true });
    logger.info('approval_executed', { approvalId: id, action: decided.action, adminId });
    return ok(res, { approvalId: id, status: 'approved', result: data });
  } catch (err) {
    const appError = err instanceof AppError ? err : new AppError('internal', 'That did not work. Nothing was changed. Try again.');
    await recordResult(req, id, { ok: false, code: appError.code, message: appError.message });
    logger.info('approval_execution_failed', { approvalId: id, action: decided.action, code: appError.code });
    throw err;
  }
};

export const rejectApproval = async (req: AdminRequest, res: Response) => {
  const adminId = requireAdminId(req);
  const id = approvalIdFrom(req);
  const parsed = rejectBodySchema.safeParse(req.body);
  if (!parsed.success) throw invalid(parsed.error.issues);
  await decide(adminId, id, 'rejected', parsed.data.reason);
  return ok(res, { approvalId: id, status: 'rejected' });
};

export const cancelApproval = async (req: AdminRequest, res: Response) => {
  const adminId = requireAdminId(req);
  const id = approvalIdFrom(req);
  const parsed = emptyBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) throw invalid(parsed.error.issues);
  await decide(adminId, id, 'cancelled', null);
  return ok(res, { approvalId: id, status: 'cancelled' });
};
