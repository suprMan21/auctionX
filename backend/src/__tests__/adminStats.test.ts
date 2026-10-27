import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { type NextFunction, type Request, type Response } from 'express';
import { permissionsFor } from './helpers/adminRoles';
import { createMockSupabase, resetMockIds, type MockHooks, type Tables, type Row } from './helpers/supabaseMock';

/**
 * Admin console UX-3, AC 6 — GET /admin/stats/growth.
 *
 * Proven here: the permission follows the series (tokens: manage_nfc,
 * accounts: view_users), query validation (strict keys, real dates, order,
 * per-bucket caps, IANA zone), safe mapping of database errors, numbers
 * coerced, and that the response carries the contract keys and nothing else.
 *
 * Bucket boundaries, zero-filling and the database re-checks are proven by
 * supabase/tests/admin_ux3_growth_live.sql.
 */

const ADMIN = '44444444-4444-4444-8444-444444444444';
const CONTRACT_KEYS = ['active', 'addedToday', 'bucket', 'from', 'points', 'series', 'to', 'totalBefore', 'tz'];
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

let tables: Tables;
let hooks: MockHooks;
let rpcCalls: Array<{ fn: string; args: Row }>;
let rpcAnswer: { data?: unknown; error?: { message: string; code?: string } };

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(tables, hooks),
}));

const appWith = async (permissions: string[] | null) => {
  const { default: stats } = await import('../routes/admin/stats');
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (permissions) {
      (req as unknown as { admin: Row }).admin = {
        admin_id: ADMIN, email: 'admin@example.com', role: 'x', permissions, brand: 'both',
      };
    }
    next();
  });
  app.use('/admin/stats', stats);
  return app;
};

const qs = (over: Record<string, string> = {}) =>
  new URLSearchParams({
    series: 'accounts', from: '2026-10-01', to: '2026-10-03', bucket: 'day', tz: 'America/Toronto', ...over,
  }).toString();

const get = async (perms: string[] | null, query: string) =>
  request(await appWith(perms)).get(`/admin/stats/growth?${query}`);

const SUPER = permissionsFor('super_admin');

beforeEach(() => {
  resetMockIds();
  vi.resetModules();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  rpcCalls = [];
  tables = {};
  rpcAnswer = {
    data: {
      series: 'accounts', bucket: 'day', tz: 'America/Toronto', from: '2026-10-01', to: '2026-10-03',
      addedToday: 2, active: 40, totalBefore: 35,
      points: [{ start: '2026-10-01', count: 1 }, { start: '2026-10-02', count: 0 }, { start: '2026-10-03', count: 4 }],
    },
  };
  hooks = {
    rpc: (fn: string, args: Row) => {
      rpcCalls.push({ fn, args });
      return { data: rpcAnswer.data ?? null, error: rpcAnswer.error ?? null };
    },
  };
});

describe('happy path', () => {
  it('accounts by day: passes the query to the function and returns the contract', async () => {
    const res = await get(SUPER, qs());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.error).toBeNull();
    expect(res.body.data).toEqual({
      series: 'accounts', bucket: 'day', tz: 'America/Toronto', from: '2026-10-01', to: '2026-10-03',
      addedToday: 2, active: 40, totalBefore: 35,
      points: [{ start: '2026-10-01', count: 1 }, { start: '2026-10-02', count: 0 }, { start: '2026-10-03', count: 4 }],
    });
    expect(rpcCalls).toEqual([{
      fn: 'admin_growth_series',
      args: { p_admin: ADMIN, p_series: 'accounts', p_from: '2026-10-01', p_to: '2026-10-03', p_bucket: 'day', p_tz: 'America/Toronto' },
    }]);
  });

  it('tokens by month: month starts on the 1st, zero-filled points passed through', async () => {
    rpcAnswer = {
      data: {
        addedToday: 0, active: 3, totalBefore: 0,
        points: [{ start: '2026-08-01', count: 0 }, { start: '2026-09-01', count: 0 }, { start: '2026-10-01', count: 5 }],
      },
    };
    const res = await get(SUPER, qs({ series: 'tokens', bucket: 'month', from: '2026-08-15', to: '2026-10-27' }));
    expect(res.status).toBe(200);
    expect(res.body.data.series).toBe('tokens');
    expect(res.body.data.bucket).toBe('month');
    expect(res.body.data.points).toEqual([
      { start: '2026-08-01', count: 0 }, { start: '2026-09-01', count: 0 }, { start: '2026-10-01', count: 5 },
    ]);
  });

  it('coerces bigint strings to numbers', async () => {
    rpcAnswer = { data: { addedToday: '7', active: '12', totalBefore: '100', points: [{ start: '2026-10-01', count: '9' }] } };
    const res = await get(SUPER, qs({ from: '2026-10-01', to: '2026-10-01' }));
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect([d.addedToday, d.active, d.totalBefore, d.points[0].count]).toEqual([7, 12, 100, 9]);
    for (const v of [d.addedToday, d.active, d.totalBefore, d.points[0].count]) expect(typeof v).toBe('number');
  });

  it('a missing result is all zeros, not an error', async () => {
    rpcAnswer = { data: null };
    const res = await get(SUPER, qs());
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ addedToday: 0, active: 0, totalBefore: 0, points: [] });
  });
});

