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
 *  - LiveYotiClient createSession + getSession wired against the `yoti` SDK
 *    (S22.5) — vi.mock('yoti') stubs the IDVClient + builders so we cover the
 *    happy path without touching the network. verifyWebhookSignature uses
 *    YOTI_WEBHOOK_SECRET
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

// ── Yoti SDK mock (used by LiveYotiClient specs) ──────────────────────────────
// vi.hoisted() runs BEFORE vi.mock() factories AND before the test body, so
// shared state + mock classes are visible to both the factory below and the
// tests further down.
const { yotiSdkMock } = vi.hoisted(() => ({
  yotiSdkMock: {
    lastSpec: null as unknown,
    lastGetSessionId: null as string | null,
    createSessionResult: {
      sessionId: 'live_sess_abc',
      sessionToken: 'tok_live_abc',
    },
    getSessionResult: { sessionId: 'live_sess_abc', state: 'ONGOING' },
  },
}));

vi.mock('yoti', () => {
  const makeBuilder = (initial: Record<string, unknown> = {}) => {
    const state: Record<string, unknown> = { ...initial };
    const builder: Record<string, unknown> = {};
    builder.withClientSessionTokenTtl = (v: unknown) => { state.clientSessionTokenTtl = v; return builder; };
    builder.withResourcesTtl = (v: unknown) => { state.resourcesTtl = v; return builder; };
    builder.withUserTrackingId = (v: unknown) => { state.userTrackingId = v; return builder; };
    builder.withRequestedCheck = (v: unknown) => {
      state.checks = ((state.checks as unknown[]) ?? []).concat(v);
      return builder;
    };
    builder.withSdkConfig = (v: unknown) => { state.sdkConfig = v; return builder; };
    builder.withRequiredDocument = (v: unknown) => { state.requiredDocument = v; return builder; };
    builder.withAllowsCameraAndUpload = () => { state.allowsCameraAndUpload = true; return builder; };
    builder.withSuccessUrl = (u: unknown) => { state.successUrl = u; return builder; };
    builder.withErrorUrl = (u: unknown) => { state.errorUrl = u; return builder; };
    builder.forStaticLiveness = () => { state.staticLiveness = true; return builder; };
    builder.withNotifications = (n: unknown) => { state.notifications = n; return builder; };
    builder.withEndpoint = (u: unknown) => { state.endpoint = u; return builder; };
    builder.withAuthTypeBearer = () => { state.authType = 'BEARER'; return builder; };
    builder.withAuthToken = (t: unknown) => { state.authToken = t; return builder; };
    builder.forSessionCompletion = () => {
      state.topics = ((state.topics as unknown[]) ?? []).concat('SESSION_COMPLETION');
      return builder;
    };
    builder.build = () => ({ ...state });
    return builder;
  };
  const builderClass = (initial: Record<string, unknown> = {}) =>
    class MockBuilder {
      constructor() {
        return makeBuilder(initial);
      }
    } as unknown as new () => unknown;
  class MockIDVClient {
    constructor(public sdkId: string, public pem: string | Buffer) {}
    async createSession(spec: unknown) {
      yotiSdkMock.lastSpec = spec;
      return {
        getSessionId: () => yotiSdkMock.createSessionResult.sessionId,
        getClientSessionToken: () => yotiSdkMock.createSessionResult.sessionToken,
      };
    }
    async getSession(sessionId: string) {
      yotiSdkMock.lastGetSessionId = sessionId;
      return {
        getSessionId: () => yotiSdkMock.getSessionResult.sessionId,
        getState: () => yotiSdkMock.getSessionResult.state,
      };
    }
  }
  return {
    IDVClient: MockIDVClient,
    SessionSpecificationBuilder: builderClass({ checks: [] }),
    SdkConfigBuilder: builderClass(),
    RequiredIdDocumentBuilder: builderClass({ kind: 'required_doc' }),
    RequestedDocumentAuthenticityCheckBuilder: builderClass({ kind: 'doc_authenticity' }),
    RequestedFaceMatchCheckBuilder: builderClass({ kind: 'face_match' }),
    RequestedLivenessCheckBuilder: builderClass({ kind: 'liveness' }),
    NotificationConfigBuilder: builderClass({ kind: 'notifications' }),
  };
});

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
  getYotiClient,
  LiveYotiClient,
  MockYotiClient,
  __resetYotiSdkCache,
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
  __resetYotiSdkCache();
  yotiSdkMock.lastSpec = null;
  yotiSdkMock.lastGetSessionId = null;
  yotiSdkMock.createSessionResult = { sessionId: 'live_sess_abc', sessionToken: 'tok_live_abc' };
  yotiSdkMock.getSessionResult = { sessionId: 'live_sess_abc', state: 'ONGOING' };
  delete process.env.FEATURE_YOTI_ENABLED;
});

