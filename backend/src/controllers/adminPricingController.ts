/**
 * S-ADMIN1 Ph3b — admin-set prices and free-transfer vouchers.
 *
 *   GET  /api/v1/admin/pricing              prices in effect, scheduled changes, history
 *   POST /api/v1/admin/pricing              set a price, now or from a future date
 *   POST /api/v1/admin/pricing/:id/cancel   cancel a scheduled change before it starts
 *   GET  /api/v1/admin/vouchers             voucher grants (optional exact email filter)
 *   POST /api/v1/admin/vouchers             grant N free transfers to an account by email
 *   POST /api/v1/admin/vouchers/:id/revoke  revoke a grant's unused vouchers
 *
 * Admin and super_admin only. Every change runs inside one database function
 * that re-checks the role and writes the audit row in the same transaction.
 * An email lookup is audit-logged before it runs (as admin tag search is).
 */

import type { Request, Response } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../lib/errors';
import { withLogContext } from '../lib/logger';
import { DEFAULT_PRICE_CENTS, PRICE_KINDS, currentPrices, type PriceKind } from '../lib/tokenPrices';
import {
  cancelPriceBodySchema,
  grantVoucherBodySchema,
  idParamSchema,
  listVouchersQuerySchema,
  revokeVoucherBodySchema,
  setPriceBodySchema,
} from '../lib/admin/pricingAdmin';

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

/** Known function errors -> API errors. The raw DB text never reaches the client. */
const rpcError = (error: { message?: string } | null): AppError => {
  const key = (error?.message ?? '').split(':')[0].trim();
  switch (key) {
    case 'admin_forbidden':
      return new AppError('permission_denied', 'Your staff role cannot do this.');
    case 'reason_required':
      return new AppError('invalid_argument', 'Give a reason of at least 10 characters.');
    case 'invalid_kind':
    case 'invalid_quantity':
      return new AppError('invalid_argument', 'Some details are missing or not valid. Check the form and try again.');
    case 'effective_in_past':
      return new AppError('invalid_argument', 'A price change cannot start in the past.');
    case 'expiry_in_past':
      return new AppError('invalid_argument', 'The expiry date must be in the future.');
    case 'price_not_found':
      return new AppError('not_found', 'Price change not found.');
    case 'price_already_cancelled':
      return new AppError('conflict', 'This price change was already cancelled.');
    case 'price_already_effective':
      return new AppError('conflict', 'This price is already in effect. Set a new price instead.');
    case 'user_not_found':
      return new AppError('not_found', 'No account uses that email.');
    case 'grant_not_found':
      return new AppError('not_found', 'Free transfer grant not found.');
    case 'grant_already_revoked':
      return new AppError('conflict', 'These free transfers were already revoked.');
    default:
      return new AppError('internal', 'That did not work. Nothing was changed. Try again.');
  }
};

const emailsFor = async (supabase: SupabaseClient, ids: Array<string | null>): Promise<Map<string, string>> => {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase.from('users').select('id, email').in('id', unique);
  if (error) throw new AppError('unavailable', 'Account emails could not be loaded. Try again.');
  return new Map(((data ?? []) as { id: string; email: string }[]).map((u) => [u.id, u.email]));
};

/** Audit row for an email lookup, written BEFORE it runs. No row, no lookup. */
const auditEmailLookup = async (
  supabase: SupabaseClient,
  req: AdminRequest,
  email: string,
  scope: 'voucher_list' | 'voucher_grant',
): Promise<void> => {
  const admin = req.admin;
  if (!admin) throw new AppError('unauthenticated', 'Your session has ended. Sign in again.');
  const { error } = await supabase.from('audit_logs').insert({
    admin_id: admin.admin_id,
    admin_email: admin.email,
    action: 'voucher_search',
    entity_type: 'admin_search',
    entity_id: admin.admin_id,
    changes: { query: email, scope },
    reason: null,
    ip_address: req.ip ?? null,
    user_agent: (req.headers?.['user-agent'] as string | undefined) ?? null,
    brand: admin.brand === 'unmentionables' ? 'unmentionables' : 'auctionx',
  });
  if (error) throw new AppError('unavailable', 'The lookup could not be recorded, so it was not run. Try again.');
};

// ── Prices ──────────────────────────────────────────────────────────────────

