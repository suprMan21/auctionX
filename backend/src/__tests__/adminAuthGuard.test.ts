import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express, { type NextFunction, type Request, type Response } from 'express';

/**
 * S-ADMIN2 Ph1 — the admin guard itself (adminAccounts.test.ts stubs it out).
 *
 * Proven here:
 *   - verifyAdminAuth asks the database for the CALLER's status by name
 *     (account_status_of, p_user) and refuses suspended / retired admins (403),
 *     fails closed when the status is unreadable (503)
 *   - FEATURE_REQUIRE_ADMIN_2FA demands an aal2 token (ADMIN_2FA_REQUIRED)
 *   - destructive admin actions share one rate-limit bucket per admin, so the
 *     target id in the path does not give each account its own allowance
 *   - an audit-log page past the end is an empty page, not a 503
 */

const ADMIN = '44444444-4444-4444-8444-444444444444';

type RpcAnswer = { data: unknown; error: { message: string } | null };
let rpcCalls: Array<{ fn: string; args: unknown }>;
let statusAnswer: RpcAnswer;
/** When set, replaces from() (used by the audit-log test). */
let fromOverride: ((table: string) => unknown) | null = null;

const jwt = (claims: Record<string, unknown>) =>
  `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

/** Just enough of supabase-js for verifyAdminAuth and getAccountStatus. */
const fakeClient = () => {
  const adminRow = {
    admin_id: ADMIN, brand: 'both', is_active: true, session_version: 0,
    admin_roles: { role_name: 'admin', permissions: ['view_users', 'manage_users'] },
  };
  const chain = {
    select: () => chain,
    eq: () => chain,
    update: () => chain,
    single: async () => ({ data: adminRow, error: null }),
    then: (ok: (v: unknown) => void) => ok({ data: null, error: null }),
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: ADMIN, email: 'admin@example.com' } }, error: null }) },
    from: (table: string) => (fromOverride ? fromOverride(table) : chain),
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return statusAnswer;
    },
  };
};

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeClient() }));

const guardedApp = async () => {
  const { verifyAdminAuth } = await import('../middleware/adminAuth');
  const app = express();
  app.get('/x', verifyAdminAuth as never, (req: Request, res: Response) => {
    res.json({ admin: (req as unknown as { admin: { admin_id: string } }).admin.admin_id });
  });
  return app;
};

beforeEach(() => {
  vi.resetModules();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  rpcCalls = [];
  statusAnswer = { data: 'active', error: null };
  fromOverride = null;
});

afterEach(() => {
  delete process.env.FEATURE_REQUIRE_ADMIN_2FA;
});

describe('verifyAdminAuth account status (AC 2)', () => {
  it('active admin passes; status is asked for the caller by name', async () => {
    const res = await request(await guardedApp()).get('/x').set('Authorization', `Bearer ${jwt({ iat: 1 })}`);
    expect(res.status).toBe(200);
    expect(rpcCalls).toEqual([{ fn: 'account_status_of', args: { p_user: ADMIN } }]);
  });

  it.each(['suspended', 'retired'])('%s admin → 403 ACCOUNT_INACTIVE', async (status) => {
    statusAnswer = { data: status, error: null };
    const res = await request(await guardedApp()).get('/x').set('Authorization', `Bearer ${jwt({ iat: 1 })}`);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, code: 'ACCOUNT_INACTIVE' });
  });

  it('status unreadable → 503 (fails closed)', async () => {
    statusAnswer = { data: null, error: { message: 'down' } };
    const res = await request(await guardedApp()).get('/x').set('Authorization', `Bearer ${jwt({ iat: 1 })}`);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('UNAVAILABLE');
  });
});

describe('admin two-factor flag (AC 5)', () => {
  it('flag off: aal1 passes', async () => {
    const res = await request(await guardedApp()).get('/x').set('Authorization', `Bearer ${jwt({ aal: 'aal1' })}`);
    expect(res.status).toBe(200);
  });
  it('flag on: aal1 → 403 ADMIN_2FA_REQUIRED', async () => {
    process.env.FEATURE_REQUIRE_ADMIN_2FA = 'true';
    const res = await request(await guardedApp()).get('/x').set('Authorization', `Bearer ${jwt({ aal: 'aal1' })}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ADMIN_2FA_REQUIRED');
  });
  it('flag on: aal2 passes', async () => {
    process.env.FEATURE_REQUIRE_ADMIN_2FA = 'true';
    const res = await request(await guardedApp()).get('/x').set('Authorization', `Bearer ${jwt({ aal: 'aal2' })}`);
    expect(res.status).toBe(200);
  });
});

describe('destructive rate limit', () => {
  const limitedApp = async () => {
    const { adminRateLimit } = await import('../middleware/adminRateLimit');
    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as { admin: { admin_id: string } }).admin = { admin_id: ADMIN };
      next();
    });
    app.use(adminRateLimit);
    app.all('/{*rest}', (_req, res) => { res.json({ ok: true }); });
    return app;
  };

  it('retiring many different accounts shares one allowance', async () => {
    const app = await limitedApp();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      codes.push((await request(app).post(`/users/${id}/retire`)).status);
    }
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });

  it.each(['/users/x/reactivate', '/users/x/delete', '/users/x/role', '/account-settings'])(
    '%s counts as destructive', async (path) => {
      const app = await limitedApp();
      for (let i = 0; i < 10; i++) await request(app).put(path);
      expect((await request(app).put(path)).status).toBe(429);
    },
  );
});

describe('audit log page past the end', () => {
  it('PGRST103 → empty page with the real total', async () => {
    const queries: Array<{ head: boolean }> = [];
    const auditChain = (head: boolean) => {
      const q = {
        eq: () => q,
        order: () => q,
        range: async () => ({ data: null, error: { code: 'PGRST103', message: 'Requested range not satisfiable' }, count: null }),
        then: (ok: (v: unknown) => void) => ok({ data: null, error: null, count: 7 }),
      };
      queries.push({ head });
      return q;
    };
    fromOverride = () => ({ select: (_c: string, o: { head?: boolean }) => auditChain(Boolean(o?.head)) });
    const { listAuditLogs } = await import('../controllers/adminAccountsController');
    const { handle } = await import('../routes/tagManagement');
    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as { admin: { admin_id: string } }).admin = { admin_id: ADMIN };
      next();
    });
    app.get('/audit', handle(listAuditLogs as never));
    const res = await request(app).get('/audit?page=9');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ logs: [], pagination: { page: 9, total: 7, pages: 1 } });
    expect(queries.map((q) => q.head)).toEqual([false, true]);
  });
});
