import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express, { type NextFunction, type Request, type Response } from 'express';
import { bearerWith, createMfaFakeState, createMfaStoreFake, type MfaFakeState } from './helpers/mfaStoreFake';
import { permissionsFor } from './helpers/adminRoles';

/**
 * S-2FA Ph1 — the gates are on the REAL routes, in front of the controllers.
 *
 * Every request here must be refused by a gate before any controller runs:
 * the Supabase mock throws on any table access, so reaching a controller would
 * fail the test with a 500 instead of the expected 403.
 */

const USER = '11111111-1111-4111-8111-111111111111';
const SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TAG = '99999999-9999-4999-8999-999999999999';
let mfaState: MfaFakeState;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) => {
        const sub = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).sub;
        return { data: { user: { id: sub, email: 'user@example.com' } }, error: null };
      },
    },
    rpc: async (fn: string) => (fn === 'account_status_of' ? { data: 'active', error: null } : { data: null, error: { message: fn } }),
    from: (table: string) => {
      throw new Error(`controller reached (table ${table})`);
    },
    storage: { from: () => ({}) },
  }),
}));

const loadApp = async () => {
  vi.resetModules();
  const { __setMfaStore } = await import('../lib/mfa/store');
  __setMfaStore(createMfaStoreFake(mfaState));
  const { createApp } = await import('../app');
  return createApp();
};

const AUTH = bearerWith({ sub: USER, session_id: SESSION });

const verified = () =>
  mfaState.sessions.set(SESSION, {
    session_id: SESSION, user_id: USER, method: 'passkey', expires_at: new Date(Date.now() + 60_000).toISOString(),
  });

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  mfaState = createMfaFakeState();
});

afterEach(() => {
  delete process.env.FEATURE_REQUIRE_2FA;
  delete process.env.FEATURE_REQUIRE_STEP_UP;
});

describe('second factor required (FEATURE_REQUIRE_2FA)', () => {
  it.each([
    ['post', '/api/v1/nfc/release', { tagId: TAG, confirm: true, confirmPhrase: 'RELEASE' }],
    ['post', '/api/v1/nfc/transfer/initiate', {}],
    ['post', `/api/v1/nfc/transfer/${TAG}/cancel`, {}],
    ['patch', `/api/v1/nfc/${TAG}/disclosure`, {}],
    ['post', '/api/v1/nfc/reissue-request', {}],
    ['post', '/api/v1/nfc/reissue-request/photo-url', {}],
    ['post', `/api/v1/nfc/reissue-requests/${TAG}/pay`, {}],
    ['post', `/api/v1/nfc/reissue-requests/${TAG}/cancel`, {}],
  ])('%s %s is refused without a second factor', async (method, path, body) => {
    process.env.FEATURE_REQUIRE_2FA = 'true';
    const app = await loadApp();
    const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](path)
      .set('Authorization', AUTH)
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('2fa_required');
  });
});

describe('step-up required (FEATURE_REQUIRE_STEP_UP)', () => {
  it('release: a verified session still needs a fresh passkey check', async () => {
    process.env.FEATURE_REQUIRE_2FA = 'true';
    process.env.FEATURE_REQUIRE_STEP_UP = 'true';
    verified();
    const app = await loadApp();
    const res = await request(app).post('/api/v1/nfc/release').set('Authorization', AUTH)
      .send({ tagId: TAG, confirm: true, confirmPhrase: 'RELEASE' });
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('step_up_required');
  });

  it('transfer completion needs a step-up for that transfer', async () => {
    process.env.FEATURE_REQUIRE_STEP_UP = 'true';
    const app = await loadApp();
    const res = await request(app).post(`/api/v1/nfc/transfer/${TAG}/complete`).set('Authorization', AUTH).send({});
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('step_up_required');
  });

  it('the MFA API itself is mounted', async () => {
    const app = await loadApp();
    const res = await request(app).get('/api/v1/auth/mfa/status');
    expect(res.status).toBe(401);
  });
});

describe('admin price changes', () => {
  const pricingApp = async () => {
    vi.resetModules();
    const { __setMfaStore } = await import('../lib/mfa/store');
    __setMfaStore(createMfaStoreFake(mfaState));
    const { default: pricing } = await import('../routes/admin/pricing');
    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as { admin: object }).admin = {
        admin_id: USER, email: 'admin@example.com', role: 'admin', permissions: permissionsFor('admin'), brand: 'both',
      };
      next();
    });
    app.use('/admin/pricing', pricing);
    return app;
  };

  it('setting or cancelling a price needs a step-up', async () => {
    process.env.FEATURE_REQUIRE_STEP_UP = 'true';
    const app = await pricingApp();
    const set = await request(app).post('/admin/pricing').set('Authorization', AUTH).send({});
    expect(set.status).toBe(403);
    expect(set.body.reason).toBe('step_up_required');
    const cancel = await request(app).post(`/admin/pricing/${TAG}/cancel`).set('Authorization', AUTH).send({});
    expect(cancel.status).toBe(403);
  });
});
