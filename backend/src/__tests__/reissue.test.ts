import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes } from 'crypto';
import request from 'supertest';
import express from 'express';
import { createMockSupabase, resetMockIds, type MockHooks, type Tables, type Row } from './helpers/supabaseMock';
import { spyOnSecurityEvents, type SecurityEventSpy } from './helpers/securityEvents';
import { hashTapSessionToken } from '../services/nfc/tapSession';

/**
 * S-ADMIN1 Ph2 — re-issue: owner request, web payment, webhook, admin queue.
 *
 * Rules exercised (Boss, 2026-10-09):
 *   - only the registered owner can request, with a live tap of THIS chip and
 *     1–3 photos really uploaded under their own prefix;
 *   - the $10 is charged only after approval, on the website, and only the
 *     webhook marks it PAID (AC4: exactly once, idempotency key = request id);
 *   - nothing is fulfilled unpaid unless an admin waived the fee;
 *   - fulfil needs the serial suffix of the chip being retired;
 *   - a re-issue intent never touches a transfer, and vice versa.
 */

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const ADMIN = '44444444-4444-4444-8444-444444444444';
const TAG_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_TAG = '66666666-6666-4666-8666-666666666666';
const NEW_TAG = '77777777-7777-4777-8777-777777777777';
const REQ_ID = '88888888-8888-4888-8888-888888888888';
const TRANSFER_ID = '99999999-9999-4999-8999-999999999999';
const SERIAL = '7F6509CC4DAE6CA9';
const REASON = 'Chip lifting at one corner, photos confirm';

const TAP = 'A'.repeat(43);
const photoKey = (user: string, n = 1) => `reissue-evidence/${user}/0000000${n}-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;

let tables: Tables;
let hooks: MockHooks;
let logSpy: SecurityEventSpy;
let rpcCalls: Array<{ fn: string; args: Row }>;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(tables, hooks),
}));

const stripeCreate = vi.fn();
const stripeRetrieve = vi.fn();
const stripeCancel = vi.fn();
const constructEventAsync = vi.fn();
vi.mock('../lib/stripe', () => ({
  getStripe: () => ({
    paymentIntents: { create: stripeCreate, retrieve: stripeRetrieve, cancel: stripeCancel },
    webhooks: { constructEventAsync },
  }),
}));

const sendEmail = vi.fn();
vi.mock('../lib/notifications/emailSender', () => ({
  sendEmail: (payload: unknown) => sendEmail(payload),
}));

// S3 is mocked; the key-prefix rule stays REAL.
const evidenceObjectIsValid = vi.fn();
vi.mock('../lib/reissueEvidence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/reissueEvidence')>();
  return {
    ...actual,
    evidenceObjectIsValid: (key: string) => evidenceObjectIsValid(key),
    evidenceUploadUrl: async (userId: string) => ({ uploadUrl: 'https://s3.example/put', key: photoKey(userId) }),
    evidenceViewUrl: async (key: string) => `https://s3.example/get?${key.length}`,
  };
});

// ── Harness ─────────────────────────────────────────────────────────────────

const future = () => new Date(Date.now() + 5 * 60 * 1000).toISOString();

const tapSessionRow = (overrides: Row = {}): Row => ({
  id: 'tap-session-1',
  tag_id: TAG_ID,
  token_hash: hashTapSessionToken(TAP),
  counter_value: 7,
  expires_at: future(),
  consumed_at: null,
  consumed_by: null,
  consumed_for: null,
  created_at: new Date().toISOString(),
  ...overrides,
});

