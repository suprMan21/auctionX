/**
 * S-ADMIN2 Ph1 — accounts, roles and the audit trail.
 *
 *   GET  /api/v1/admin/me                         the caller's role + permissions
 *   GET  /api/v1/admin/users                      search (email, display name, id); audited when non-empty
 *   GET  /api/v1/admin/users/:id                  account detail (minimum needed for support)
 *   GET  /api/v1/admin/users/:id/tokens           token holdings + re-issue history (manage_nfc, audited)
 *   POST /api/v1/admin/users/:id/suspend          { hours, reason }        manage_users
 *   POST /api/v1/admin/users/:id/unsuspend        { reason }               manage_users
 *   POST /api/v1/admin/users/:id/retire           { reason }               manage_users
 *   POST /api/v1/admin/users/:id/reactivate       { reason }               manage_users
 *   POST /api/v1/admin/users/:id/delete           { confirm, reason }      manage_admins
 *   PUT  /api/v1/admin/users/:id/role             { role|null, reason }    manage_admins
 *   GET  /api/v1/admin/account-settings           delete window            view_users
 *   PUT  /api/v1/admin/account-settings           { hours, reason }        manage_admins
 *   GET  /api/v1/admin/audit-logs                 filter by actor, action, entity type, target
 *   GET  /api/v1/admin/audit-logs/facets          values for the filter dropdowns
 *
 * Every change is one database function that re-checks the permission and
 * writes exactly one audit row in the same transaction (AC 3, 10). Acting on a
 * staff account needs manage_admins; nobody acts on their own account.
 */

import type { Request, Response } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../lib/errors';
import { withLogContext } from '../lib/logger';
import {
  accountIdParamSchema,
  auditLogQuerySchema,
  deleteBodySchema,
  reasonBodySchema,
  searchAccountsQuerySchema,
  setDeleteWindowBodySchema,
  setRoleBodySchema,
  suspendBodySchema,
} from '../lib/admin/accountAdmin';

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

const parse = <T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: unknown } } }, value: unknown): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError('invalid_argument', 'Some details are missing or not valid. Check the form and try again.', parsed.error.issues);
  return parsed.data;
};

const accountId = (req: AdminRequest): string => parse(accountIdParamSchema, pathParam(req.params.id));

/** Plain-language reasons a Delete is refused. Order = what to fix first. */
export const DELETE_BLOCKER_TEXT: Record<string, string> = {
  not_retired: 'Retire the account first.',
  delete_window_open: 'The waiting time after retiring has not passed yet.',
  owns_tokens: 'The account still owns tokens. Transfer them to another account first.',
  created_tokens: 'The account created tokens, so it stays retired.',
  pending_transfer: 'The account has a transfer in progress.',
  audit_actor: 'The account took staff actions, so it stays retired.',
  account_has_history: 'The account has payment or re-issue history, so it stays retired.',
  account_not_found: 'The account was not found.',
};