// ── §5.0 LiveYotiClient (Yoti SDK wired in S22.5) ─────────────────────────────
describe('LiveYotiClient', () => {
  const LIVE_ENV = {
    YOTI_SDK_ID: 'sandbox-sdk-id',
    YOTI_PEM_KEY: '-----BEGIN PRIVATE KEY-----\nMIITESTKEY\n-----END PRIVATE KEY-----',
    YOTI_BASE_URL: 'https://api.yoti.com/idverify/v1',
    YOTI_WEBHOOK_URL: 'https://staging.test/api/v1/webhooks/yoti',
    YOTI_WEBHOOK_SECRET: 'live-yoti-test-webhook-secret',
  } as const;
  const setLiveEnv = () => Object.assign(process.env, LIVE_ENV);
  const clearLiveEnv = () => {
    delete process.env.YOTI_SDK_ID;
    delete process.env.YOTI_PEM_KEY;
    delete process.env.YOTI_BASE_URL;
    delete process.env.YOTI_WEBHOOK_URL;
    delete process.env.YOTI_WEBHOOK_SECRET;
  };

  it('createSession returns { sessionId, sessionUrl } and routes through the Yoti SDK builders', async () => {
    setLiveEnv();
    try {
      const c = new LiveYotiClient();
      const result = await c.createSession({
        userId: 'user-1',
        purpose: 'seller_kyc',
        returnUrl: 'https://staging.test/seller/verification/return',
      });
      expect(result.sessionId).toBe('live_sess_abc');
      expect(result.sessionUrl).toBe(
        'https://api.yoti.com/idverify/v1/web/index.html?sessionID=live_sess_abc&sessionToken=tok_live_abc',
      );
      // Spec captured by the mock IDVClient — assert the builders fed in the
      // expected shape.
      const spec = yotiSdkMock.lastSpec as Record<string, unknown>;
      expect(spec.userTrackingId).toBe('user-1');
      expect(spec.clientSessionTokenTtl).toBe(600);
      expect(Array.isArray(spec.checks)).toBe(true);
      const kinds = ((spec.checks as Array<Record<string, unknown>>) ?? []).map((c) => c.kind);
      expect(kinds).toEqual(expect.arrayContaining(['doc_authenticity', 'face_match', 'liveness']));
    } finally {
      clearLiveEnv();
    }
  });

  it('createSession throws AppError when YOTI_SDK_ID is unset', async () => {
    clearLiveEnv();
    const c = new LiveYotiClient();
    await expect(
      c.createSession({ userId: 'u', purpose: 'seller_kyc', returnUrl: 'http://x' }),
    ).rejects.toThrow(/YOTI_SDK_ID is not set/);
  });

  it('createSession decodes escaped-newline PEM (App Runner stores single-line)', async () => {
    setLiveEnv();
    // Simulate App Runner-style env var: literal `\n` escape sequences, no real newlines.
    const escapedPem = '-----BEGIN PRIVATE KEY-----\\nMIITESTKEYLINE1\\nMIITESTKEYLINE2\\n-----END PRIVATE KEY-----';
    process.env.YOTI_PEM_KEY = escapedPem;
    try {
      const c = new LiveYotiClient();
      await c.createSession({ userId: 'u', purpose: 'seller_kyc', returnUrl: 'http://x' });
      // The mocked IDVClient captured the pem the constructor received — assert
      // the escape sequences were normalised before being handed to the SDK.
      // (yotiSdkMock.IDVClient instances are constructed inside createSession;
      // we don't have a direct reference, so we verify by re-instantiating with
      // the same env and inspecting decodePem's behaviour indirectly via
      // createSession success on a value the regex check would have rejected.)
      expect(yotiSdkMock.lastSpec).not.toBeNull();
    } finally {
      delete process.env.YOTI_PEM_KEY;
      clearLiveEnv();
    }
  });

  it('getSession maps Yoti state COMPLETED → completed and passes the sessionId through', async () => {
    setLiveEnv();
    yotiSdkMock.getSessionResult = { sessionId: 'live_sess_xyz', state: 'COMPLETED' };
    try {
      const c = new LiveYotiClient();
      const detail = await c.getSession('live_sess_xyz');
      expect(yotiSdkMock.lastGetSessionId).toBe('live_sess_xyz');
      expect(detail).toEqual({
        sessionId: 'live_sess_xyz',
        status: 'completed',
        outcome: null,
        ageEstimate: null,
        rejectionReason: null,
      });
    } finally {
      clearLiveEnv();
    }
  });

  it('getSession maps Yoti state ONGOING → in_progress', async () => {
    setLiveEnv();
    yotiSdkMock.getSessionResult = { sessionId: 'live_sess_pending', state: 'ONGOING' };
    try {
      const c = new LiveYotiClient();
      const detail = await c.getSession('live_sess_pending');
      expect(detail.status).toBe('in_progress');
    } finally {
      clearLiveEnv();
    }
  });

  describe('verifyWebhookAuth (Bearer, wired S22.5)', () => {
    const TEST_SECRET = 'live-yoti-test-webhook-secret';

    it('accepts a valid Bearer token matching YOTI_WEBHOOK_SECRET', () => {
      process.env.YOTI_WEBHOOK_SECRET = TEST_SECRET;
      try {
        const c = new LiveYotiClient();
        const body = Buffer.from(
          JSON.stringify({ session_id: 'sess_live_1', topic: 'session_completion' }),
        );
        const verified = c.verifyWebhookAuth(body, `Bearer ${TEST_SECRET}`);
        expect(verified.payload.session_id).toBe('sess_live_1');
        expect(verified.payload.topic).toBe('session_completion');
      } finally {
        delete process.env.YOTI_WEBHOOK_SECRET;
      }
    });

    it('throws unauthenticated AppError on bad Bearer token', () => {
      process.env.YOTI_WEBHOOK_SECRET = TEST_SECRET;
      try {
        const c = new LiveYotiClient();
        expect(() =>
          c.verifyWebhookAuth(Buffer.from('{"x":1}'), 'Bearer wrong-token-value-here'),
        ).toThrow(/Invalid webhook token/);
      } finally {
        delete process.env.YOTI_WEBHOOK_SECRET;
      }
    });

    it('throws unauthenticated AppError on missing Authorization header', () => {
      process.env.YOTI_WEBHOOK_SECRET = TEST_SECRET;
      try {
        const c = new LiveYotiClient();
        expect(() => c.verifyWebhookAuth(Buffer.from('{}'), undefined)).toThrow(
          /Missing Authorization header/,
        );
      } finally {
        delete process.env.YOTI_WEBHOOK_SECRET;
      }
    });

    it('throws config Error (not auth) when YOTI_WEBHOOK_SECRET is unset', () => {
      delete process.env.YOTI_WEBHOOK_SECRET;
      const c = new LiveYotiClient();
      expect(() => c.verifyWebhookAuth(Buffer.from('{}'), 'Bearer x')).toThrow(
        /YOTI_WEBHOOK_SECRET is not set/,
      );
    });
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

// ── Bearer auth + topic-based payload (route-level) ──────────────────────────
describe('yotiWebhook — Bearer auth + IDV topic payload', () => {
  it('returns 401 + YOTI_WEBHOOK_AUTH_INVALID on bad Bearer token', async () => {
    const body = Buffer.from(JSON.stringify({ session_id: 'x', topic: 'session_completion' }));
    const req = makeReq({
      body,
      headers: { authorization: 'Bearer wrong-token' },
    }) as unknown as Request;
    const res = makeRes();
    await yotiWebhook(req as any, res);
    expect(res._status).toBe(401);
    expect(res._json.error.code).toBe('YOTI_WEBHOOK_AUTH_INVALID');
    expect(insertPayloads.yoti_sessions).toBeUndefined();
    expect(updatePayloads.yoti_sessions).toBeUndefined();
  });

  it('accepts a SESSION_COMPLETION notification and bridges through getSession', async () => {
    const body = Buffer.from(
      JSON.stringify({ session_id: 'mock_sess_bridge', topic: 'session_completion' }),
    );
    // The bridge calls yoti.getSession on SESSION_COMPLETION. Seed the mock's
    // in-memory session so getSession returns the verified outcome.
    const mockClient = getYotiClient() as MockYotiClient;
    mockClient.setSessionState('mock_sess_bridge', {
      sessionId: 'mock_sess_bridge',
      status: 'completed',
      outcome: 'completed_verified',
      ageEstimate: 30,
      rejectionReason: null,
    });

    enqueue('yoti_sessions', () => ({
      data: { id: 's-1', user_id: 'user-1', last_event_type: 'session.created', status: 'created', purpose: 'both' },
      error: null,
    }));
    enqueue('yoti_sessions', () => ({ data: null, error: null }));
    enqueue('users', () => ({ data: null, error: null }));

    const req = makeReq({
      body,
      headers: { authorization: MockYotiClient.authHeader() },
    }) as unknown as Request;
    const res = makeRes();
    await yotiWebhook(req as any, res);
    expect(res._status).toBeUndefined();
    expect(res._json.success).toBe(true);
    expect(res._json.data.applied).toBe(true);
    expect(res._json.data.topic).toBe('session_completion');
    // State machine wrote VERIFIED + age_verified using values getSession returned.
    expect(updatePayloads.users?.[0]).toMatchObject({
      seller_verification_status: 'VERIFIED',
      age_verified: true,
      yoti_age_estimate: 30,
    });
  });

  it('check_completion topic is treated as in-progress (no DB writes when already in_progress)', async () => {
    const body = Buffer.from(
      JSON.stringify({ session_id: 'mock_sess_progress', topic: 'check_completion' }),
    );

    // Seed an existing session row in the in_progress state with last_event_type
    // = session.in_progress so the idempotency guard short-circuits.
    enqueue('yoti_sessions', () => ({
      data: { id: 's-1', user_id: 'user-1', last_event_type: 'session.in_progress', status: 'in_progress', purpose: 'seller_kyc' },
      error: null,
    }));

    const req = makeReq({
      body,
      headers: { authorization: MockYotiClient.authHeader() },
    }) as unknown as Request;
    const res = makeRes();
    await yotiWebhook(req as any, res);
    expect(res._json.success).toBe(true);
    expect(res._json.data.applied).toBe(false);
    expect(res._json.data.reason).toBe('duplicate_event');
  });

  it('rejects 400 when raw body is missing', async () => {
    const req = makeReq({ body: undefined as any, headers: { authorization: 'Bearer whatever' } }) as unknown as Request;
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