const reissueRow = (overrides: Row = {}): Row => ({
  id: REQ_ID,
  tag_id: TAG_ID,
  requester_id: OWNER,
  status: 'APPROVED',
  payment_status: 'AWAITING_PAYMENT',
  stripe_payment_intent_id: null,
  tap_session_id: 'tap-session-1',
  photo_keys: [photoKey(OWNER)],
  list_amount_usd_cents: 1000,
  charged_amount: 1000,
  charged_currency: 'usd',
  fx_rate: 1,
  review_reason: REASON,
  waive_reason: null,
  reviewed_by: ADMIN,
  reviewed_at: '2026-10-09T10:00:00.000Z',
  paid_at: null,
  fulfilled_at: null,
  fulfilled_by: null,
  new_tag_id: null,
  created_at: '2026-10-09T09:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  resetMockIds();
  vi.resetModules();
  for (const m of [stripeCreate, stripeRetrieve, stripeCancel, constructEventAsync, sendEmail, evidenceObjectIsValid]) m.mockReset();
  stripeCreate.mockResolvedValue({ id: 'pi_reissue_1', client_secret: 'cs_reissue_1' });
  stripeRetrieve.mockResolvedValue({ id: 'pi_reissue_1', client_secret: 'cs_reissue_1', status: 'requires_payment_method' });
  stripeCancel.mockResolvedValue({ id: 'pi_reissue_1', status: 'canceled' });
  sendEmail.mockResolvedValue(true);
  evidenceObjectIsValid.mockResolvedValue(true);

  process.env.OWNERSHIP_SALT_KEY = randomBytes(32).toString('base64');
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  process.env.STRIPE_TOKEN_FEE_WEBHOOK_SECRET = 'whsec_test';
  process.env.FRONTEND_URL = 'https://am.example';

  rpcCalls = [];
  hooks = {};
  logSpy = spyOnSecurityEvents();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  tables = {
    nfc_tags: [
      {
        id: TAG_ID, tag_uid: '04A27E02936980', chip_serial: SERIAL, sdm_key_version: 2,
        lifecycle_status: 'ACTIVE', current_owner_id: OWNER, seller_id: ADMIN, sun_counter: 7,
        disclosure: null, linked_item_id: null,
      },
      {
        id: OTHER_TAG, tag_uid: '04927E02936980', chip_serial: null, sdm_key_version: 1,
        lifecycle_status: 'ACTIVE', current_owner_id: OWNER, seller_id: ADMIN, sun_counter: 7,
        disclosure: null, linked_item_id: null,
      },
    ],
    nfc_tap_sessions: [tapSessionRow()],
    reissue_requests: [],
    ownership_transfers: [],
    ownership_proofs: [],
    users: [
      { id: OWNER, email: 'owner@example.com', billing_country: 'US' },
      { id: STRANGER, email: 'stranger@example.com', billing_country: 'US' },
    ],
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const rpcAnswer = (answer: (fn: string, args: Row) => { data: unknown; error: { message: string } | null }) => {
  hooks.rpc = (fn, args) => {
    rpcCalls.push({ fn, args });
    return answer(fn, args);
  };
};

const makeReq = (userId: string | null, body: Row = {}, params: Row = {}) => ({
  requestId: 'test-req',
  user: userId ? { id: userId } : undefined,
  admin: { admin_id: ADMIN },
  headers: {},
  socket: { remoteAddress: '203.0.113.5' },
  body,
  params,
  query: {} as Row,
});

const call = async (fn: (req: never, res: never) => Promise<unknown>, req: ReturnType<typeof makeReq>) => {
  const res: { status: number; body: Row } = { status: 0, body: {} };
  const handler = {
    status(code: number) { res.status = code; return this; },
    json(payload: Row) { res.body = payload; return this; },
    headersSent: false,
  };
  try {
    await fn(req as never, handler as never);
    return { ...res, threw: null as { code?: string; message: string } | null };
  } catch (err) {
    return { ...res, threw: err as { code?: string; message: string } };
  }
};

const owner = async () => import('../controllers/tagManagementController');
const admin = async () => import('../controllers/adminReissueController');
const session = (): Row => tables.nfc_tap_sessions[0];
const reissue = (): Row => tables.reissue_requests[0];
const events = (name: string) => logSpy.named(name);
const requestBody = (overrides: Row = {}) => ({ tagId: TAG_ID, tapSession: TAP, photoKeys: [photoKey(OWNER)], ...overrides });

// ── Owner: request ──────────────────────────────────────────────────────────

describe('owner: re-issue request', () => {
  it('opens a PENDING request for the owner, spending the tap and creating no PaymentIntent', async () => {
    const { requestReissue } = await owner();

    const out = await call(requestReissue, makeReq(OWNER, requestBody({ photoKeys: [photoKey(OWNER, 1), photoKey(OWNER, 2)] })));

    expect(out.threw).toBeNull();
    expect(out.status).toBe(201);
    expect(reissue()).toMatchObject({
      status: 'PENDING', requester_id: OWNER, tap_session_id: 'tap-session-1',
      photo_keys: [photoKey(OWNER, 1), photoKey(OWNER, 2)],
      list_amount_usd_cents: 1000, charged_amount: 1000, charged_currency: 'usd',
    });
    expect(session()).toMatchObject({ consumed_by: OWNER, consumed_for: 'reissue_request' });
    expect(stripeCreate).not.toHaveBeenCalled();
    expect(evidenceObjectIsValid).toHaveBeenCalledTimes(2);
    expect(events('nfc.reissue_request').at(-1)).toMatchObject({ action: 'request', result: 'ok' });
  });

  it('refuses anyone but the registered owner and leaves the tap unspent', async () => {
    const { requestReissue } = await owner();

    const out = await call(requestReissue, makeReq(STRANGER, requestBody({ photoKeys: [photoKey(STRANGER)] })));

    expect(out.threw?.code).toBe('permission_denied');
    expect(tables.reissue_requests).toHaveLength(0);
    expect(session().consumed_at).toBeNull();
    expect(events('authz.denied')[0]).toMatchObject({ resource_type: 'tag', reason: 'not_owner' });
  });

  it('refuses photos under another account prefix without spending the tap', async () => {
    const { requestReissue } = await owner();

    const out = await call(requestReissue, makeReq(OWNER, requestBody({ photoKeys: [photoKey(STRANGER)] })));

    expect(out.threw?.code).toBe('invalid_argument');
    expect(evidenceObjectIsValid).not.toHaveBeenCalled();
    expect(session().consumed_at).toBeNull();
    expect(tables.reissue_requests).toHaveLength(0);
  });

  it('refuses a photo that was never actually uploaded', async () => {
    evidenceObjectIsValid.mockResolvedValue(false);
    const { requestReissue } = await owner();

    const out = await call(requestReissue, makeReq(OWNER, requestBody()));

    expect(out.threw?.code).toBe('invalid_argument');
    expect(session().consumed_at).toBeNull();
    expect(tables.reissue_requests).toHaveLength(0);
  });

  it('refuses without photos (schema) and with more than three', async () => {
    const { requestReissue } = await owner();

    const none = await call(requestReissue, makeReq(OWNER, requestBody({ photoKeys: [] })));
    const four = await call(requestReissue, makeReq(OWNER, requestBody({
      photoKeys: [1, 2, 3, 4].map((n) => photoKey(OWNER, n)),
    })));

    expect(none.threw?.code).toBe('invalid_argument');
    expect(four.threw?.code).toBe('invalid_argument');
    expect(tables.reissue_requests).toHaveLength(0);
  });

  it.each([
    ['already used', { consumed_at: '2026-10-09T00:00:00.000Z', consumed_for: 'claim' }],
    ['expired', { expires_at: '2020-01-01T00:00:00.000Z' }],
    ['for another chip', { tag_id: OTHER_TAG }],
    ['superseded by a newer tap', { counter_value: 6 }],
  ])('refuses a tap session that is %s', async (_label, overrides) => {
    tables.nfc_tap_sessions[0] = tapSessionRow(overrides);
    const { requestReissue } = await owner();

    const out = await call(requestReissue, makeReq(OWNER, requestBody()));

    expect((out.threw as { details?: { reason?: string } })?.details?.reason).toBe('tap_session_invalid');
    expect(tables.reissue_requests).toHaveLength(0);
  });

  it('refuses a second open request before spending the tap', async () => {
    tables.reissue_requests.push(reissueRow({ status: 'APPROVED', payment_status: 'PAID', fulfilled_at: null }));
    const { requestReissue } = await owner();

    const out = await call(requestReissue, makeReq(OWNER, requestBody()));

    expect(out.threw?.code).toBe('conflict');
    expect(session().consumed_at).toBeNull();
    expect(tables.reissue_requests).toHaveLength(1);
  });

  it('allows a new request once the previous one is fulfilled', async () => {
    tables.reissue_requests.push(reissueRow({ payment_status: 'PAID', fulfilled_at: '2026-10-09T12:00:00.000Z' }));
    const { requestReissue } = await owner();

    const out = await call(requestReissue, makeReq(OWNER, requestBody()));

    expect(out.threw).toBeNull();
    expect(tables.reissue_requests).toHaveLength(2);
  });

  it('refuses a released token', async () => {
    tables.nfc_tags[0].lifecycle_status = 'RELEASED';
    const { requestReissue } = await owner();

    const out = await call(requestReissue, makeReq(OWNER, requestBody()));

    expect(out.threw?.message).toMatch(/released/i);
    expect(events('nfc.reissue_request').at(-1)).toMatchObject({ result: 'token_released' });
  });
});

describe('evidence keys', () => {
  it('accepts only keys generated for the caller', async () => {
    const { isOwnEvidenceKey } = await vi.importActual<typeof import('../lib/reissueEvidence')>('../lib/reissueEvidence');
    expect(isOwnEvidenceKey(photoKey(OWNER), OWNER)).toBe(true);
    expect(isOwnEvidenceKey(photoKey(STRANGER), OWNER)).toBe(false);
    expect(isOwnEvidenceKey(`reissue-evidence/${OWNER}/../${STRANGER}/x.jpg`, OWNER)).toBe(false);
    expect(isOwnEvidenceKey(`listings/${OWNER}/0000000a-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`, OWNER)).toBe(false);
  });

  it('is unavailable without a private evidence bucket (never falls back to the public media bucket)', async () => {
    delete process.env.REISSUE_EVIDENCE_BUCKET;
    const { evidenceUploadUrl } = await vi.importActual<typeof import('../lib/reissueEvidence')>('../lib/reissueEvidence');
    await expect(evidenceUploadUrl(OWNER, 1000)).rejects.toMatchObject({ code: 'unavailable' });
  });
});

// ── Owner: pay + cancel ─────────────────────────────────────────────────────

describe('owner: pay', () => {
  it('creates ONE PaymentIntent keyed by the request id and stores it before returning the secret', async () => {
    tables.reissue_requests.push(reissueRow());
    const { payReissue } = await owner();

    const out = await call(payReissue, makeReq(OWNER, {}, { id: REQ_ID }));

    expect(out.threw).toBeNull();
    expect(out.body).toMatchObject({ success: true, data: { clientSecret: 'cs_reissue_1', chargedAmount: 1000 } });
    expect(stripeCreate).toHaveBeenCalledTimes(1);
    const [params, opts] = stripeCreate.mock.calls[0];
    expect(params).toMatchObject({
      amount: 1000, currency: 'usd',
      metadata: { reissue_request_id: REQ_ID, tag_id: TAG_ID, kind: 'token_reissue_fee' },
    });
    expect(opts).toEqual({ idempotencyKey: `token-reissue-fee-${REQ_ID}` });
    expect(reissue()).toMatchObject({ stripe_payment_intent_id: 'pi_reissue_1', payment_status: 'AWAITING_PAYMENT' });
  });

  it('returns the existing PaymentIntent on a second call instead of creating another', async () => {
    tables.reissue_requests.push(reissueRow({ stripe_payment_intent_id: 'pi_reissue_1' }));
    const { payReissue } = await owner();

    const out = await call(payReissue, makeReq(OWNER, {}, { id: REQ_ID }));

    expect(out.threw).toBeNull();
    expect(stripeCreate).not.toHaveBeenCalled();
    expect(stripeRetrieve).toHaveBeenCalledWith('pi_reissue_1');
  });

  it.each([
    ['still pending review', { status: 'PENDING', payment_status: null }],
    ['already paid', { payment_status: 'PAID' }],
    ['waived', { payment_status: 'WAIVED' }],
    ['rejected', { status: 'REJECTED', payment_status: null }],
  ])('refuses to charge a request that is %s', async (_label, overrides) => {
    tables.reissue_requests.push(reissueRow(overrides));
    const { payReissue } = await owner();

    const out = await call(payReissue, makeReq(OWNER, {}, { id: REQ_ID }));

    expect(out.threw?.code).toBe('failed_precondition');
    expect(stripeCreate).not.toHaveBeenCalled();
  });

  it("answers not_found for someone else's request", async () => {
    tables.reissue_requests.push(reissueRow());
    const { payReissue } = await owner();

    const out = await call(payReissue, makeReq(STRANGER, {}, { id: REQ_ID }));

    expect(out.threw?.code).toBe('not_found');
    expect(stripeCreate).not.toHaveBeenCalled();
    expect(events('authz.denied')[0]).toMatchObject({ resource_type: 'reissue', reason: 'not_owner' });
  });

  it('refuses when the requester no longer owns the token', async () => {
    tables.reissue_requests.push(reissueRow());
    tables.nfc_tags[0].current_owner_id = STRANGER;
    const { payReissue } = await owner();

    const out = await call(payReissue, makeReq(OWNER, {}, { id: REQ_ID }));

    expect(out.threw?.code).toBe('permission_denied');
    expect(stripeCreate).not.toHaveBeenCalled();
  });

  it('withholds the client secret when the PaymentIntent id cannot be stored', async () => {
    tables.reissue_requests.push(reissueRow());
    hooks.failUpdate = (table) => table === 'reissue_requests';
    const { payReissue } = await owner();

    const out = await call(payReissue, makeReq(OWNER, {}, { id: REQ_ID }));

    expect(out.threw?.code).toBe('internal');
    expect(out.threw?.message).toMatch(/not been charged/);
    expect(JSON.stringify(out.body)).not.toContain('cs_reissue_1');
  });
});

describe('owner: cancel', () => {
  it('cancels a PENDING request', async () => {
    tables.reissue_requests.push(reissueRow({ status: 'PENDING', payment_status: null }));
    const { cancelReissue } = await owner();

    const out = await call(cancelReissue, makeReq(OWNER, {}, { id: REQ_ID }));

    expect(out.threw).toBeNull();
    expect(reissue().status).toBe('CANCELLED');
    expect(stripeCancel).not.toHaveBeenCalled();
  });

  it('cancels the open PaymentIntent in Stripe first', async () => {
    tables.reissue_requests.push(reissueRow({ stripe_payment_intent_id: 'pi_reissue_1' }));
    const { cancelReissue } = await owner();

    const out = await call(cancelReissue, makeReq(OWNER, {}, { id: REQ_ID }));

    expect(out.threw).toBeNull();
    expect(stripeCancel).toHaveBeenCalledWith('pi_reissue_1');
    expect(reissue().status).toBe('CANCELLED');
  });

  it('refuses once the payment has gone through in Stripe', async () => {
    tables.reissue_requests.push(reissueRow({ stripe_payment_intent_id: 'pi_reissue_1' }));
    stripeCancel.mockRejectedValue(new Error('This PaymentIntent has already succeeded'));
    stripeRetrieve.mockResolvedValue({ id: 'pi_reissue_1', status: 'succeeded' });
    const { cancelReissue } = await owner();

    const out = await call(cancelReissue, makeReq(OWNER, {}, { id: REQ_ID }));

    expect(out.threw?.code).toBe('failed_precondition');
    expect(reissue().status).toBe('APPROVED');
  });

  it('refuses a paid request', async () => {
    tables.reissue_requests.push(reissueRow({ payment_status: 'PAID' }));
    const { cancelReissue } = await owner();

    const out = await call(cancelReissue, makeReq(OWNER, {}, { id: REQ_ID }));

    expect(out.threw?.code).toBe('failed_precondition');
    expect(reissue().status).toBe('APPROVED');
  });
});

// ── Webhook ─────────────────────────────────────────────────────────────────

const succeeded = (metadata: Row, id = 'pi_reissue_1') => ({
  type: 'payment_intent.succeeded',
  id: 'evt_1',
  data: { object: { id, metadata } },
});

const postWebhook = async () => {
  const { default: router } = await import('../routes/tokenFeeWebhook');
  const app = express();
  app.use('/hook', express.raw({ type: 'application/json' }), router);
  return request(app).post('/hook').set('stripe-signature', 't=1,v1=x').set('content-type', 'application/json').send('{}');
};

const reissueMeta = { reissue_request_id: REQ_ID, tag_id: TAG_ID, kind: 'token_reissue_fee' };

describe('webhook: re-issue fee', () => {
  it('marks the request PAID, and nothing else changes', async () => {
    tables.reissue_requests.push(reissueRow({ stripe_payment_intent_id: 'pi_reissue_1' }));
    constructEventAsync.mockResolvedValue(succeeded(reissueMeta));

    const res = await postWebhook();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ applied: true });
    expect(reissue()).toMatchObject({ payment_status: 'PAID', status: 'APPROVED', fulfilled_at: null });
    expect(reissue().paid_at).toBeTruthy();
    expect(tables.nfc_tags[0]).toMatchObject({ lifecycle_status: 'ACTIVE', current_owner_id: OWNER });
    expect(tables.ownership_proofs).toHaveLength(0);
    expect(events('payment.webhook').at(-1)).toMatchObject({ reissue_request_id: REQ_ID, result: 'ok', idempotent_replay: false });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: 'owner@example.com', subject: expect.stringMatching(/payment received/i) });
  });

  it('treats a redelivery as an idempotent replay', async () => {
    tables.reissue_requests.push(reissueRow({ stripe_payment_intent_id: 'pi_reissue_1', payment_status: 'PAID' }));
    constructEventAsync.mockResolvedValue(succeeded(reissueMeta));

    const res = await postWebhook();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ applied: false, reason: 'already_paid' });
    expect(events('payment.webhook').at(-1)).toMatchObject({ idempotent_replay: true });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('refuses an intent the request did not store', async () => {
    tables.reissue_requests.push(reissueRow({ stripe_payment_intent_id: 'pi_reissue_1' }));
    constructEventAsync.mockResolvedValue(succeeded(reissueMeta, 'pi_someone_else'));

    const res = await postWebhook();

    expect(res.status).toBe(200);
    expect(reissue().payment_status).toBe('AWAITING_PAYMENT');
    expect(events('payment.webhook').at(-1)).toMatchObject({ result: 'forbidden' });
  });

  it('does not revive a cancelled request that was somehow paid', async () => {
    tables.reissue_requests.push(reissueRow({ stripe_payment_intent_id: 'pi_reissue_1', status: 'CANCELLED' }));
    constructEventAsync.mockResolvedValue(succeeded(reissueMeta));

    const res = await postWebhook();

    expect(res.status).toBe(200);
    expect(reissue()).toMatchObject({ status: 'CANCELLED', payment_status: 'AWAITING_PAYMENT' });
  });

  it('asks Stripe to retry when the database read fails', async () => {
    tables.reissue_requests.push(reissueRow({ stripe_payment_intent_id: 'pi_reissue_1' }));
    hooks.failRead = (table) => table === 'reissue_requests';
    constructEventAsync.mockResolvedValue(succeeded(reissueMeta));

    const res = await postWebhook();

    expect(res.status).toBe(500);
    expect(reissue().payment_status).toBe('AWAITING_PAYMENT');
  });

  it('never completes a transfer from a re-issue intent', async () => {
    tables.ownership_transfers.push({
      id: TRANSFER_ID, tag_id: TAG_ID, from_user_id: OWNER, to_user_id: STRANGER,
      status: 'PENDING', stripe_payment_intent_id: 'pi_reissue_1',
    });
    constructEventAsync.mockResolvedValue(succeeded({ ...reissueMeta, transfer_id: TRANSFER_ID, reissue_request_id: REQ_ID }));

    await postWebhook();

    expect(tables.ownership_transfers[0].status).toBe('PENDING');
    expect(tables.nfc_tags[0].current_owner_id).toBe(OWNER);
  });

  it('never pays a re-issue from a transfer intent', async () => {
    tables.reissue_requests.push(reissueRow({ stripe_payment_intent_id: 'pi_reissue_1' }));
    constructEventAsync.mockResolvedValue(succeeded({ kind: 'token_transfer_fee', reissue_request_id: REQ_ID, tag_id: TAG_ID }));

    await postWebhook();

    expect(reissue().payment_status).toBe('AWAITING_PAYMENT');
  });
});