/** Known function errors -> API errors. The raw DB text never reaches the client. */
export const accountRpcError = (error: { message?: string } | null): AppError => {
  const message = error?.message ?? '';
  const key = message.split(':')[0].trim();
  switch (key) {
    case 'admin_forbidden':
      return new AppError('permission_denied', 'Your staff role cannot do this.');
    case 'reason_required':
      return new AppError('invalid_argument', 'Give a reason of at least 10 characters.');
    case 'invalid_duration':
    case 'invalid_window':
    case 'invalid_role':
    case 'invalid_status':
    case 'invalid_type':
    case 'query_too_long':
      return new AppError('invalid_argument', 'Some details are missing or not valid. Check the form and try again.');
    case 'account_not_found':
      return new AppError('not_found', 'Account not found.');
    case 'cannot_act_on_self':
      return new AppError('permission_denied', 'You cannot do this to your own account.');
    case 'account_retired':
      return new AppError('conflict', 'This account is retired.');
    case 'account_suspended':
      return new AppError('conflict', 'This account is suspended.');
    case 'already_retired':
      return new AppError('conflict', 'This account is already retired.');
    case 'not_retired':
      return new AppError('conflict', 'This account is not retired.');
    case 'not_suspended':
      return new AppError('conflict', 'This account is not suspended.');
    case 'no_change':
      return new AppError('conflict', 'Nothing changed. Pick a different role.');
    case 'confirm_mismatch':
      return new AppError('invalid_argument', 'That does not match the part of the email before the @.');
    case 'delete_blocked': {
      const blockers = message.slice(message.indexOf(':') + 1).split(',').map((b) => b.trim()).filter(Boolean);
      const text = blockers.map((b) => DELETE_BLOCKER_TEXT[b]).filter(Boolean);
      return new AppError('conflict', `This account cannot be deleted yet. ${text.length ? text.join(' ') : 'It is not eligible.'}`);
    }
    default:
      return new AppError('internal', 'That did not work. Nothing was changed. Try again.');
  }
};

const callRpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await getServiceClient().rpc(fn, args);
  if (error) throw accountRpcError(error);
  return data as T;
};

const logAction = (req: AdminRequest, action: string, target: string | null) =>
  withLogContext({ requestId: req.requestId, route: '/api/v1/admin/users' }).info('admin_account_action', {
    action,
    adminId: req.admin?.admin_id ?? null,
    targetId: target,
  });

// ── Who am I ────────────────────────────────────────────────────────────────

export const getMe = async (req: AdminRequest, res: Response) => {
  const admin = req.admin;
  if (!admin) throw new AppError('unauthenticated', 'Your session has ended. Sign in again.');
  return ok(res, {
    adminId: admin.admin_id,
    email: admin.email,
    role: admin.role,
    permissions: [...admin.permissions].sort(),
  });
};

// ── Accounts ────────────────────────────────────────────────────────────────

export const searchAccounts = async (req: AdminRequest, res: Response) => {
  const adminId = requireAdminId(req);
  const q = parse(searchAccountsQuerySchema, req.query);
  const data = await callRpc<{ total: number; accounts: unknown[] }>('admin_search_accounts', {
    p_admin: adminId,
    p_query: q.q,
    p_status: q.status,
    p_limit: q.limit,
    p_offset: (q.page - 1) * q.limit,
    p_type: q.type,
  });
  const total = Number(data?.total ?? 0);
  return ok(res, {
    accounts: data?.accounts ?? [],
    pagination: { page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) },
  });
};

export const getAccount = async (req: AdminRequest, res: Response) => {
  const adminId = requireAdminId(req);
  const data = await callRpc<unknown>('admin_get_account', { p_admin: adminId, p_target: accountId(req) });
  return ok(res, data);
};

export const getAccountTokens = async (req: AdminRequest, res: Response) => {
  const adminId = requireAdminId(req);
  const data = await callRpc<unknown>('admin_get_account_tokens', { p_admin: adminId, p_target: accountId(req) });
  return ok(res, data);
};

export const suspendAccount = async (req: AdminRequest, res: Response) => {
  const adminId = requireAdminId(req);
  const target = accountId(req);
  const body = parse(suspendBodySchema, req.body);
  const data = await callRpc<unknown>('admin_suspend_account', {
    p_admin: adminId, p_target: target, p_hours: body.hours, p_reason: body.reason,
  });
  logAction(req, 'account_suspend', target);
  return ok(res, data);
};

const reasonAction = (fn: string, action: string) => async (req: AdminRequest, res: Response) => {
  const adminId = requireAdminId(req);
  const target = accountId(req);
  const body = parse(reasonBodySchema, req.body);
  const data = await callRpc<unknown>(fn, { p_admin: adminId, p_target: target, p_reason: body.reason });
  logAction(req, action, target);
  return ok(res, data);
};

