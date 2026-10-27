import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { type NextFunction, type Request, type Response } from 'express';
import { permissionsFor } from './helpers/adminRoles';
import { createMockSupabase, resetMockIds, type MockHooks, type Tables, type Row } from './helpers/supabaseMock';

/**
 * S-ADMIN2 Ph1 — account administration API.
 *
 * Proven here:
 *   - every route is gated by a PERMISSION (support views, admin suspends and
 *     retires, only super_admin deletes and changes roles)
 *   - request validation (duration, grantable roles, reason length)
 *   - database function errors map to safe API errors, never raw DB text
 *   - a 403 never lists the admin's permissions
 *   - suspended / retired accounts are refused by requireAuth; an unreadable
 *     status fails closed
 *
 * The database functions (actor re-check, one audit row, staff targets need
 * manage_admins, delete window, blockers, auth ban + sessions) are proven by
 * supabase/tests/s_admin2_accounts_live.sql.
 */

const ADMIN = '44444444-4444-4444-8444-444444444444';
const TARGET = '22222222-2222-4222-8222-222222222222';

let tables: Tables;
let hooks: MockHooks;
let rpcCalls: Array<{ fn: string; args: Row }>;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(tables, hooks),
}));

const appWith = async (role: string | null) => {
  const { default: users } = await import('../routes/admin/users');
  const { default: auditLogs } = await import('../routes/admin/auditLogs');
  const { default: settings } = await import('../routes/admin/accountSettings');
  const { getMe } = await import('../controllers/adminAccountsController');
  const { handle } = await import('../routes/tagManagement');
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (role) {
      (req as unknown as { admin: Row }).admin = {
        admin_id: ADMIN, email: 'admin@example.com', role, permissions: permissionsFor(role), brand: 'both',
      };
    }
    next();
  });
  app.get('/admin/me', handle(getMe));
  app.use('/admin/users', users);
  app.use('/admin/audit-logs', auditLogs);
  app.use('/admin/account-settings', settings);
  return app;
};

const rpcReturning = (answers: Record<string, { data?: unknown; error?: string }>) =>
  (fn: string, args: Row) => {
    rpcCalls.push({ fn, args });
    const a = answers[fn];
    if (!a) throw new Error(`unexpected rpc ${fn}`);
    return { data: a.data ?? null, error: a.error ? { message: a.error } : null };
  };

const REASON = 'Support ticket 1234: account review';

beforeEach(() => {
  resetMockIds();
  vi.resetModules();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  rpcCalls = [];
  hooks = {
    rpc: rpcReturning({
      admin_search_accounts: { data: { total: 1, accounts: [{ id: TARGET, email: 'a@example.com' }] } },
      admin_get_account: { data: { id: TARGET, status: 'active' } },
      admin_get_account_tokens: { data: { tokens: [], reissue_requests: [] } },
      admin_suspend_account: { data: { status: 'suspended' } },
      admin_unsuspend_account: { data: { status: 'active' } },
      admin_retire_account: { data: { status: 'retired' } },
      admin_reactivate_account: { data: { status: 'active' } },
      admin_delete_account: { data: { status: 'deleted' } },
      admin_set_account_role: { data: { role: 'admin', previous_role: null } },
      admin_set_account_type: { data: { account_type: 'creator', previous_type: 'collector', creator_pending: false, override: true } },
      admin_set_delete_window: { data: { delete_window_hours: 48 } },
      admin_audit_log_facets: { data: { actions: ['account_suspend'], entity_types: ['user'], actors: [] } },
    }),
  };
  tables = {
    account_settings: [{ id: true, delete_window_hours: 24, updated_at: '2026-10-25T00:00:00Z' }],
    audit_logs: [
      { log_id: 'l1', admin_id: ADMIN, action: 'account_suspend', entity_type: 'user', entity_id: TARGET, created_at: '2026-10-25T01:00:00Z' },
      { log_id: 'l2', admin_id: ADMIN, action: 'tag_search', entity_type: 'admin_search', entity_id: ADMIN, created_at: '2026-10-25T02:00:00Z' },
    ],
  };
});