// ── Admin queue ─────────────────────────────────────────────────────────────

describe('admin: review', () => {
  it('approves with a charge: the database function decides, the owner gets a website pay link', async () => {
    tables.reissue_requests.push(reissueRow({ status: 'PENDING', payment_status: null }));
    rpcAnswer(() => {
      Object.assign(reissue(), { status: 'APPROVED', payment_status: 'AWAITING_PAYMENT' });
      return { data: { status: 'APPROVED', payment_status: 'AWAITING_PAYMENT' }, error: null };
    });
    const { approveReissue } = await admin();

    const out = await call(approveReissue, makeReq(null, { reason: REASON }, { id: REQ_ID }));

    expect(out.threw).toBeNull();
    expect(rpcCalls).toEqual([{
      fn: 'admin_review_reissue',
      args: { p_request: REQ_ID, p_admin: ADMIN, p_approve: true, p_waive: false, p_reason: REASON },
    }]);
    expect(stripeCreate).not.toHaveBeenCalled();
    const mail = sendEmail.mock.calls[0][0] as { to: string; text: string; html: string };
    expect(mail.to).toBe('owner@example.com');
    expect(mail.text).toContain(`https://am.example/tokens/reissue/${REQ_ID}/pay`);
    expect(mail.text).toContain('$10.00');
    // The admin's typed reason is internal.
    expect(mail.text + mail.html).not.toContain(REASON);
    expect(mail.text + mail.html).not.toContain('—');
    expect(events('admin.reissue_action')[0]).toMatchObject({ action: 'approve', result: 'ok', reissue_request_id: REQ_ID, tag_id: TAG_ID });
  });

  it('approves with the fee waived: no pay link', async () => {
    tables.reissue_requests.push(reissueRow({ status: 'PENDING', payment_status: null }));
    rpcAnswer(() => ({ data: { status: 'APPROVED', payment_status: 'WAIVED' }, error: null }));
    const { approveReissue } = await admin();

    const out = await call(approveReissue, makeReq(null, { reason: REASON, waive: true }, { id: REQ_ID }));

    expect(out.threw).toBeNull();
    expect(rpcCalls[0].args).toMatchObject({ p_approve: true, p_waive: true });
    expect((sendEmail.mock.calls[0][0] as { text: string }).text).not.toContain('/pay');
    expect(events('admin.reissue_action')[0]).toMatchObject({ action: 'approve_waived' });
  });

  it('rejects without charging and without revealing the reason', async () => {
    tables.reissue_requests.push(reissueRow({ status: 'PENDING', payment_status: null }));
    rpcAnswer(() => ({ data: { status: 'REJECTED', payment_status: null }, error: null }));
    const { rejectReissue } = await admin();

    const out = await call(rejectReissue, makeReq(null, { reason: REASON }, { id: REQ_ID }));

    expect(out.threw).toBeNull();
    expect(rpcCalls[0].args).toMatchObject({ p_approve: false, p_waive: false });
    expect(stripeCreate).not.toHaveBeenCalled();
    const mail = sendEmail.mock.calls[0][0] as { text: string };
    expect(mail.text).toMatch(/nothing was charged/i);
    expect(mail.text).not.toContain(REASON);
  });

  it('refuses a short reason before calling the database', async () => {
    rpcAnswer(() => ({ data: {}, error: null }));
    const { approveReissue } = await admin();

    const out = await call(approveReissue, makeReq(null, { reason: 'ok' }, { id: REQ_ID }));

    expect(out.threw?.code).toBe('invalid_argument');
    expect(rpcCalls).toHaveLength(0);
  });

  it.each([
    ['requester_not_owner', 'conflict'],
    ['request_invalid_state: APPROVED', 'conflict'],
    ['admin_forbidden: actor lacks manage_nfc', 'permission_denied'],
    ['something unexpected', 'internal'],
  ])('maps "%s" to %s and sends no email', async (message, code) => {
    rpcAnswer(() => ({ data: null, error: { message } }));
    const { approveReissue } = await admin();

    const out = await call(approveReissue, makeReq(null, { reason: REASON }, { id: REQ_ID }));

    expect(out.threw?.code).toBe(code);
    expect(out.threw?.message).not.toContain(message);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('admin: fulfil', () => {
  const body = (overrides: Row = {}) => ({ newTagId: NEW_TAG, reason: REASON, confirmSuffix: 'AE6CA9', ...overrides });

  it('runs admin_fulfil_reissue with a freshly minted proof for the NEW chip', async () => {
    tables.reissue_requests.push(reissueRow({ payment_status: 'PAID' }));
    rpcAnswer(() => ({ data: { old_tag_id: TAG_ID, new_tag_id: NEW_TAG, request_id: REQ_ID }, error: null }));
    const { fulfilReissue } = await admin();

    const out = await call(fulfilReissue, makeReq(null, body(), { id: REQ_ID }));

    expect(out.threw).toBeNull();
    expect(rpcCalls).toHaveLength(1);
    const { fn, args } = rpcCalls[0];
    expect(fn).toBe('admin_fulfil_reissue');
    expect(args).toMatchObject({ p_request: REQ_ID, p_new_tag: NEW_TAG, p_admin: ADMIN, p_reason: REASON });
    expect(args.p_ownership_id).toMatch(/^0x[0-9a-f]{64}$/);
    expect(JSON.stringify(out.body)).not.toContain(args.p_ownership_id as string);
    expect((sendEmail.mock.calls[0][0] as { subject: string }).subject).toMatch(/replacement chip is active/i);
    expect(events('admin.reissue_action')[0]).toMatchObject({ action: 'fulfil', result: 'ok', new_tag_id: NEW_TAG });
  });

  it('refuses the shared UID suffix: a v2 chip is confirmed on its serial', async () => {
    tables.reissue_requests.push(reissueRow({ payment_status: 'PAID' }));
    rpcAnswer(() => ({ data: {}, error: null }));
    const { fulfilReissue } = await admin();

    const out = await call(fulfilReissue, makeReq(null, body({ confirmSuffix: '936980' }), { id: REQ_ID }));

    expect(out.threw?.code).toBe('invalid_argument');
    expect(rpcCalls).toHaveLength(0);
  });

  it('surfaces "not paid" from the database function as failed_precondition', async () => {
    tables.reissue_requests.push(reissueRow());
    rpcAnswer(() => ({ data: null, error: { message: 'not_paid: AWAITING_PAYMENT' } }));
    const { fulfilReissue } = await admin();

    const out = await call(fulfilReissue, makeReq(null, body(), { id: REQ_ID }));

    expect(out.threw?.code).toBe('failed_precondition');
    expect(events('admin.reissue_action')[0]).toMatchObject({ result: 'payment_required' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('touches nothing when the salt key is missing (mints before the database call)', async () => {
    tables.reissue_requests.push(reissueRow({ payment_status: 'PAID' }));
    rpcAnswer(() => ({ data: {}, error: null }));
    delete process.env.OWNERSHIP_SALT_KEY;
    const { fulfilReissue } = await admin();

    const out = await call(fulfilReissue, makeReq(null, body(), { id: REQ_ID }));

    expect(out.threw).not.toBeNull();
    expect(rpcCalls).toHaveLength(0);
  });
});

describe('admin: queue', () => {
  it('READY lists only paid or waived requests still waiting for a chip, with view links but never raw keys', async () => {
    tables.reissue_requests.push(
      reissueRow({ id: 'a0000000-0000-4000-8000-000000000001', payment_status: 'PAID' }),
      reissueRow({ id: 'a0000000-0000-4000-8000-000000000002', payment_status: 'WAIVED', tag_id: OTHER_TAG }),
      reissueRow({ id: 'a0000000-0000-4000-8000-000000000003' }),
      reissueRow({ id: 'a0000000-0000-4000-8000-000000000004', payment_status: 'PAID', fulfilled_at: '2026-10-09T12:00:00.000Z' }),
    );
    const { listReissueRequests } = await admin();
    const req = makeReq(null);
    req.query = { status: 'READY' };

    const out = await call(listReissueRequests, req);

    expect(out.threw).toBeNull();
    const data = (out.body as { data: { requests: Array<Row> } }).data;
    expect(data.requests.map((r) => r.id).sort()).toEqual([
      'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
    ]);
    const first = data.requests.find((r) => r.tagId === TAG_ID) as Row;
    expect(first.tag).toMatchObject({ serialSuffix: 'AE6CA9', uidSuffix: '936980', requesterStillOwner: true });
    expect(first.photoUrls).toHaveLength(1);
    expect(JSON.stringify(out.body)).not.toContain('reissue-evidence/');
  });
});