export const unsuspendAccount = reasonAction('admin_unsuspend_account', 'account_unsuspend');
export const retireAccount = reasonAction('admin_retire_account', 'account_retire');
export const reactivateAccount = reasonAction('admin_reactivate_account', 'account_reactivate');

export const deleteAccount = async (req: AdminRequest, res: Response) => {
  const adminId = requireAdminId(req);
  const target = accountId(req);
  const body = parse(deleteBodySchema, req.body);
  const data = await callRpc<unknown>('admin_delete_account', {
    p_admin: adminId, p_target: target, p_confirm: body.confirm, p_reason: body.reason,
  });
  logAction(req, 'account_delete', target);
  return ok(res, data);
};

export const setAccountRole = async (req: AdminRequest, res: Response) => {
  const adminId = requireAdminId(req);
  const target = accountId(req);
  const body = parse(setRoleBodySchema, req.body);
  const data = await callRpc<unknown>('admin_set_account_role', {
    p_admin: adminId, p_target: target, p_role: body.role, p_reason: body.reason,
  });
  logAction(req, 'role_set', target);
  return ok(res, data);
};

// ── Settings ────────────────────────────────────────────────────────────────

export const getAccountSettings = async (req: AdminRequest, res: Response) => {
  requireAdminId(req);
  const { data, error } = await getServiceClient()
    .from('account_settings')
    .select('delete_window_hours, updated_at')
    .eq('id', true)
    .maybeSingle();
  if (error || !data) throw new AppError('unavailable', 'Settings could not be loaded. Try again.');
  return ok(res, { deleteWindowHours: data.delete_window_hours, updatedAt: data.updated_at });
};

export const setDeleteWindow = async (req: AdminRequest, res: Response) => {
  const adminId = requireAdminId(req);
  const body = parse(setDeleteWindowBodySchema, req.body);
  const data = await callRpc<unknown>('admin_set_delete_window', {
    p_admin: adminId, p_hours: body.hours, p_reason: body.reason,
  });
  logAction(req, 'delete_window_set', null);
  return ok(res, data);
};

// ── Audit trail ─────────────────────────────────────────────────────────────

const AUDIT_COLUMNS =
  'log_id, admin_id, admin_email, action, entity_type, entity_id, changes, reason, ip_address, created_at';

export const listAuditLogs = async (req: AdminRequest, res: Response) => {
  requireAdminId(req);
  const q = parse(auditLogQuerySchema, req.query);
  const offset = (q.page - 1) * q.limit;

  const filtered = (head: boolean) => {
    let query = getServiceClient().from('audit_logs').select(AUDIT_COLUMNS, { count: 'exact', head });
    if (q.admin) query = query.eq('admin_id', q.admin);
    if (q.action) query = query.eq('action', q.action);
    if (q.entity) query = query.eq('entity_type', q.entity);
    if (q.target) query = query.eq('entity_id', q.target);
    if (q.from) query = query.gte('created_at', q.from);
    if (q.to) query = query.lt('created_at', q.to);
    return query;
  };

  let { data, error, count } = await filtered(false)
    .order('created_at', { ascending: false })
    .range(offset, offset + q.limit - 1);
  // A page past the end (e.g. after narrowing a filter) is an empty page, not an outage.
  if (error?.code === 'PGRST103') {
    ({ error, count } = await filtered(true));
    data = [];
  }
  if (error) throw new AppError('unavailable', 'Audit log entries could not be loaded. Try again.');

  const total = count ?? 0;
  return ok(res, {
    logs: data ?? [],
    pagination: { page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) },
  });
};

export const auditLogFacets = async (req: AdminRequest, res: Response) => {
  requireAdminId(req);
  const { data, error } = await getServiceClient().rpc('admin_audit_log_facets');
  if (error) throw new AppError('unavailable', 'Filter choices could not be loaded. Try again.');
  return ok(res, data ?? { actions: [], entity_types: [], actors: [] });
};