interface PriceRow {
  id: string;
  kind: PriceKind;
  amount_usd_cents: number;
  effective_from: string;
  reason: string;
  created_by: string | null;
  created_at: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
}

const PRICE_COLUMNS =
  'id, kind, amount_usd_cents, effective_from, reason, created_by, created_at, cancelled_at, cancelled_by, cancel_reason';

export const PRICE_HISTORY_LIMIT = 100;

type PriceStatus = 'scheduled' | 'in_effect' | 'superseded' | 'cancelled';

/** Status for each row: the newest started, uncancelled row per kind is in effect. */
const priceStatuses = (rows: PriceRow[], now: number): Map<string, PriceStatus> => {
  const statuses = new Map<string, PriceStatus>();
  const inEffect = new Set<string>();
  const sorted = [...rows].sort((a, b) =>
    Date.parse(b.effective_from) - Date.parse(a.effective_from) || Date.parse(b.created_at) - Date.parse(a.created_at));
  for (const r of sorted) {
    if (r.cancelled_at) statuses.set(r.id, 'cancelled');
    else if (Date.parse(r.effective_from) > now) statuses.set(r.id, 'scheduled');
    else if (!inEffect.has(r.kind)) { inEffect.add(r.kind); statuses.set(r.id, 'in_effect'); }
    else statuses.set(r.id, 'superseded');
  }
  return statuses;
};

export const listPrices = async (_req: AdminRequest, res: Response) => {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('token_prices')
    .select(PRICE_COLUMNS)
    .order('effective_from', { ascending: false })
    .limit(PRICE_HISTORY_LIMIT);
  if (error) throw new AppError('unavailable', 'Prices could not be loaded. Try again.');

  const rows = (data ?? []) as unknown as PriceRow[];
  const [current, emails] = await Promise.all([
    currentPrices(supabase),
    emailsFor(supabase, rows.flatMap((r) => [r.created_by, r.cancelled_by])),
  ]);
  const statuses = priceStatuses(rows, Date.now());

  return ok(res, {
    current: Object.fromEntries(PRICE_KINDS.map((k) => [k, current[k]])),
    defaults: DEFAULT_PRICE_CENTS,
    history: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      amountUsdCents: r.amount_usd_cents,
      effectiveFrom: r.effective_from,
      reason: r.reason,
      status: statuses.get(r.id) ?? 'superseded',
      createdBy: r.created_by ? (emails.get(r.created_by) ?? null) : null,
      createdAt: r.created_at,
      cancelledAt: r.cancelled_at,
      cancelledBy: r.cancelled_by ? (emails.get(r.cancelled_by) ?? null) : null,
      cancelReason: r.cancel_reason,
    })),
  });
};

export const setPrice = async (req: AdminRequest, res: Response) => {
  const adminId = requireAdminId(req);
  const body = parse(setPriceBodySchema, req.body);
  const supabase = getServiceClient();

  const { data, error } = await supabase.rpc('admin_set_token_price', {
    p_admin: adminId,
    p_kind: body.kind,
    p_amount: body.amountUsdCents,
    p_effective_from: body.effectiveFrom ?? null,
    p_reason: body.reason,
  });
  if (error) {
    withLogContext({ requestId: req.requestId, route: '/api/v1/admin/pricing' })
      .warn('admin_set_price_failed', { code: (error.message ?? '').split(':')[0].slice(0, 40) });
    throw rpcError(error);
  }
  const row = data as PriceRow;
  return ok(res, {
    id: row.id,
    kind: row.kind,
    amountUsdCents: row.amount_usd_cents,
    effectiveFrom: row.effective_from,
  }, 201);
};

export const cancelPrice = async (req: AdminRequest, res: Response) => {
  const adminId = requireAdminId(req);
  const priceId = parse(idParamSchema, pathParam(req.params.id));
  const body = parse(cancelPriceBodySchema, req.body);

  const { data, error } = await getServiceClient().rpc('admin_cancel_token_price', {
    p_admin: adminId,
    p_price: priceId,
    p_reason: body.reason,
  });
  if (error) throw rpcError(error);
  const row = data as PriceRow;
  return ok(res, { id: row.id, cancelledAt: row.cancelled_at });
};

// ── Vouchers ────────────────────────────────────────────────────────────────

interface GrantRow {
  id: string;
  user_id: string;
  quantity: number;
  remaining: number;
  reason: string;
  expires_at: string | null;
  granted_by: string;
  created_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
}