describe('permission gates', () => {
  type Case = [string, 'get' | 'post' | 'put', string, Row | undefined];
  const routes: Record<string, Case> = {
    search: ['view_users', 'get', '/admin/users?q=test', undefined],
    detail: ['view_users', 'get', `/admin/users/${TARGET}`, undefined],
    tokens: ['manage_nfc', 'get', `/admin/users/${TARGET}/tokens`, undefined],
    suspend: ['manage_users', 'post', `/admin/users/${TARGET}/suspend`, { hours: 24, reason: REASON }],
    unsuspend: ['manage_users', 'post', `/admin/users/${TARGET}/unsuspend`, { reason: REASON }],
    retire: ['manage_users', 'post', `/admin/users/${TARGET}/retire`, { reason: REASON }],
    reactivate: ['manage_users', 'post', `/admin/users/${TARGET}/reactivate`, { reason: REASON }],
    delete: ['manage_admins', 'post', `/admin/users/${TARGET}/delete`, { confirm: 'a', reason: REASON }],
    role: ['manage_admins', 'put', `/admin/users/${TARGET}/role`, { role: 'admin', reason: REASON }],
    type: ['manage_creator_ids', 'put', `/admin/users/${TARGET}/type`, { type: 'creator', override: true, reason: REASON }],
    window: ['manage_admins', 'put', '/admin/account-settings', { hours: 48, reason: REASON }],
    audit: ['view_audit_logs', 'get', '/admin/audit-logs', undefined],
  };

  const expected: Record<string, Record<string, number>> = {
    super_admin: { search: 200, detail: 200, tokens: 200, suspend: 200, unsuspend: 200, retire: 200, reactivate: 200, delete: 200, role: 200, type: 200, window: 200, audit: 200 },
    admin:       { search: 200, detail: 200, tokens: 200, suspend: 200, unsuspend: 200, retire: 200, reactivate: 200, delete: 403, role: 403, type: 200, window: 403, audit: 200 },
    support:     { search: 200, detail: 200, tokens: 403, suspend: 403, unsuspend: 403, retire: 403, reactivate: 403, delete: 403, role: 403, type: 403, window: 403, audit: 403 },
  };

  for (const [role, byRoute] of Object.entries(expected)) {
    for (const [name, status] of Object.entries(byRoute)) {
      it(`${role} ${name} → ${status}`, async () => {
        const [, method, path, body] = routes[name];
        const app = await appWith(role);
        const res = await request(app)[method](path).send(body ?? {});
        expect(res.status).toBe(status);
        if (status === 403) {
          expect(rpcCalls).toHaveLength(0);
          // A 403 never echoes what the admin holds.
          expect(JSON.stringify(res.body)).not.toMatch(/view_users|manage_|have/);
        }
      });
    }
  }

  it('no admin on the request → 401, nothing runs', async () => {
    const app = await appWith(null);
    const res = await request(app).post(`/admin/users/${TARGET}/suspend`).send({ hours: 1, reason: REASON });
    expect(res.status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe('validation', () => {
  it.each([
    ['suspend 0 hours', 'post', `/admin/users/${TARGET}/suspend`, { hours: 0, reason: REASON }],
    ['suspend over a year', 'post', `/admin/users/${TARGET}/suspend`, { hours: 9000, reason: REASON }],
    ['short reason', 'post', `/admin/users/${TARGET}/retire`, { reason: 'too short' }],
    ['non-grantable role', 'put', `/admin/users/${TARGET}/role`, { role: 'moderator', reason: REASON }],
    ['unknown field', 'post', `/admin/users/${TARGET}/retire`, { reason: REASON, force: true }],
    ['bad account id', 'get', '/admin/users/not-a-uuid', undefined],
    ['window below 1 h', 'put', '/admin/account-settings', { hours: 0, reason: REASON }],
    ['bad audit target', 'get', '/admin/audit-logs?target=abc', undefined],
  ] as const)('%s → 400', async (_name, method, path, body) => {
    const app = await appWith('super_admin');
    const res = await request(app)[method](path).send(body ?? {});
    expect(res.status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  it('role null revokes and is passed through', async () => {
    const app = await appWith('super_admin');
    const res = await request(app).put(`/admin/users/${TARGET}/role`).send({ role: null, reason: REASON });
    expect(res.status).toBe(200);
    expect(rpcCalls[0]).toEqual({ fn: 'admin_set_account_role', args: { p_admin: ADMIN, p_target: TARGET, p_role: null, p_reason: REASON } });
  });

  it('search passes paging as limit/offset', async () => {
    const app = await appWith('support');
    const res = await request(app).get('/admin/users?q=a%25b&status=suspended&page=3&limit=10');
    expect(res.status).toBe(200);
    expect(rpcCalls[0].args).toEqual({ p_admin: ADMIN, p_query: 'a%b', p_status: 'suspended', p_limit: 10, p_offset: 20, p_type: 'all' });
    expect(res.body.data.pagination).toEqual({ page: 3, limit: 10, total: 1, pages: 1 });
  });

  it('type change passes type, override and reason through', async () => {
    const app = await appWith('admin');
    const res = await request(app).put(`/admin/users/${TARGET}/type`).send({ type: 'creator', override: true, reason: REASON });
    expect(res.status).toBe(200);
    expect(rpcCalls[0]).toEqual({
      fn: 'admin_set_account_type',
      args: { p_admin: ADMIN, p_target: TARGET, p_type: 'creator', p_override: true, p_reason: REASON },
    });
  });

  it('type change: override defaults to false; collector + override and unknown types are refused before the database', async () => {
    const app = await appWith('super_admin');
    await request(app).put(`/admin/users/${TARGET}/type`).send({ type: 'creator', reason: REASON });
    expect(rpcCalls[0].args).toMatchObject({ p_override: false });
    rpcCalls = [];
    for (const body of [
      { type: 'collector', override: true, reason: REASON },
      { type: 'staff', reason: REASON },
      { type: 'creator', reason: 'short' },
    ]) {
      const res = await request(app).put(`/admin/users/${TARGET}/type`).send(body);
      expect(res.status).toBe(400);
    }
    expect(rpcCalls).toHaveLength(0);
  });

  it('search passes the account type filter', async () => {
    const app = await appWith('support');
    const res = await request(app).get('/admin/users?type=creator_pending');
    expect(res.status).toBe(200);
    expect(rpcCalls[0].args).toMatchObject({ p_type: 'creator_pending', p_status: 'all' });
  });

  it('search refuses an unknown account type before the database', async () => {
    const app = await appWith('support');
    const res = await request(app).get('/admin/users?type=staff');
    expect(res.status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe('database errors → safe API errors', () => {
  it.each([
    ['admin_forbidden: actor lacks manage_admins', 403, 'Your staff role cannot do this.'],
    ['cannot_act_on_self', 403, 'You cannot do this to your own account.'],
    ['account_not_found', 404, 'Account not found.'],
    ['already_retired', 409, 'This account is already retired.'],
    ['confirm_mismatch', 400, 'That does not match the part of the email before the @.'],
    ['some_new_internal_error: secret detail', 500, 'That did not work. Nothing was changed. Try again.'],
  ])('%s → %i', async (dbError, status, message) => {
    hooks.rpc = rpcReturning({ admin_retire_account: { error: dbError } });
    const app = await appWith('super_admin');
    const res = await request(app).post(`/admin/users/${TARGET}/retire`).send({ reason: REASON });
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({ success: false, data: null, error: message });
    expect(JSON.stringify(res.body)).not.toContain('secret detail');
  });

  it('delete_blocked lists each blocker in plain words', async () => {
    hooks.rpc = rpcReturning({ admin_delete_account: { error: 'delete_blocked: delete_window_open,owns_tokens,audit_actor' } });
    const app = await appWith('super_admin');
    const res = await request(app).post(`/admin/users/${TARGET}/delete`).send({ confirm: 'test', reason: REASON });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(
      'This account cannot be deleted yet. The waiting time after retiring has not passed yet. The account still owns tokens. Transfer them to another account first. The account took staff actions, so it stays retired.',
    );
  });
});

describe('reads', () => {
  it('GET /me returns role and sorted permissions only', async () => {
    const app = await appWith('admin');
    const res = await request(app).get('/admin/me');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      adminId: ADMIN, email: 'admin@example.com', role: 'admin', permissions: [...permissionsFor('admin')].sort(),
      approvalRequired: false,
    });
  });

  it('audit log filters by target', async () => {
    const app = await appWith('super_admin');
    const res = await request(app).get(`/admin/audit-logs?target=${TARGET}`);
    expect(res.status).toBe(200);
    expect(res.body.data.logs.map((l: Row) => l.log_id)).toEqual(['l1']);
    expect(res.body.data.pagination.total).toBe(1);
  });

  it('audit log filters by time range (from inclusive, to exclusive)', async () => {
    const app = await appWith('super_admin');
    const res = await request(app).get('/admin/audit-logs?from=2026-10-25T01:30:00Z&to=2026-10-25T03:00:00Z');
    expect(res.status).toBe(200);
    expect(res.body.data.logs.map((l: Row) => l.log_id)).toEqual(['l2']);
    const edge = await request(app).get('/admin/audit-logs?from=2026-10-25T01:00:00Z&to=2026-10-25T02:00:00Z');
    expect(edge.body.data.logs.map((l: Row) => l.log_id)).toEqual(['l1']);
  });

  it('audit log refuses a range that ends before it starts, or a date without an offset', async () => {
    const app = await appWith('super_admin');
    expect((await request(app).get('/admin/audit-logs?from=2026-10-25T03:00:00Z&to=2026-10-25T01:00:00Z')).status).toBe(400);
    expect((await request(app).get('/admin/audit-logs?from=yesterday')).status).toBe(400);
  });

  it('audit facets come from the database function', async () => {
    const app = await appWith('super_admin');
    const res = await request(app).get('/admin/audit-logs/facets');
    expect(res.status).toBe(200);
    expect(res.body.data.actions).toEqual(['account_suspend']);
  });

  it('account settings returns the delete window', async () => {
    const app = await appWith('support');
    const res = await request(app).get('/admin/account-settings');
    expect(res.body.data).toMatchObject({ deleteWindowHours: 24 });
  });
});

describe('requireAuth refuses inactive accounts (AC 2)', () => {
  const run = async (status: string | null, rpcError = false) => {
    vi.doMock('../lib/supabase', () => ({ verifyAuthToken: async () => ({ id: TARGET }) }));
    hooks.rpc = (fn: string, args: Row) => {
      rpcCalls.push({ fn, args });
      return rpcError ? { data: null, error: { message: 'down' } } : { data: status, error: null };
    };
    const { requireAuth } = await import('../middleware/auth');
    const app = express();
    app.get('/x', requireAuth as never, (_req, res) => { res.json({ ok: true }); });
    return request(app).get('/x').set('Authorization', 'Bearer t');
  };

  it('active → passes; asks for this account by name', async () => {
    expect((await run('active')).status).toBe(200);
    expect(rpcCalls).toEqual([{ fn: 'account_status_of', args: { p_user: TARGET } }]);
  });
  it('suspended → 403 ACCOUNT_INACTIVE', async () => {
    const res = await run('suspended');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_INACTIVE');
  });
  it('retired → 403', async () => {
    expect((await run('retired')).status).toBe(403);
  });
  it('no profile row (null) → treated as active', async () => {
    expect((await run(null)).status).toBe(200);
  });
  it('status unreadable → 503 (fails closed)', async () => {
    expect((await run(null, true)).status).toBe(503);
  });
});
