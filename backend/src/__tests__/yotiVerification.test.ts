/**
 * Yoti integration vitest suite (S22). Mock-only — no live network.
 *
 * Covers (per brief §7):
 *  - happy path: session.completed + completed_verified → VERIFIED + age_verified
 *  - rejection path: session.completed + completed_rejected → REJECTED, captures reason
 *  - idempotency: duplicate (session_id, event_type) yields one DB write
 *  - HMAC failure: invalid signature → 401, no DB write
 *  - startYotiSession refuses already-VERIFIED users with VERIFICATION_ALREADY_VERIFIED
 *  - flag-off path: /start returns 503 + YOTI_NOT_AVAILABLE when FEATURE_YOTI_ENABLED=false
 *  - LiveYotiClient methods throw NotImplementedError
 *  - admin override writes seller_verification_reviews row + flips user status
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// ── Supabase mock harness (mirror of admin auctions test pattern) ─────────────
type Resolver = () => Promise<{ data: unknown; error: unknown }> | { data: unknown; error: unknown };

const responses = new Map<string, Resolver[]>();
const updatePayloads: Record<string, Record<string, unknown>[]> = {};
const insertPayloads: Record<string, Record<string, unknown>[]> = {};

const enqueue = (table: string, resolver: Resolver) => {
  const list = responses.get(table) ?? [];
  list.push(resolver);
  responses.set(table, list);
};

const nextResolver = (table: string): Resolver => {
  const list = responses.get(table) ?? [];
  const r = list.shift();
  responses.set(table, list);
  if (!r) throw new Error(`No queued response for table=${table}`);
  return r;
};

const buildChain = (table: string) => {
  const chain: any = {};
  const passthrough = (...rest: any[]) => chain;
  const captureUpdate = (payload: any) => {
    if (payload && typeof payload === 'object') {
      (updatePayloads[table] = updatePayloads[table] ?? []).push(payload);
    }
    return chain;
  };
  const captureInsert = (payload: any) => {
    if (payload && typeof payload === 'object') {
      (insertPayloads[table] = insertPayloads[table] ?? []).push(payload);
    }
    return chain;
  };
  chain.select = passthrough;
  chain.insert = captureInsert;
  chain.update = captureUpdate;
  chain.delete = passthrough;
  chain.upsert = passthrough;
  chain.eq = passthrough;
  chain.in = passthrough;
  chain.or = passthrough;
  chain.ilike = passthrough;
  chain.not = passthrough;
  chain.order = passthrough;
  chain.range = passthrough;
  chain.single = async () => nextResolver(table)();
  chain.limit = async () => nextResolver(table)();
  chain.maybeSingle = async () => nextResolver(table)();
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    try {
      const v = nextResolver(table)();
      return Promise.resolve(v).then(resolve, reject);
    } catch (e) {
      return Promise.reject(e).catch(reject ?? ((err) => { throw err; }));
    }
  };
  return chain;
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => buildChain(table) }),
}));

vi.mock('../lib/logger', () => ({
  log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  withLogContext: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

process.env['SUPABASE_URL'] = 'http://localhost:54321';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key';
process.env['NODE_ENV'] = 'test';

// Import AFTER mocks are installed.
import {
  startYotiSession,
  getMyVerificationStatus,
  applyYotiWebhookEnvelope,
  yotiWebhook,
} from '../controllers/yotiVerificationController';
import { overrideVerification } from '../controllers/adminYotiVerificationController';
import {
  LiveYotiClient,
  MockYotiClient,
  NotImplementedError,
  resetYotiClientForTests,
  YOTI_AGE_THRESHOLD,
  type YotiWebhookEnvelope,
} from '../lib/yoti';

function makeRes() {
  const res: Partial<Response> & { _status?: number; _json?: any } = {};
  res.status = vi.fn(function (this: Response, code: number) {
    (res as any)._status = code;
    return this;
  }) as Response['status'];
  res.json = vi.fn(function (this: Response, body: any) {
    (res as any)._json = body;
    return this;
  }) as Response['json'];
  return res as Response & { _status?: number; _json?: any };
}

const makeReq = (overrides: Partial<Request> = {}) =>
  ({
    requestId: 'test-req-id',
    path: '/test',
    params: {},
    body: {},
    headers: {},
    user: { id: 'user-1' },
    ...overrides,
  } as unknown as Request);

beforeEach(() => {
  responses.clear();
  for (const k of Object.keys(updatePayloads)) delete updatePayloads[k];
  for (const k of Object.keys(insertPayloads)) delete insertPayloads[k];
  resetYotiClientForTests();
  delete process.env.FEATURE_YOTI_ENABLED;
});

// ── §5.0 LiveYotiClient guard ─────────────────────────────────────────────────
describe('LiveYotiClient', () => {
  it('throws NotImplementedError from createSession', async () => {
    const c = new LiveYotiClient();
    await expect(
      c.createSession({ userId: 'u', purpose: 'seller_kyc', returnUrl: 'http://x' }),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('throws NotImplementedError from getSession', async () => {
    const c = new LiveYotiClient();
    await expect(c.getSession('s')).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('throws NotImplementedError from verifyWebhookSignature', () => {
    const c = new LiveYotiClient();
    expect(() => c.verifyWebhookSignature(Buffer.from('{}'), 'sig')).toThrow(NotImplementedError);
  });
});

// ── startYotiSession ──────────────────────────────────────────────────────────
describe('startYotiSession', () => {
  it('returns 503 + YOTI_NOT_AVAILABLE when FEATURE_YOTI_ENABLED is false', async () => {
    delete process.env.FEATURE_YOTI_ENABLED;
    const req = makeReq({ body: { purpose: 'seller_kyc' } }) as Request & { requestId: string };
    const res = makeRes();
    await startYotiSession(req as any, res);
    expect(res._status).toBe(503);
    expect(res._json.error.code).toBe('YOTI_NOT_AVAILABLE');
  });

  it('rejects when user is already VERIFIED with VERIFICATION_ALREADY_VERIFIED', async () => {
    process.env.FEATURE_YOTI_ENABLED = 'true';
    enqueue('users', () => ({
      data: { id: 'user-1', seller_verification_status: 'VERIFIED', age_verified: true },
      error: null,
    }));
    const req = makeReq({ body: { purpose: 'seller_kyc' } }) as Request & { requestId: string };
    const res = makeRes();
    await startYotiSession(req as any, res);
    expect(res._status).toBe(412);
    expect(res._json.error.code).toBe('VERIFICATION_ALREADY_VERIFIED');
  });

  it('creates a session and returns session_url for NONE users (flag on)', async () => {
    process.env.FEATURE_YOTI_ENABLED = 'true';
    // user lookup
    enqueue('users', () => ({
      data: { id: 'user-1', seller_verification_status: 'NONE', age_verified: false },
      error: null,
    }));
    // yoti_sessions insert
    enqueue('yoti_sessions', () => ({ data: null, error: null }));
    // users update
    enqueue('users', () => ({ data: null, error: null }));

    const req = makeReq({ body: { purpose: 'seller_kyc' } }) as Request & { requestId: string };
    const res = makeRes();
    await startYotiSession(req as any, res);

    expect(res._status).toBeUndefined();
    expect(res._json.success).toBe(true);
    expect(res._json.data.session_url).toContain('mock.yoti.test/sessions/');
    expect(res._json.data.session_id).toMatch(/^mock_sess_/);
    expect(insertPayloads.yoti_sessions?.[0]).toMatchObject({
      user_id: 'user-1',
      purpose: 'seller_kyc',
      status: 'created',
    });
    expect(updatePayloads.users?.[0]).toMatchObject({
      seller_verification_status: 'PENDING',
    });
  });

  it('returns 400 on invalid purpose', async () => {
    process.env.FEATURE_YOTI_ENABLED = 'true';
    const req = makeReq({ body: { purpose: 'bogus' } }) as Request & { requestId: string };
    const res = makeRes();
    await startYotiSession(req as any, res);
    expect(res._status).toBe(400);
    expect(res._json.error.code).toBe('invalid_argument');
  });
});

// ── getMyVerificationStatus ───────────────────────────────────────────────────
describe('getMyVerificationStatus', () => {
  it('returns user state + last session row', async () => {
    enqueue('users', () => ({
      data: {
        id: 'user-1',
        seller_verification_status: 'PENDING',
        seller_verification_submitted_at: '2026-05-30T00:00:00Z',
        seller_verification_reviewed_at: null,
        seller_verification_rejection_reason: null,
        age_verified: false,
        age_verified_at: null,
        age_verification_provider: null,
        yoti_session_id: 'mock_sess_abc',
      },
      error: null,
    }));
    enqueue('yoti_sessions', () => ({
      data: [
        { id: 's-1', yoti_session_id: 'mock_sess_abc', purpose: 'seller_kyc', status: 'created' },
      ],
      error: null,
    }));

    const req = makeReq() as Request & { requestId: string };
    const res = makeRes();
    await getMyVerificationStatus(req as any, res);
    if (!res._json.success) throw new Error(`status diag: ${JSON.stringify(res._json)}`);
    expect(res._json.data.seller_verification_status).toBe('PENDING');
    expect(res._json.data.last_session).toMatchObject({ status: 'created' });
  });
});

// ── State machine via applyYotiWebhookEnvelope ────────────────────────────────
describe('applyYotiWebhookEnvelope — happy path', () => {
  it('transitions PENDING → VERIFIED and sets age_verified when age_estimate >= 18', async () => {
    enqueue('yoti_sessions', () => ({
      data: { id: 's-1', user_id: 'user-1', last_event_type: 'session.created', status: 'created', purpose: 'both' },
      error: null,
    }));
    enqueue('yoti_sessions', () => ({ data: null, error: null })); // update
    enqueue('users', () => ({ data: null, error: null })); // update

    const payload: YotiWebhookEnvelope = {
      event_type: 'session.completed',
      session_id: 'mock_sess_abc',
      outcome: 'completed_verified',
      age_estimate: 22,
    };
    const result = await applyYotiWebhookEnvelope(payload);
    expect(result.applied).toBe(true);
    expect(updatePayloads.yoti_sessions?.[0]).toMatchObject({
      status: 'completed',
      last_event_type: 'session.completed',
    });
    expect(updatePayloads.users?.[0]).toMatchObject({
      seller_verification_status: 'VERIFIED',
      age_verified: true,
      age_verification_provider: 'yoti',
      yoti_age_estimate: 22,
    });
  });

  it('does NOT set age_verified when age_estimate < threshold', async () => {
    enqueue('yoti_sessions', () => ({
      data: { id: 's-1', user_id: 'user-1', last_event_type: 'session.created', status: 'created', purpose: 'both' },
      error: null,
    }));
    enqueue('yoti_sessions', () => ({ data: null, error: null }));
    enqueue('users', () => ({ data: null, error: null }));

    const payload: YotiWebhookEnvelope = {
      event_type: 'session.completed',
      session_id: 'mock_sess_abc',
      outcome: 'completed_verified',
      age_estimate: YOTI_AGE_THRESHOLD - 1,
    };
    await applyYotiWebhookEnvelope(payload);
    const userPayload = updatePayloads.users?.[0] ?? {};
    expect(userPayload.seller_verification_status).toBe('VERIFIED');
    expect(userPayload.age_verified).toBeUndefined();
    expect(userPayload.yoti_age_estimate).toBe(YOTI_AGE_THRESHOLD - 1);
  });
});

describe('applyYotiWebhookEnvelope — rejection path', () => {
  it('transitions PENDING → REJECTED and captures rejection_reason', async () => {
    enqueue('yoti_sessions', () => ({
      data: { id: 's-1', user_id: 'user-1', last_event_type: 'session.in_progress', status: 'in_progress', purpose: 'seller_kyc' },
      error: null,
    }));
    enqueue('yoti_sessions', () => ({ data: null, error: null }));
    enqueue('users', () => ({ data: null, error: null }));

    const payload: YotiWebhookEnvelope = {
      event_type: 'session.completed',
      session_id: 'mock_sess_abc',
      outcome: 'completed_rejected',
      rejection_reason: 'document_unreadable',
    };
    const result = await applyYotiWebhookEnvelope(payload);
    expect(result.applied).toBe(true);
    expect(updatePayloads.users?.[0]).toMatchObject({
      seller_verification_status: 'REJECTED',
      seller_verification_rejection_reason: 'document_unreadable',
    });
  });
});

describe('applyYotiWebhookEnvelope — idempotency', () => {
  it('no-ops when the same event_type is already the most-recent last_event_type', async () => {
    enqueue('yoti_sessions', () => ({
      data: { id: 's-1', user_id: 'user-1', last_event_type: 'session.completed', status: 'completed', purpose: 'seller_kyc' },
      error: null,
    }));
    // no further queued responses — the duplicate-guard MUST short-circuit
    // before any update/insert is attempted.
    const payload: YotiWebhookEnvelope = {
      event_type: 'session.completed',
      session_id: 'mock_sess_abc',
      outcome: 'completed_verified',
    };
    const result = await applyYotiWebhookEnvelope(payload);
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('duplicate_event');
    expect(updatePayloads.yoti_sessions).toBeUndefined();
    expect(updatePayloads.users).toBeUndefined();
  });

  it('returns no_matching_session when session_id is unknown', async () => {
    enqueue('yoti_sessions', () => ({ data: null, error: null })); // maybeSingle

    const payload: YotiWebhookEnvelope = {
      event_type: 'session.completed',
      session_id: 'unknown',
      outcome: 'completed_verified',
    };
    const result = await applyYotiWebhookEnvelope(payload);
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('no_matching_session');
  });
});

// ── HMAC failure (route-level) ────────────────────────────────────────────────
describe('yotiWebhook — HMAC verification', () => {
  it('returns 401 + YOTI_WEBHOOK_SIGNATURE_INVALID on bad signature', async () => {
    const body = Buffer.from(JSON.stringify({ event_type: 'session.completed', session_id: 'x' }));
    const req = makeReq({
      body,
      headers: { 'x-yoti-hmac': 'wrong-signature' },
    }) as unknown as Request;
    const res = makeRes();
    await yotiWebhook(req as any, res);
    expect(res._status).toBe(401);
    expect(res._json.error.code).toBe('YOTI_WEBHOOK_SIGNATURE_INVALID');
    // No DB queries should have been made.
    expect(insertPayloads.yoti_sessions).toBeUndefined();
    expect(updatePayloads.yoti_sessions).toBeUndefined();
  });

  it('accepts a correctly-signed payload and applies the state machine', async () => {
    const envelope: YotiWebhookEnvelope = {
      event_type: 'session.completed',
      session_id: 'mock_sess_signed',
      outcome: 'completed_verified',
      age_estimate: 30,
    };
    const body = Buffer.from(JSON.stringify(envelope));
    const signature = MockYotiClient.signPayload(body);

    enqueue('yoti_sessions', () => ({
      data: { id: 's-1', user_id: 'user-1', last_event_type: 'session.created', status: 'created', purpose: 'both' },
      error: null,
    }));
    enqueue('yoti_sessions', () => ({ data: null, error: null }));
    enqueue('users', () => ({ data: null, error: null }));

    const req = makeReq({
      body,
      headers: { 'x-yoti-hmac': signature },
    }) as unknown as Request;
    const res = makeRes();
    await yotiWebhook(req as any, res);
    expect(res._status).toBeUndefined();
    expect(res._json.success).toBe(true);
    expect(res._json.data.applied).toBe(true);
  });

  it('rejects 400 when raw body is missing', async () => {
    const req = makeReq({ body: undefined as any, headers: { 'x-yoti-hmac': 'whatever' } }) as unknown as Request;
    const res = makeRes();
    await yotiWebhook(req as any, res);
    expect(res._status).toBe(400);
  });
});

// ── admin override ────────────────────────────────────────────────────────────
describe('overrideVerification (admin)', () => {
  it('writes seller_verification_reviews row + flips user status', async () => {
    // user lookup
    enqueue('users', () => ({
      data: { id: 'user-1', seller_verification_status: 'REJECTED' },
      error: null,
    }));
    // users update
    enqueue('users', () => ({ data: null, error: null }));
    // seller_verification_reviews insert
    enqueue('seller_verification_reviews', () => ({ data: null, error: null }));

    const req = makeReq({
      params: { userId: 'user-1' },
      body: { new_status: 'VERIFIED', reason: 'Manually verified after support ticket' },
      // admin context is set by middleware; stub it here.
      ...({ admin: { admin_id: 'admin-1', email: 'a@x', role: 'admin', permissions: ['review_sellers'], brand: 'auctionx', session_version: 1 } } as any),
    }) as unknown as Request & { admin: any };
    const res = makeRes();
    await overrideVerification(req as any, res);
    expect(res._json.success).toBe(true);
    expect(updatePayloads.users?.[0]).toMatchObject({ seller_verification_status: 'VERIFIED' });
    expect(insertPayloads.seller_verification_reviews?.[0]).toMatchObject({
      user_id: 'user-1',
      admin_id: 'admin-1',
      action: 'override',
      previous_status: 'REJECTED',
      new_status: 'VERIFIED',
      notes: 'Manually verified after support ticket',
    });
  });

  it('rejects 412 when new_status equals previous_status', async () => {
    enqueue('users', () => ({ data: { id: 'user-1', seller_verification_status: 'VERIFIED' }, error: null }));
    const req = makeReq({
      params: { userId: 'user-1' },
      body: { new_status: 'VERIFIED', reason: 'Redundant override attempt' },
      ...({ admin: { admin_id: 'admin-1', email: 'a@x', role: 'admin', permissions: ['review_sellers'], brand: 'auctionx', session_version: 1 } } as any),
    }) as unknown as Request & { admin: any };
    const res = makeRes();
    await overrideVerification(req as any, res);
    expect(res._status).toBe(412);
    expect(res._json.error.code).toBe('failed_precondition');
  });

  it('rejects 400 when reason < 10 chars', async () => {
    const req = makeReq({
      params: { userId: 'user-1' },
      body: { new_status: 'VERIFIED', reason: 'short' },
      ...({ admin: { admin_id: 'admin-1', email: 'a@x', role: 'admin', permissions: ['review_sellers'], brand: 'auctionx', session_version: 1 } } as any),
    }) as unknown as Request & { admin: any };
    const res = makeRes();
    await overrideVerification(req as any, res);
    expect(res._status).toBe(400);
  });
});