describe('no private fields', () => {
  it('returns only the contract keys even when the function returns more', async () => {
    rpcAnswer = {
      data: {
        addedToday: 1, active: 2, totalBefore: 3,
        email: 'someone@example.com', account_id: '0b211aed-3cf9-4729-818d-f0ed88dd68b8',
        tag_uid: '04A27E02936980', chip_serial: 'ABCDEF0123456789', chip_name: 'chip_004',
        points: [{
          start: '2026-10-01', count: 1, email: 'x@example.com', id: '885d30e1-4322-49a8-8363-b7926991c58d', uid: '04A27E02936980',
        }, { start: 'someone@example.com', count: 1 }],
      },
    };
    const res = await get(SUPER, qs());
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(CONTRACT_KEYS);
    expect(res.body.data.points).toEqual([{ start: '2026-10-01', count: 1 }]);
    for (const p of res.body.data.points) expect(Object.keys(p).sort()).toEqual(['count', 'start']);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('@');
    expect(text).not.toMatch(UUID_RE);
    expect(text).not.toContain('04A27E02936980');
    expect(text).not.toContain('chip_');
  });
});

describe('permission follows the series', () => {
  it('support (view_users, no manage_nfc): accounts 200, tokens 403', async () => {
    const support = permissionsFor('support');
    expect(support).toContain('view_users');
    expect(support).not.toContain('manage_nfc');
    expect((await get(support, qs({ series: 'accounts' }))).status).toBe(200);
    const res = await get(support, qs({ series: 'tokens' }));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, data: null, error: 'Your staff role cannot do this.', code: 'permission_denied' });
    expect(JSON.stringify(res.body)).not.toContain('view_users');
    expect(rpcCalls).toHaveLength(1); // only the accounts call reached the database
  });

  it('manage_nfc without view_users: tokens 200, accounts 403', async () => {
    expect((await get(['manage_nfc'], qs({ series: 'tokens' }))).status).toBe(200);
    expect((await get(['manage_nfc'], qs({ series: 'accounts' }))).status).toBe(403);
  });

  it('no admin on the request: 401', async () => {
    expect((await get(null, qs())).status).toBe(401);
  });

  it('the database refusing (admin_forbidden) is a 403', async () => {
    rpcAnswer = { error: { message: 'admin_forbidden: actor lacks view_users', code: '42501' } };
    const res = await get(SUPER, qs());
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Your staff role cannot do this.');
    expect(JSON.stringify(res.body)).not.toContain('actor lacks');
  });
});

describe('validation', () => {
  const expect400 = async (query: string, message?: RegExp) => {
    const res = await get(SUPER, query);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.data).toBeNull();
    if (message) expect(res.body.error).toMatch(message);
    expect(rpcCalls).toHaveLength(0);
  };

  it('reversed range', () => expect400(qs({ from: '2026-10-05', to: '2026-10-04' }), /From must be on or before To/));
  it('same day is allowed', async () => {
    expect((await get(SUPER, qs({ from: '2026-10-05', to: '2026-10-05' }))).status).toBe(200);
  });

  it('day bucket: 366 days allowed, 367 refused', async () => {
    expect((await get(SUPER, qs({ from: '2025-10-27', to: '2026-10-27' }))).status).toBe(200); // 366 days
    rpcCalls = [];
    await expect400(qs({ from: '2025-10-26', to: '2026-10-27' }), /at most 366 days/);
  });

  it('month bucket: 60 months allowed, 61 refused', async () => {
    expect((await get(SUPER, qs({ bucket: 'month', from: '2021-11-30', to: '2026-10-01' }))).status).toBe(200); // 60
    rpcCalls = [];
    await expect400(qs({ bucket: 'month', from: '2021-10-31', to: '2026-10-01' }), /at most 60 months/);
  });

  it('bad time zone', () => expect400(qs({ tz: 'Mars/Olympus' }), /Time zone/));
  it('over-long time zone', () => expect400(qs({ tz: `America/${'x'.repeat(60)}` }), /Time zone/));
  it('not a real date', () => expect400(qs({ from: '2026-02-30' }), /real date/));
  it('wrong date form', () => expect400(qs({ to: '10/27/2026' }), /real date/));
  it('unknown series', () => expect400(qs({ series: 'listings' })));
  it('unknown bucket', () => expect400(qs({ bucket: 'week' })));
  it('missing parameter', () => expect400('series=accounts&from=2026-10-01&to=2026-10-03&bucket=day'));
  it('unknown query key (strict)', () => expect400(`${qs()}&email=a@example.com`));
  it('repeated parameter', () => expect400(`${qs()}&series=tokens`));
});

describe('database errors map to safe API errors', () => {
  it.each([
    ['range_reversed', 400],
    ['range_too_long', 400],
    ['invalid_tz', 400],
    ['something unexpected at line 3', 500],
  ])('%s -> %i', async (message, status) => {
    rpcAnswer = { error: { message } };
    const res = await get(SUPER, qs());
    expect(res.status).toBe(status);
    expect(res.body.error).not.toContain('line 3');
  });

  it('a bare check_violation is a 400', async () => {
    rpcAnswer = { error: { message: 'new row violates check', code: '23514' } };
    expect((await get(SUPER, qs())).status).toBe(400);
  });
});