const GRANT_COLUMNS =
  'id, user_id, quantity, remaining, reason, expires_at, granted_by, created_at, revoked_at, revoked_by, revoke_reason';

type GrantStatus = 'active' | 'used_up' | 'expired' | 'revoked';

const grantStatus = (g: GrantRow, now: number): GrantStatus => {
  if (g.revoked_at) return 'revoked';
  if (g.remaining === 0) return 'used_up';
  if (g.expires_at && Date.parse(g.expires_at) <= now) return 'expired';
  return 'active';
};

const findUserIdByEmail = async (supabase: SupabaseClient, email: string): Promise<string | null> => {
  const { data, error } = await supabase.from('users').select('id').eq('email', email).limit(2);
  if (error) throw new AppError('unavailable', 'The account could not be looked up. Try again.');
  const rows = (data ?? []) as { id: string }[];
  // Emails are unique per account; two rows would mean we cannot tell who is meant.
  return rows.length === 1 ? rows[0].id : null;
};

export const listVouchers = async (req: AdminRequest, res: Response) => {
  const query = parse(listVouchersQuerySchema, req.query);
  const supabase = getServiceClient();

  let userFilter: string | null = null;
  if (query.email) {
    await auditEmailLookup(supabase, req, query.email, 'voucher_list');
    userFilter = await findUserIdByEmail(supabase, query.email);
    if (!userFilter) {
      return ok(res, { grants: [], total: 0, page: query.page, limit: query.limit });
    }
  }

  const from = (query.page - 1) * query.limit;
  let builder = supabase
    .from('transfer_voucher_grants')
    .select(GRANT_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + query.limit - 1);
  if (userFilter) builder = builder.eq('user_id', userFilter);

  const { data, error, count } = await builder;
  if (error) throw new AppError('unavailable', 'Free transfers could not be loaded. Try again.');

  const rows = (data ?? []) as unknown as GrantRow[];
  const emails = await emailsFor(supabase, rows.flatMap((g) => [g.user_id, g.granted_by, g.revoked_by]));
  const now = Date.now();

  return ok(res, {
    grants: rows.map((g) => ({
      id: g.id,
      userEmail: emails.get(g.user_id) ?? null,
      quantity: g.quantity,
      remaining: g.remaining,
      used: g.quantity - g.remaining,
      reason: g.reason,
      expiresAt: g.expires_at,
      status: grantStatus(g, now),
      grantedBy: emails.get(g.granted_by) ?? null,
      createdAt: g.created_at,
      revokedAt: g.revoked_at,
      revokedBy: g.revoked_by ? (emails.get(g.revoked_by) ?? null) : null,
      revokeReason: g.revoke_reason,
    })),
    total: count ?? rows.length,
    page: query.page,
    limit: query.limit,
  });
};

export const grantVouchers = async (req: AdminRequest, res: Response) => {
  const adminId = requireAdminId(req);
  const body = parse(grantVoucherBodySchema, req.body);
  const supabase = getServiceClient();

  await auditEmailLookup(supabase, req, body.email, 'voucher_grant');
  const userId = await findUserIdByEmail(supabase, body.email);
  if (!userId) throw new AppError('not_found', 'No account uses that email.');

  const { data, error } = await supabase.rpc('admin_grant_transfer_vouchers', {
    p_admin: adminId,
    p_user: userId,
    p_quantity: body.quantity,
    p_reason: body.reason,
    p_expires_at: body.expiresAt ?? null,
  });
  if (error) throw rpcError(error);
  const row = data as GrantRow;
  return ok(res, {
    id: row.id,
    userEmail: body.email,
    quantity: row.quantity,
    remaining: row.remaining,
    expiresAt: row.expires_at,
  }, 201);
};

export const revokeVoucher = async (req: AdminRequest, res: Response) => {
  const adminId = requireAdminId(req);
  const grantId = parse(idParamSchema, pathParam(req.params.id));
  const body = parse(revokeVoucherBodySchema, req.body);

  const { data, error } = await getServiceClient().rpc('admin_revoke_transfer_voucher', {
    p_admin: adminId,
    p_grant: grantId,
    p_reason: body.reason,
  });
  if (error) throw rpcError(error);
  const row = data as GrantRow;
  return ok(res, { id: row.id, revokedAt: row.revoked_at, unused: row.remaining });
};
