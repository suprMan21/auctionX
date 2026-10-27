/**
 * Admin console UX-3, AC 6 — dashboard growth.
 *
 *   GET /api/v1/admin/stats/growth?series=tokens|accounts&from=YYYY-MM-DD&to=YYYY-MM-DD&bucket=day|month&tz=<IANA zone>
 *
 * tokens needs manage_nfc, accounts needs view_users. The permission depends
 * on a query parameter, so it is checked here after parsing rather than by
 * requirePermission; the database function re-checks it.
 *
 * Counts only. The response is rebuilt field by field from the function's
 * result, so nothing else it might return (an email, an id) can reach the
 * client. No audit row: no person-level data is read out.
 */

import type { Request, Response } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../lib/errors';
import { hasPermission } from '../lib/admin/permissions';
import { growthQuerySchema, SERIES_PERMISSION, type GrowthQuery } from '../lib/admin/growthStats';

type AdminRequest = Request & { requestId?: string };

export type GrowthPoint = { start: string; count: number };
export type GrowthResponse = {
  series: GrowthQuery['series'];
  bucket: GrowthQuery['bucket'];
  tz: string;
  from: string;
  to: string;
  addedToday: number;
  active: number;
  totalBefore: number;
  points: GrowthPoint[];
};

const getServiceClient = (): SupabaseClient =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const ok = <T>(res: Response, data: T, status = 200) =>
  res.status(status).json({ success: true, data, error: null });

const requireAdminId = (req: AdminRequest): string => {
  const adminId = req.admin?.admin_id;
  if (!adminId) throw new AppError('unauthenticated', 'Your session has ended. Sign in again.');
  return adminId;
};

/** The first validation message is shown as-is; the schema writes them for people. */
const parseQuery = (value: unknown): GrowthQuery => {
  const parsed = growthQuerySchema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const message = first?.code === 'unrecognized_keys'
      ? 'This request has an option the server does not know.'
      : first?.message ?? 'Some details are missing or not valid.';
    throw new AppError('invalid_argument', message, parsed.error.issues);
  }
  return parsed.data;
};

/** Known function errors -> API errors. The raw DB text never reaches the client. */
export const growthRpcError = (error: { message?: string; code?: string } | null): AppError => {
  const key = (error?.message ?? '').split(':')[0].trim();
  switch (key) {
    case 'admin_forbidden':
      return new AppError('permission_denied', 'Your staff role cannot do this.');
    case 'range_reversed':
      return new AppError('invalid_argument', 'From must be on or before To.');
    case 'range_too_long':
      return new AppError('invalid_argument', 'That range is too long. Pick a shorter one.');
    case 'invalid_series':
    case 'invalid_bucket':
    case 'invalid_range':
    case 'invalid_tz':
      return new AppError('invalid_argument', 'Some details are missing or not valid.');
    default:
      if (error?.code === '23514') return new AppError('invalid_argument', 'Some details are missing or not valid.');
      return new AppError('internal', 'The numbers could not be loaded. Try again.');
  }
};

const count = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const toPoints = (raw: unknown): GrowthPoint[] =>
  (Array.isArray(raw) ? raw : [])
    .map((p) => p as { start?: unknown; count?: unknown })
    .filter((p) => typeof p?.start === 'string' && DATE_RE.test(p.start))
    .map((p) => ({ start: p.start as string, count: count(p.count) }));

export const getGrowth = async (req: AdminRequest, res: Response) => {
  const adminId = requireAdminId(req);
  const q = parseQuery(req.query);
  if (!hasPermission(req.admin, SERIES_PERMISSION[q.series])) {
    throw new AppError('permission_denied', 'Your staff role cannot do this.');
  }

  const { data, error } = await getServiceClient().rpc('admin_growth_series', {
    p_admin: adminId,
    p_series: q.series,
    p_from: q.from,
    p_to: q.to,
    p_bucket: q.bucket,
    p_tz: q.tz,
  });
  if (error) throw growthRpcError(error);

  const row = (data ?? {}) as Record<string, unknown>;
  const body: GrowthResponse = {
    series: q.series,
    bucket: q.bucket,
    tz: q.tz,
    from: q.from,
    to: q.to,
    addedToday: count(row.addedToday),
    active: count(row.active),
    totalBefore: count(row.totalBefore),
    points: toPoints(row.points),
  };
  return ok(res, body);
};
