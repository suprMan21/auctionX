import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { type NextFunction, type Request, type Response } from 'express';
import { permissionsFor } from './helpers/adminRoles';

/**
 * Creator ID checks access (Boss 2026-10-26):
 *   - open the list and a record: view_creator_ids (super_admin, admin, support)
 *   - change a status: manage_creator_ids (super_admin, admin), never support
 *   - every record view is written to the audit log BEFORE the data is read,
 *     and nothing is shown if that write fails
 */

const USER = '22222222-2222-4222-8222-222222222222';

type Insert = { table: string; row: Record<string, unknown> };
let inserts: Insert[];
let reads: string[];
let auditFails: boolean;

const chain = (table: string) => {
  const result = { data: table === 'users' ? { id: USER, email: 'creator@example.com' } : [], error: null };
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'range', 'in', 'or', 'not', 'ilike']) q[m] = () => q;
  q.single = async () => result;
  q.maybeSingle = async () => result;
  q.then = (ok: (v: unknown) => void) => ok(result);
  return q;
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        return { error: table === 'audit_logs' && auditFails ? { message: 'down' } : null };
      },
      select: (...args: unknown[]) => {
        reads.push(table);
        return (chain(table).select as (...a: unknown[]) => unknown)(...args);
      },
    }),
  }),
}));

const appAs = async (role: string, stubControllers = true) => {
  vi.resetModules();
  if (stubControllers) {
    vi.doMock('../controllers/adminYotiVerificationController', () => ({
      listVerifications: (_req: Request, res: Response) => res.json({ ok: 'list' }),
      getVerificationDetail: (_req: Request, res: Response) => res.json({ ok: 'detail' }),
      overrideVerification: (_req: Request, res: Response) => res.json({ ok: 'override' }),
    }));
  } else {
    vi.doUnmock('../controllers/adminYotiVerificationController');
  }
  vi.doMock('../middleware/auditLog', () => ({ auditLog: () => (_req: Request, _res: Response, next: NextFunction) => next() }));
  const { default: router } = await import('../routes/admin/verifications');
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { admin: unknown }).admin = {
      admin_id: 'admin-1', email: 'staff@example.com', role, permissions: permissionsFor(role), brand: 'both', session_version: 0,
    };
    next();
  });
  app.use('/v', router);
  return app;
};

beforeEach(() => {
  inserts = [];
  reads = [];
  auditFails = false;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
});

describe('creator ID checks: who may do what', () => {
  const cases: Array<[string, number, number, number]> = [
    // role, list, detail, change status
    ['super_admin', 200, 200, 200],
    ['admin', 200, 200, 200],
    ['support', 200, 200, 403],
    ['moderator', 403, 403, 403],
  ];
  it.each(cases)('%s: list %i, open %i, change %i', async (role, list, detail, change) => {
    const app = await appAs(role);
    expect((await request(app).get('/v')).status).toBe(list);
    expect((await request(app).get(`/v/${USER}`)).status).toBe(detail);
    expect((await request(app).post(`/v/${USER}/override`).send({ new_status: 'VERIFIED', reason: 'Checked the ID by hand' })).status).toBe(change);
  });
});

describe('opening a creator ID record is audited first', () => {
  it('writes creator_id_view for this account before reading anything', async () => {
    const app = await appAs('support', false);
    const res = await request(app).get(`/v/${USER}`);
    expect(res.status).toBe(200);
    expect(inserts[0]).toMatchObject({
      table: 'audit_logs',
      row: { action: 'creator_id_view', entity_type: 'user', entity_id: USER, admin_id: 'admin-1' },
    });
    expect(reads.length).toBeGreaterThan(0);
  });

  it('if the audit row cannot be written, nothing is read or shown', async () => {
    auditFails = true;
    const app = await appAs('support', false);
    const res = await request(app).get(`/v/${USER}`);
    expect(res.status).toBe(503);
    expect(reads).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain('creator@example.com');
  });

  it('a malformed account ID is refused without an audit row', async () => {
    const app = await appAs('support', false);
    expect((await request(app).get('/v/not-a-uuid')).status).toBe(400);
    expect(inserts).toEqual([]);
  });
});
