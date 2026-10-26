import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { type NextFunction, type Request, type Response } from 'express';
import { permissionsFor } from './helpers/adminRoles';
import { createMockSupabase, resetMockIds, type MockHooks, type Tables, type Row } from './helpers/supabaseMock';

/**
 * S-ADMIN1 Ph3b — admin pricing + voucher API.
 *
 * Proven here:
 *   - admin and super_admin only: support (and no admin) get 403/401 before
 *     any handler runs
 *   - request validation (Stripe $0.50 floor, reason length, ISO dates)
 *   - database function errors map to safe API errors, never raw DB text
 *   - an email lookup writes its audit row BEFORE it runs, and does not run if
 *     the row cannot be written
 *   - price statuses (in effect / scheduled / superseded / cancelled)
 *
 * The database functions (role re-check, audit row, no backdating, voucher
 * redeem) are proven by supabase/tests/s_admin1_ph3b_live.sql.
 */

const ADMIN = '44444444-4444-4444-8444-444444444444';
const BUYER = '22222222-2222-4222-8222-222222222222';

let tables: Tables;
let hooks: MockHooks;
let rpcCalls: Array<{ fn: string; args: Row }>;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(tables, hooks),
}));

const appWith = async (role: string | null) => {
  const { default: pricing } = await import('../routes/admin/pricing');
  const { default: vouchers } = await import('../routes/admin/vouchers');
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (role) {
      (req as unknown as { admin: Row }).admin = {
        admin_id: ADMIN, email: 'admin@example.com', role, permissions: permissionsFor(role), brand: 'auctionx',
      };
    }
    next();
  });
  app.use('/admin/pricing', pricing);
  app.use('/admin/vouchers', vouchers);
  return app;
};

const rpcReturning = (answers: Record<string, { data?: unknown; error?: string }>) =>
  (fn: string, args: Row) => {
    rpcCalls.push({ fn, args });
    const a = answers[fn];
    if (!a) throw new Error(`unexpected rpc ${fn}`);
    return { data: a.data ?? null, error: a.error ? { message: a.error } : null };
  };

beforeEach(() => {
  resetMockIds();
  vi.resetModules();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  rpcCalls = [];
  hooks = {};
  tables = {
    users: [
      { id: ADMIN, email: 'admin@example.com' },
      { id: BUYER, email: 'buyer@example.com' },
    ],
    token_prices: [],
    transfer_voucher_grants: [],
    audit_logs: [],
  };
});

describe('role gate', () => {
  it.each([
    ['support', 403],
    ['moderator', 403],
  ])('refuses %s with %i on every pricing and voucher route', async (role, status) => {
    hooks.rpc = rpcReturning({});
    const app = await appWith(role);
    for (const [method, path] of [
      ['get', '/admin/pricing'],
      ['post', '/admin/pricing'],
      ['post', '/admin/pricing/00000000-0000-4000-8000-000000000001/cancel'],
      ['get', '/admin/vouchers'],
      ['post', '/admin/vouchers'],
      ['post', '/admin/vouchers/00000000-0000-4000-8000-000000000001/revoke'],
    ] as const) {
      const res = await request(app)[method](path).send({});
      expect(res.status, `${method} ${path}`).toBe(status);
    }
    expect(rpcCalls).toHaveLength(0);
    expect(tables.audit_logs).toHaveLength(0);
  });

  it('401s with no admin at all', async () => {
    const app = await appWith(null);
    expect((await request(app).get('/admin/pricing')).status).toBe(401);
  });

  it.each(['admin', 'super_admin'])('lets %s list prices', async (role) => {
    const app = await appWith(role);
    const res = await request(app).get('/admin/pricing');
    expect(res.status).toBe(200);
    expect(res.body.data.current).toEqual({ transfer: 250, token: 1000, reissue: 1000 });
  });
});

describe('prices', () => {
  it('sends a valid change to admin_set_token_price with the acting admin', async () => {
    hooks.rpc = rpcReturning({
      admin_set_token_price: { data: { id: 'p1', kind: 'transfer', amount_usd_cents: 300, effective_from: '2026-10-25T00:00:00Z' } },
    });
    const app = await appWith('admin');
    const res = await request(app).post('/admin/pricing').send({
      kind: 'transfer', amountUsdCents: 300, reason: 'Holiday promotion pricing',
    });
    expect(res.status).toBe(201);
    expect(rpcCalls[0]).toEqual({
      fn: 'admin_set_token_price',
      args: { p_admin: ADMIN, p_kind: 'transfer', p_amount: 300, p_effective_from: null, p_reason: 'Holiday promotion pricing' },
    });
  });

  it.each([
    [{ kind: 'transfer', amountUsdCents: 49, reason: 'Below the Stripe floor' }],
    [{ kind: 'transfer', amountUsdCents: 250.5, reason: 'Fractional cents value' }],
    [{ kind: 'transfer', amountUsdCents: 300, reason: 'short' }],
    [{ kind: 'premium', amountUsdCents: 300, reason: 'Unknown price kind here' }],
    [{ kind: 'transfer', amountUsdCents: 300, reason: 'Not an ISO date given', effectiveFrom: 'tomorrow' }],
    [{ kind: 'transfer', amountUsdCents: 300, reason: 'Extra field is refused', extra: 1 }],
  ])('rejects %j before reaching the database', async (body) => {
    hooks.rpc = rpcReturning({});
    const app = await appWith('admin');
    const res = await request(app).post('/admin/pricing').send(body);
    expect(res.status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  it.each([
    ['effective_in_past', 400, /past/],
    ['admin_forbidden: actor may not act on payments', 403, /staff role cannot/],
    ['price_already_effective', 409, /already in effect/],
    ['some unexpected relation "x" does not exist', 500, /did not work/],
  ])('maps database error %s to %i without leaking it', async (dbError, status, message) => {
    hooks.rpc = rpcReturning({ admin_set_token_price: { error: dbError } });
    const app = await appWith('admin');
    const res = await request(app).post('/admin/pricing').send({
      kind: 'transfer', amountUsdCents: 300, reason: 'A sufficiently long reason',
    });
    expect(res.status).toBe(status);
    expect(res.body.error).toMatch(message);
    expect(JSON.stringify(res.body)).not.toMatch(/relation/);
  });

  it('labels history rows: newest started row in effect, older superseded, future scheduled, cancelled', async () => {
    tables.token_prices = [
      { id: 'a', kind: 'transfer', amount_usd_cents: 250, effective_from: '2026-01-01T00:00:00Z', reason: 'Launch default (decision 2026-10-03)', created_by: null, created_at: '2026-01-01T00:00:00Z', cancelled_at: null, cancelled_by: null, cancel_reason: null },
      { id: 'b', kind: 'transfer', amount_usd_cents: 300, effective_from: '2026-06-01T00:00:00Z', reason: 'Raised after cost review', created_by: ADMIN, created_at: '2026-05-30T00:00:00Z', cancelled_at: null, cancelled_by: null, cancel_reason: null },
      { id: 'c', kind: 'transfer', amount_usd_cents: 200, effective_from: '2999-01-01T00:00:00Z', reason: 'Future promotion price', created_by: ADMIN, created_at: '2026-10-01T00:00:00Z', cancelled_at: null, cancelled_by: null, cancel_reason: null },
      { id: 'd', kind: 'transfer', amount_usd_cents: 900, effective_from: '2026-07-01T00:00:00Z', reason: 'Typo, cancelled later', created_by: ADMIN, created_at: '2026-06-20T00:00:00Z', cancelled_at: '2026-06-21T00:00:00Z', cancelled_by: ADMIN, cancel_reason: 'Entered by mistake' },
    ];
    const app = await appWith('admin');
    const res = await request(app).get('/admin/pricing');
    const status = Object.fromEntries((res.body.data.history as Row[]).map((h) => [h.id, h.status]));
    expect(status).toEqual({ a: 'superseded', b: 'in_effect', c: 'scheduled', d: 'cancelled' });
    expect(res.body.data.current.transfer).toBe(300);
    const b = (res.body.data.history as Row[]).find((h) => h.id === 'b') as Row;
    expect(b.createdBy).toBe('admin@example.com');
  });
});

describe('vouchers', () => {
  it('audits the email lookup first, then grants to that account', async () => {
    hooks.rpc = rpcReturning({
      admin_grant_transfer_vouchers: { data: { id: 'g1', quantity: 3, remaining: 3, expires_at: null } },
    });
    const app = await appWith('admin');
    const res = await request(app).post('/admin/vouchers').send({
      email: '  Buyer@Example.com ', quantity: 3, reason: 'Partner launch goodwill',
    });
    expect(res.status).toBe(201);
    expect(tables.audit_logs[0]).toMatchObject({
      action: 'voucher_search', entity_type: 'admin_search', admin_id: ADMIN,
      changes: { query: 'buyer@example.com', scope: 'voucher_grant' },
    });
    expect(rpcCalls[0].args).toMatchObject({ p_admin: ADMIN, p_user: BUYER, p_quantity: 3, p_expires_at: null });
  });

  it('does not look anyone up, or grant, when the audit row cannot be written', async () => {
    hooks.rpc = rpcReturning({});
    hooks.failInsert = (table) => table === 'audit_logs';
    const app = await appWith('admin');
    const res = await request(app).post('/admin/vouchers').send({
      email: 'buyer@example.com', quantity: 1, reason: 'Partner launch goodwill',
    });
    expect(res.status).toBe(503);
    expect(rpcCalls).toHaveLength(0);
  });

  it('404s an email with no account (after auditing the attempt)', async () => {
    hooks.rpc = rpcReturning({});
    const app = await appWith('admin');
    const res = await request(app).post('/admin/vouchers').send({
      email: 'nobody@example.com', quantity: 1, reason: 'Partner launch goodwill',
    });
    expect(res.status).toBe(404);
    expect(tables.audit_logs).toHaveLength(1);
    expect(rpcCalls).toHaveLength(0);
  });

  it.each([
    [{ email: 'buyer@example.com', quantity: 0, reason: 'Partner launch goodwill' }],
    [{ email: 'buyer@example.com', quantity: 101, reason: 'Partner launch goodwill' }],
    [{ email: 'not-an-email', quantity: 1, reason: 'Partner launch goodwill' }],
    [{ email: 'buyer@example.com', quantity: 1, reason: 'too short' }],
  ])('rejects %j before any lookup', async (body) => {
    hooks.rpc = rpcReturning({});
    const app = await appWith('admin');
    const res = await request(app).post('/admin/vouchers').send(body);
    expect(res.status).toBe(400);
    expect(tables.audit_logs).toHaveLength(0);
  });

  it('lists grants with status and emails; an email filter is audited and narrows the list', async () => {
    tables.transfer_voucher_grants = [
      { id: 'g1', user_id: BUYER, quantity: 3, remaining: 1, reason: 'Partner launch goodwill', expires_at: null, granted_by: ADMIN, created_at: '2026-10-20T00:00:00Z', revoked_at: null, revoked_by: null, revoke_reason: null },
      { id: 'g2', user_id: ADMIN, quantity: 1, remaining: 1, reason: 'Internal testing grant', expires_at: '2020-01-01T00:00:00Z', granted_by: ADMIN, created_at: '2026-10-19T00:00:00Z', revoked_at: null, revoked_by: null, revoke_reason: null },
    ];
    const app = await appWith('super_admin');

    const all = await request(app).get('/admin/vouchers');
    expect(all.status).toBe(200);
    expect((all.body.data.grants as Row[]).map((g) => [g.id, g.status, g.used])).toEqual([['g1', 'active', 2], ['g2', 'expired', 0]]);
    expect(tables.audit_logs).toHaveLength(0);

    const filtered = await request(app).get('/admin/vouchers').query({ email: 'buyer@example.com' });
    expect((filtered.body.data.grants as Row[]).map((g) => g.id)).toEqual(['g1']);
    expect(filtered.body.data.grants[0].userEmail).toBe('buyer@example.com');
    expect(tables.audit_logs[0]).toMatchObject({ changes: { query: 'buyer@example.com', scope: 'voucher_list' } });
  });

  it('maps a double revoke to 409', async () => {
    hooks.rpc = rpcReturning({ admin_revoke_transfer_voucher: { error: 'grant_already_revoked' } });
    const app = await appWith('admin');
    const res = await request(app)
      .post('/admin/vouchers/00000000-0000-4000-8000-000000000009/revoke')
      .send({ reason: 'Granted to the wrong account' });
    expect(res.status).toBe(409);
  });
});

describe('user price + voucher reads', () => {
  it('shows the price in effect and only usable vouchers', async () => {
    tables.token_prices = [
      { id: 'p', kind: 'transfer', amount_usd_cents: 300, effective_from: '2026-01-01T00:00:00Z', cancelled_at: null, created_at: '2026-01-01T00:00:00Z' },
    ];
    tables.transfer_voucher_grants = [
      { id: 'g1', user_id: BUYER, remaining: 2, expires_at: null, revoked_at: null },
      { id: 'g2', user_id: BUYER, remaining: 5, expires_at: '2020-01-01T00:00:00Z', revoked_at: null },
      { id: 'g3', user_id: BUYER, remaining: 4, expires_at: null, revoked_at: '2026-10-01T00:00:00Z' },
      { id: 'g4', user_id: ADMIN, remaining: 9, expires_at: null, revoked_at: null },
    ];
    const { getPrices, getMyVouchers } = await import('../controllers/tokenPricesController');
    const run = async (fn: (req: never, res: never) => Promise<unknown>) => {
      const out: { body: Row } = { body: {} };
      const res = { status() { return this; }, json(b: Row) { out.body = b; return this; } };
      await fn({ user: { id: BUYER } } as never, res as never);
      return out.body.data as Row;
    };
    expect(await run(getPrices)).toEqual({ currency: 'usd', transferUsdCents: 300, reissueUsdCents: 1000, tokenUsdCents: 1000 });
    expect(await run(getMyVouchers)).toEqual({ freeTransfers: 2 });
  });
});
