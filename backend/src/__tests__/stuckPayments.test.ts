import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { permissionsFor } from './helpers/adminRoles';
import { randomBytes } from 'crypto';
import request from 'supertest';
import express from 'express';
import { createMockSupabase, resetMockIds, type MockHooks, type Tables, type Row } from './helpers/supabaseMock';
import { spyOnSecurityEvents, type SecurityEventSpy } from './helpers/securityEvents';
import { feeDbFake } from './helpers/feeDbFake';

/**
 * S-ADMIN1 Ph3a — stuck payments.
 *
 * Locked decision "Paid-but-stuck transfers" (2026-10-03), extended to re-issue
 * fees. What is proven here:
 *   - the sweep applies a paid fee whose webhook never arrived, and queues one
 *     it cannot apply
 *   - Re-apply re-runs the same apply, only after asking Stripe, and is
 *     idempotent
 *   - a refund needs admin or super_admin, goes to Stripe once, and cancels a
 *     still-pending transfer
 *   - one GitHub Issue per incident, ids only
 *   - a transfer reaches COMPLETED only with trigger webhook | sweep | reapply
 *
 * The database functions are played by feeDbFake; the real ones are proven by
 * supabase/tests/s_admin1_ph3a_live.sql.
 */

const TAG_ID = '55555555-5555-4555-8555-555555555555';
const TRANSFER_ID = '66666666-6666-4666-8666-666666666666';
const REQ_ID = '77777777-7777-4777-8777-777777777777';
const OWNER = '11111111-1111-4111-8111-111111111111';
const BUYER = '22222222-2222-4222-8222-222222222222';
const SUPPORT = '33333333-3333-4333-8333-333333333333';
const ADMIN = '44444444-4444-4444-8444-444444444444';
const ROLE_SUPPORT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROLE_ADMIN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PI = 'pi_test_stuck_123456';
const NOW = new Date('2026-10-11T12:00:00Z');
const nowSeconds = Math.floor(NOW.getTime() / 1000);

let tables: Tables;
let hooks: MockHooks;
let logSpy: SecurityEventSpy;
let rpcCalls: Array<{ fn: string; args: Row }>;
let stripeIntents: Row[];

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(tables, hooks),
}));

const stripeRetrieve = vi.fn();
const refundCreate = vi.fn();
const refundList = vi.fn();
const stripeList = vi.fn();
const stripe = {
  paymentIntents: {
    retrieve: stripeRetrieve,
    list: (params: Row) => {
      stripeList(params);
      return (async function* () { for (const intent of stripeIntents) yield intent; })();
    },
  },
  refunds: { create: refundCreate, list: refundList },
};
vi.mock('../lib/stripe', () => ({ getStripe: () => stripe }));

const sendEmail = vi.fn();
vi.mock('../lib/notifications/emailSender', () => ({
  sendEmail: (payload: unknown) => sendEmail(payload),
}));

const fetchMock = vi.fn();

/** A PaymentIntent as Stripe returns it, paid `ageMinutes` ago. */
const intent = (overrides: Row = {}, ageMinutes = 30): Row => ({
  id: PI,
  status: 'succeeded',
  amount: 250,
  currency: 'usd',
  created: nowSeconds - ageMinutes * 60 - 60,
  metadata: { kind: 'token_transfer_fee', transfer_id: TRANSFER_ID, tag_id: TAG_ID },
  latest_charge: { id: 'ch_1', created: nowSeconds - ageMinutes * 60, refunded: false, amount_refunded: 0 },
  ...overrides,
});

const reissueIntent = (overrides: Row = {}): Row =>
  intent({ id: 'pi_reissue_654321', amount: 1000, metadata: { kind: 'token_reissue_fee', reissue_request_id: REQ_ID }, ...overrides });

const ctx = { requestId: 'req-sweep', actorId: null, actorType: 'system' as const, ip: '203.0.113.5', route: '/api/v1/internal/token-fee-sweep' };

const incidents = (): Row[] => tables.payment_incidents;
const transfer = (): Row => tables.ownership_transfers[0];
const tag = (): Row => tables.nfc_tags[0];
const events = (name: string) => logSpy.named(name);

const openIncident = (overrides: Row = {}): Row => {
  const row: Row = {
    id: '99999999-9999-4999-8999-999999999999',
    kind: 'transfer_fee', transfer_id: TRANSFER_ID, reissue_request_id: null,
    stripe_payment_intent_id: PI, reason: 'no_recipient', status: 'OPEN', resolution: null,
    amount: 250, currency: 'usd', first_seen_at: NOW.toISOString(), last_seen_at: NOW.toISOString(),
    seen_count: 1, last_error: null, github_issue_number: null, github_issue_url: null,
    github_claimed_at: null, github_last_comment_at: null, resolved_at: null, resolved_by: null,
    resolved_reason: null, stripe_refund_id: null,
    ...overrides,
  };
  tables.payment_incidents.push(row);
  return row;
};

const makeReq = (adminId: string, role: string, body: Row = {}, params: Row = {}, query: Row = {}) => ({
  requestId: 'test-req',
  admin: { admin_id: adminId, role, permissions: permissionsFor(role) },
  headers: {},
  socket: { remoteAddress: '203.0.113.5' },
  body, params, query,
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

const controller = async () => import('../controllers/adminStuckPaymentsController');
const sweep = async () => (await import('../lib/payments/tokenFeeSweep')).runTokenFeeSweep;
const REASON = 'Recipient signed in, applying the paid transfer';

beforeEach(() => {
  resetMockIds();
  vi.resetModules();
  stripeRetrieve.mockReset();
  refundCreate.mockReset();
  refundList.mockReset();
  stripeList.mockReset();
  sendEmail.mockReset();
  sendEmail.mockResolvedValue(true);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);

  process.env.OWNERSHIP_SALT_KEY = randomBytes(32).toString('base64');
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  process.env.FRONTEND_URL = 'https://am.example';
  delete process.env.GITHUB_ISSUES_TOKEN;
  delete process.env.TOKEN_FEE_SWEEP_SECRET;

  rpcCalls = [];
  hooks = { rpc: feeDbFake(() => tables, rpcCalls) };
  stripeIntents = [];
  logSpy = spyOnSecurityEvents();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  tables = {
    nfc_tags: [{ id: TAG_ID, tag_uid: '04A27E02936980', chip_name: 'chip_009', lifecycle_status: 'ACTIVE', current_owner_id: OWNER }],
    ownership_transfers: [{
      id: TRANSFER_ID, tag_id: TAG_ID, from_user_id: OWNER, to_user_id: BUYER,
      status: 'PENDING', stripe_payment_intent_id: PI,
    }],
    ownership_proofs: [{ id: 'proof-1', tag_id: TAG_ID, ownership_id: `0x${'a'.repeat(64)}`, status: 'current', owner_id: OWNER }],
    reissue_requests: [],
    payment_incidents: [],
    audit_logs: [],
    admin_roles: [
      { role_id: ROLE_SUPPORT, role_name: 'support', permissions: permissionsFor('support') },
      { role_id: ROLE_ADMIN, role_name: 'admin', permissions: permissionsFor('admin') },
    ],
    admin_users: [
      { admin_id: SUPPORT, role_id: ROLE_SUPPORT, is_active: true },
      { admin_id: ADMIN, role_id: ROLE_ADMIN, is_active: true },
    ],
    users: [
      { id: OWNER, email: 'owner@example.com', billing_country: 'US' },
      { id: BUYER, email: 'buyer@example.com', billing_country: 'US' },
    ],
  };
});

afterEach(() => {
  // Every event these paths emit must be a valid catalog event.
  expect(events('security.event_invalid')).toHaveLength(0);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Reading a PaymentIntent ─────────────────────────────────────────────────

describe('readFeeIntent', () => {
  it('reads a transfer fee and a re-issue fee, and ignores everything else', async () => {
    const { readFeeIntent } = await import('../lib/payments/tokenFeeApply');

    expect(readFeeIntent(intent() as never)).toMatchObject({ kind: 'transfer_fee', transferId: TRANSFER_ID, intentId: PI, amount: 250 });
    expect(readFeeIntent(reissueIntent() as never)).toMatchObject({ kind: 'reissue_fee', reissueRequestId: REQ_ID, transferId: null });
    expect(readFeeIntent(intent({ metadata: { kind: 'marketplace_settlement' } }) as never)).toBeNull();
    expect(readFeeIntent(intent({ metadata: {} }) as never)).toBeNull();
    // An id that is not a UUID never reaches a query.
    expect(readFeeIntent(intent({ metadata: { kind: 'token_transfer_fee', transfer_id: "x' OR 1=1" } }) as never)).toBeNull();
  });
});

// ── Sweep ───────────────────────────────────────────────────────────────────

describe('reconciliation sweep', () => {
  it('applies a paid transfer whose webhook never arrived', async () => {
    stripeIntents = [intent()];

    const summary = await (await sweep())(createMockSupabase(tables, hooks) as never, stripe as never, ctx, NOW);

    expect(summary).toMatchObject({ scanned: 1, checked: 1, applied: 1, stuck: 0, settled: 0 });
    expect(transfer()).toMatchObject({ status: 'COMPLETED', transfer_fee_paid: true });
    expect(tag().current_owner_id).toBe(BUYER);
    expect(tables.ownership_proofs.filter((p) => p.status === 'current')).toHaveLength(1);
  });

  it('records the missed webhook as an already-closed incident', async () => {
    stripeIntents = [intent()];

    await (await sweep())(createMockSupabase(tables, hooks) as never, stripe as never, ctx, NOW);

    expect(incidents()).toHaveLength(1);
    expect(incidents()[0]).toMatchObject({ reason: 'webhook_missed', status: 'RESOLVED', resolution: 'sweep' });
  });

  it('logs the completion with trigger=sweep, paired with a payment.reconcile event', async () => {
    stripeIntents = [intent()];

    await (await sweep())(createMockSupabase(tables, hooks) as never, stripe as never, ctx, NOW);

    const completions = events('transfer.state_change').filter((e) => e.to === 'COMPLETED');
    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({ trigger: 'sweep', request_id: 'req-sweep' });
    expect(events('payment.reconcile')[0]).toMatchObject({
      source: 'sweep', fee_kind: 'transfer_fee', outcome: 'applied', transfer_id: TRANSFER_ID, request_id: 'req-sweep',
    });
  });

  it('asks Stripe for the last 72 hours with the charge expanded', async () => {
    await (await sweep())(createMockSupabase(tables, hooks) as never, stripe as never, ctx, NOW);

    expect(stripeList).toHaveBeenCalledWith({
      created: { gte: nowSeconds - 72 * 3600 }, limit: 100, expand: ['data.latest_charge'],
    });
  });

  it('leaves a payment made in the last 5 minutes to its webhook', async () => {
    stripeIntents = [intent({}, 2)];

    const summary = await (await sweep())(createMockSupabase(tables, hooks) as never, stripe as never, ctx, NOW);

    expect(summary).toMatchObject({ skippedRecent: 1, checked: 0, applied: 0 });
    expect(transfer().status).toBe('PENDING');
  });

  it('skips a refunded payment, an unpaid one, and an intent from another flow', async () => {
    stripeIntents = [
      intent({ latest_charge: { created: nowSeconds - 1800, refunded: true, amount_refunded: 250 } }),
      intent({ id: 'pi_unpaid', status: 'requires_payment_method' }),
      intent({ id: 'pi_market', metadata: { kind: 'marketplace_settlement' } }),
    ];

    const summary = await (await sweep())(createMockSupabase(tables, hooks) as never, stripe as never, ctx, NOW);

    expect(summary).toMatchObject({ scanned: 3, checked: 0, skippedRefunded: 1, applied: 0, stuck: 0 });
    expect(transfer().status).toBe('PENDING');
    expect(rpcCalls).toHaveLength(0);
  });

  it('does nothing for a payment that already applied', async () => {
    transfer().status = 'COMPLETED';
    stripeIntents = [intent()];

    const summary = await (await sweep())(createMockSupabase(tables, hooks) as never, stripe as never, ctx, NOW);

    expect(summary).toMatchObject({ checked: 1, settled: 1, applied: 0, stuck: 0 });
    expect(rpcCalls).toHaveLength(0);
    expect(incidents()).toHaveLength(0);
  });

  it('queues a paid transfer it cannot apply, once, however often it runs', async () => {
    transfer().to_user_id = null;
    stripeIntents = [intent()];
    const run = await sweep();

    const first = await run(createMockSupabase(tables, hooks) as never, stripe as never, ctx, NOW);
    await run(createMockSupabase(tables, hooks) as never, stripe as never, ctx, NOW);

    expect(first).toMatchObject({ stuck: 1, applied: 0 });
    expect(transfer().status).toBe('PENDING');
    expect(incidents()).toHaveLength(1);
    expect(incidents()[0]).toMatchObject({ reason: 'no_recipient', status: 'OPEN', seen_count: 2 });
  });

  it('applies on a later run once the recipient is resolved, closing the incident', async () => {
    transfer().to_user_id = null;
    stripeIntents = [intent()];
    const run = await sweep();
    await run(createMockSupabase(tables, hooks) as never, stripe as never, ctx, NOW);

    transfer().to_user_id = BUYER;
    const second = await run(createMockSupabase(tables, hooks) as never, stripe as never, ctx, NOW);

    expect(second.applied).toBe(1);
    expect(tag().current_owner_id).toBe(BUYER);
    expect(incidents()).toHaveLength(1);
    expect(incidents()[0]).toMatchObject({ status: 'RESOLVED', resolution: 'sweep', reason: 'no_recipient' });
  });

  it('queues a payment on a cancelled transfer as not payable', async () => {
    transfer().status = 'CANCELLED';
    stripeIntents = [intent()];

    const summary = await (await sweep())(createMockSupabase(tables, hooks) as never, stripe as never, ctx, NOW);

    expect(summary.stuck).toBe(1);
    expect(incidents()[0]).toMatchObject({ reason: 'not_payable', status: 'OPEN' });
    expect(tag().current_owner_id).toBe(OWNER);
  });

  it('queues a second paid intent that names an already-completed transfer', async () => {
    // Stranded money, not a replay: the transfer was completed by a different intent.
    Object.assign(transfer(), { status: 'COMPLETED', stripe_payment_intent_id: 'pi_the_real_one' });
    stripeIntents = [intent()];

    const summary = await (await sweep())(createMockSupabase(tables, hooks) as never, stripe as never, ctx, NOW);

    expect(summary).toMatchObject({ settled: 0, stuck: 1 });
    expect(incidents()[0]).toMatchObject({ reason: 'intent_mismatch', stripe_payment_intent_id: PI });
  });

  it('marks a paid re-issue request PAID and emails the owner', async () => {
    tables.reissue_requests.push({
      id: REQ_ID, tag_id: TAG_ID, requester_id: OWNER, status: 'APPROVED', payment_status: 'AWAITING_PAYMENT',
      stripe_payment_intent_id: 'pi_reissue_654321', charged_amount: 1000, fulfilled_at: null,
    });
    stripeIntents = [reissueIntent()];

    const summary = await (await sweep())(createMockSupabase(tables, hooks) as never, stripe as never, ctx, NOW);

    expect(summary.applied).toBe(1);
    expect(tables.reissue_requests[0]).toMatchObject({ payment_status: 'PAID', fulfilled_at: null });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    // A re-issue payment never moves a token.
    expect(tag().current_owner_id).toBe(OWNER);
    expect(events('transfer.state_change')).toHaveLength(0);
  });

  it('queues a paid re-issue fee whose request was cancelled', async () => {
    tables.reissue_requests.push({
      id: REQ_ID, tag_id: TAG_ID, requester_id: OWNER, status: 'CANCELLED', payment_status: 'AWAITING_PAYMENT',
      stripe_payment_intent_id: 'pi_reissue_654321', charged_amount: 1000,
    });
    stripeIntents = [reissueIntent()];

    const summary = await (await sweep())(createMockSupabase(tables, hooks) as never, stripe as never, ctx, NOW);

    expect(summary.stuck).toBe(1);
    expect(incidents()[0]).toMatchObject({ kind: 'reissue_fee', reason: 'not_payable', reissue_request_id: REQ_ID, amount: 1000 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('fails loudly, changing nothing, when our own rows cannot be read', async () => {
    stripeIntents = [intent()];
    hooks.failRead = (table) => table === 'ownership_transfers';

    await expect((await sweep())(createMockSupabase(tables, hooks) as never, stripe as never, ctx, NOW))
      .rejects.toThrow('sweep_transfer_read_failed');
    expect(transfer().status).toBe('PENDING');
  });
});

// ── Sweep endpoint ──────────────────────────────────────────────────────────

describe('POST /api/v1/internal/token-fee-sweep', () => {
  const SECRET = 'a-shared-secret-of-at-least-24-chars';
  const buildApp = async () => {
    const { default: router } = await import('../routes/tokenFeeSweep');
    const app = express();
    app.use(express.json());
    app.use('/api/v1/internal/token-fee-sweep', router);
    return app;
  };

  it('answers 503 to everyone while the secret is not configured', async () => {
    const res = await request(await buildApp()).post('/api/v1/internal/token-fee-sweep').set('x-sweep-secret', SECRET);

    expect(res.status).toBe(503);
    expect(stripeList).not.toHaveBeenCalled();
  });

  it('refuses a secret shorter than 24 characters even when presented correctly', async () => {
    process.env.TOKEN_FEE_SWEEP_SECRET = 'short';

    const res = await request(await buildApp()).post('/api/v1/internal/token-fee-sweep').set('x-sweep-secret', 'short');

    expect(res.status).toBe(503);
  });

  it('refuses a missing or wrong secret without running', async () => {
    process.env.TOKEN_FEE_SWEEP_SECRET = SECRET;
    const app = await buildApp();

    const missing = await request(app).post('/api/v1/internal/token-fee-sweep');
    const wrong = await request(app).post('/api/v1/internal/token-fee-sweep').set('x-sweep-secret', `${SECRET}x`);

    expect(missing.status).toBe(403);
    expect(wrong.status).toBe(403);
    expect(stripeList).not.toHaveBeenCalled();
  });

  it('runs the sweep for the right secret and returns the summary in the house shape', async () => {
    process.env.TOKEN_FEE_SWEEP_SECRET = SECRET;
    stripeIntents = [intent({}, 60 * 24)];

    const res = await request(await buildApp()).post('/api/v1/internal/token-fee-sweep').set('x-sweep-secret', SECRET);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, error: null });
    expect(res.body.data.scanned).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });
});

// ── Admin: Re-apply ─────────────────────────────────────────────────────────

describe('admin: Re-apply', () => {
  it('lets support re-apply a stuck transfer: ownership moves and the incident closes', async () => {
    const inc = openIncident();
    stripeRetrieve.mockResolvedValue(intent());

    const res = await call((await controller()).reapplyStuckPayment, makeReq(SUPPORT, 'support', { reason: REASON }, { id: inc.id }));

    expect(res.threw).toBeNull();
    expect(res.body).toMatchObject({ success: true, data: { status: 'RESOLVED', outcome: 'applied' } });
    expect(transfer().status).toBe('COMPLETED');
    expect(tag().current_owner_id).toBe(BUYER);
    expect(inc).toMatchObject({ status: 'RESOLVED', resolution: 'reapply', resolved_by: SUPPORT, resolved_reason: REASON });
  });

  it('asks Stripe first, for the incident’s own PaymentIntent', async () => {
    const inc = openIncident();
    stripeRetrieve.mockResolvedValue(intent());

    await call((await controller()).reapplyStuckPayment, makeReq(SUPPORT, 'support', { reason: REASON }, { id: inc.id }));

    expect(stripeRetrieve).toHaveBeenCalledWith(PI, { expand: ['latest_charge'] });
  });

  it('writes one audit row with the actor, the reason and the outcome', async () => {
    const inc = openIncident();
    stripeRetrieve.mockResolvedValue(intent());

    await call((await controller()).reapplyStuckPayment, makeReq(SUPPORT, 'support', { reason: REASON }, { id: inc.id }));

    expect(tables.audit_logs).toHaveLength(1);
    expect(tables.audit_logs[0]).toMatchObject({
      action: 'payment_reapply', entity_type: 'payment_incident', entity_id: inc.id, admin_id: SUPPORT, reason: REASON,
    });
    expect((tables.audit_logs[0].changes as Row).outcome).toBe('applied');
  });

  it('logs the completion with trigger=reapply and the admin as actor', async () => {
    const inc = openIncident();
    stripeRetrieve.mockResolvedValue(intent());

    await call((await controller()).reapplyStuckPayment, makeReq(SUPPORT, 'support', { reason: REASON }, { id: inc.id }));

    const completions = events('transfer.state_change').filter((e) => e.to === 'COMPLETED');
    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({ trigger: 'reapply', actor_id: SUPPORT, actor_type: 'admin' });
    expect(events('payment.reconcile')[0]).toMatchObject({ source: 'reapply', outcome: 'applied' });
    expect(events('admin.payment_action').at(-1)).toMatchObject({ action: 'reapply', incident_id: inc.id, result: 'ok' });
  });

  it('refuses when Stripe no longer shows the payment as paid', async () => {
    const inc = openIncident();
    stripeRetrieve.mockResolvedValue(intent({ status: 'canceled' }));

    const res = await call((await controller()).reapplyStuckPayment, makeReq(SUPPORT, 'support', { reason: REASON }, { id: inc.id }));

    expect(res.threw?.code).toBe('failed_precondition');
    expect(transfer().status).toBe('PENDING');
    expect(rpcCalls).toHaveLength(0);
  });

  it('refuses to apply a payment that has been refunded', async () => {
    const inc = openIncident();
    stripeRetrieve.mockResolvedValue(intent({ latest_charge: { created: nowSeconds, refunded: true, amount_refunded: 250 } }));

    const res = await call((await controller()).reapplyStuckPayment, makeReq(SUPPORT, 'support', { reason: REASON }, { id: inc.id }));

    expect(res.threw?.code).toBe('failed_precondition');
    expect(tag().current_owner_id).toBe(OWNER);
    expect(rpcCalls).toHaveLength(0);
  });

  it('refuses when the PaymentIntent names a different transfer than the incident', async () => {
    const inc = openIncident();
    stripeRetrieve.mockResolvedValue(intent({ metadata: { kind: 'token_transfer_fee', transfer_id: REQ_ID } }));

    const res = await call((await controller()).reapplyStuckPayment, makeReq(SUPPORT, 'support', { reason: REASON }, { id: inc.id }));

    expect(res.threw?.code).toBe('conflict');
    expect(transfer().status).toBe('PENDING');
    expect(rpcCalls).toHaveLength(0);
  });

  it('changes nothing when Stripe cannot be reached', async () => {
    const inc = openIncident();
    stripeRetrieve.mockRejectedValue(new Error('network'));

    const res = await call((await controller()).reapplyStuckPayment, makeReq(SUPPORT, 'support', { reason: REASON }, { id: inc.id }));

    expect(res.threw?.code).toBe('unavailable');
    expect(inc.status).toBe('OPEN');
    expect(rpcCalls).toHaveLength(0);
  });

  it('is idempotent: a second Re-apply on a closed incident is a conflict and moves nothing', async () => {
    const inc = openIncident();
    stripeRetrieve.mockResolvedValue(intent());
    const { reapplyStuckPayment } = await controller();
    await call(reapplyStuckPayment, makeReq(SUPPORT, 'support', { reason: REASON }, { id: inc.id }));
    const proofsAfterFirst = tables.ownership_proofs.length;

    const again = await call(reapplyStuckPayment, makeReq(SUPPORT, 'support', { reason: REASON }, { id: inc.id }));

    expect(again.threw?.code).toBe('conflict');
    expect(tables.ownership_proofs).toHaveLength(proofsAfterFirst);
    expect(tables.ownership_proofs.filter((p) => p.status === 'current')).toHaveLength(1);
    expect(tables.audit_logs).toHaveLength(1);
  });

  it('tells the admin why nothing moved, audits the attempt, and leaves the incident open', async () => {
    transfer().to_user_id = null;
    const inc = openIncident();
    stripeRetrieve.mockResolvedValue(intent());

    const res = await call((await controller()).reapplyStuckPayment, makeReq(SUPPORT, 'support', { reason: REASON }, { id: inc.id }));

    expect(res.threw?.code).toBe('conflict');
    expect(res.threw?.message).toMatch(/no recipient account yet/i);
    expect(inc).toMatchObject({ status: 'OPEN', last_error: 'reapply_no_recipient' });
    expect((tables.audit_logs[0].changes as Row).outcome).toBe('no_recipient');
    expect(events('transfer.state_change')).toHaveLength(0);
  });

  it('points to Refund when the transfer was cancelled after payment', async () => {
    transfer().status = 'CANCELLED';
    const inc = openIncident({ reason: 'not_payable' });
    stripeRetrieve.mockResolvedValue(intent());

    const res = await call((await controller()).reapplyStuckPayment, makeReq(SUPPORT, 'support', { reason: REASON }, { id: inc.id }));

    expect(res.threw?.message).toMatch(/refund it instead/i);
    expect(tag().current_owner_id).toBe(OWNER);
  });

  it('fails before touching the database when the salt key is missing', async () => {
    delete process.env.OWNERSHIP_SALT_KEY;
    const inc = openIncident();
    stripeRetrieve.mockResolvedValue(intent());

    const res = await call((await controller()).reapplyStuckPayment, makeReq(SUPPORT, 'support', { reason: REASON }, { id: inc.id }));

    expect(res.threw?.code).toBe('unavailable');
    expect(rpcCalls).toHaveLength(0);
    expect(transfer().status).toBe('PENDING');
  });

  it('requires a reason of at least 10 characters', async () => {
    const inc = openIncident();

    const res = await call((await controller()).reapplyStuckPayment, makeReq(SUPPORT, 'support', { reason: 'too short' }, { id: inc.id }));

    expect(res.threw?.code).toBe('invalid_argument');
    expect(stripeRetrieve).not.toHaveBeenCalled();
  });

  it('is refused by the database function for an actor who is not support, admin or super_admin', async () => {
    tables.admin_roles.push({ role_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', role_name: 'analyst', permissions: permissionsFor('analyst') });
    tables.admin_users[0].role_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const inc = openIncident();
    stripeRetrieve.mockResolvedValue(intent());

    // Even if the route gate were bypassed (role spoofed on the request).
    const res = await call((await controller()).reapplyStuckPayment, makeReq(SUPPORT, 'support', { reason: REASON }, { id: inc.id }));

    expect(res.threw?.code).toBe('permission_denied');
    expect(transfer().status).toBe('PENDING');
    expect(tables.audit_logs).toHaveLength(0);
  });

  it('marks a stuck re-issue fee PAID without fulfilling it, and emails the owner', async () => {
    tables.reissue_requests.push({
      id: REQ_ID, tag_id: TAG_ID, requester_id: OWNER, status: 'APPROVED', payment_status: 'AWAITING_PAYMENT',
      stripe_payment_intent_id: 'pi_reissue_654321', charged_amount: 1000, fulfilled_at: null,
    });
    const inc = openIncident({
      kind: 'reissue_fee', transfer_id: null, reissue_request_id: REQ_ID,
      stripe_payment_intent_id: 'pi_reissue_654321', reason: 'apply_failed', amount: 1000,
    });
    stripeRetrieve.mockResolvedValue(reissueIntent());

    const res = await call((await controller()).reapplyStuckPayment, makeReq(SUPPORT, 'support', { reason: REASON }, { id: inc.id }));

    expect(res.body).toMatchObject({ data: { outcome: 'applied' } });
    expect(tables.reissue_requests[0]).toMatchObject({ payment_status: 'PAID', fulfilled_at: null });
    expect(tag().current_owner_id).toBe(OWNER);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    // No proof is minted for a re-issue payment.
    expect(rpcCalls.find((c) => c.fn === 'admin_reapply_payment')?.args).toMatchObject({ p_ownership_id: null });
  });
});

// ── Admin: Refund ───────────────────────────────────────────────────────────

describe('admin: Refund', () => {
  const body = { reason: 'Transfer was cancelled after payment, refunding', confirmSuffix: '123456' };

  it('refunds through Stripe once, records it, and cancels the still-pending transfer', async () => {
    const inc = openIncident();
    stripeRetrieve.mockResolvedValue(intent());
    refundCreate.mockResolvedValue({ id: 're_test_1' });

    const res = await call((await controller()).refundStuckPayment, makeReq(ADMIN, 'admin', body, { id: inc.id }));

    expect(res.threw).toBeNull();
    expect(res.body).toMatchObject({ data: { status: 'REFUNDED', refundId: 're_test_1', transferCancelled: true } });
    expect(refundCreate).toHaveBeenCalledTimes(1);
    expect(refundCreate.mock.calls[0][0]).toMatchObject({ payment_intent: PI });
    expect(refundCreate.mock.calls[0][1]).toEqual({ idempotencyKey: `token-fee-refund-${String(inc.id)}` });
    expect(inc).toMatchObject({ status: 'REFUNDED', resolution: 'refund', stripe_refund_id: 're_test_1', resolved_by: ADMIN });
    expect(transfer().status).toBe('CANCELLED');
    // A refund never moves ownership.
    expect(tag().current_owner_id).toBe(OWNER);
    expect(tables.audit_logs[0]).toMatchObject({ action: 'payment_refund', admin_id: ADMIN });
  });

  it('is refused for support, before Stripe is asked for anything', async () => {
    const inc = openIncident();

    const res = await call((await controller()).refundStuckPayment, makeReq(SUPPORT, 'support', body, { id: inc.id }));

    expect(res.threw?.code).toBe('permission_denied');
    expect(stripeRetrieve).not.toHaveBeenCalled();
    expect(refundCreate).not.toHaveBeenCalled();
    expect(inc.status).toBe('OPEN');
  });

  it('is gated by permission at the route as well (refund_token_fees / reapply_payments)', async () => {
    const { requirePermission } = await import('../middleware/adminAuth');
    const run = (permission: 'refund_token_fees' | 'reapply_payments', role: string | null) => {
      const res = { code: 0, body: {} as Row, status(c: number) { this.code = c; return this; }, json(b: Row) { this.body = b; return this; } };
      let passed = false;
      requirePermission(permission)(
        { admin: role ? { role, permissions: permissionsFor(role) } : undefined } as never,
        res as never,
        () => { passed = true; },
      );
      return { passed, code: res.code, body: res.body };
    };

    expect(run('refund_token_fees', 'support')).toMatchObject({ passed: false, code: 403 });
    expect(run('refund_token_fees', 'admin').passed).toBe(true);
    expect(run('refund_token_fees', 'super_admin').passed).toBe(true);
    expect(run('reapply_payments', 'support').passed).toBe(true);
    expect(run('reapply_payments', 'moderator')).toMatchObject({ passed: false, code: 403 });
    expect(run('reapply_payments', 'analyst')).toMatchObject({ passed: false, code: 403 });
    expect(run('reapply_payments', null)).toMatchObject({ passed: false, code: 401 });
    // A 403 never lists what the admin holds.
    expect(JSON.stringify(run('refund_token_fees', 'support').body)).not.toContain('reapply_payments');
  });

  it('needs the last 6 characters of the payment id typed correctly', async () => {
    const inc = openIncident();

    const res = await call((await controller()).refundStuckPayment, makeReq(ADMIN, 'admin', { ...body, confirmSuffix: '654321' }, { id: inc.id }));

    expect(res.threw?.code).toBe('invalid_argument');
    expect(stripeRetrieve).not.toHaveBeenCalled();
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it('will not refund an incident that is already closed', async () => {
    const inc = openIncident({ status: 'RESOLVED', resolution: 'webhook', resolved_at: NOW.toISOString() });

    const res = await call((await controller()).refundStuckPayment, makeReq(ADMIN, 'admin', body, { id: inc.id }));

    expect(res.threw?.code).toBe('conflict');
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it('records an existing refund instead of asking Stripe for a second', async () => {
    const inc = openIncident();
    stripeRetrieve.mockResolvedValue(intent({ latest_charge: { created: nowSeconds, refunded: true, amount_refunded: 250 } }));
    refundList.mockResolvedValue({ data: [{ id: 're_made_by_hand' }] });

    const res = await call((await controller()).refundStuckPayment, makeReq(ADMIN, 'admin', body, { id: inc.id }));

    expect(refundCreate).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ data: { refundId: 're_made_by_hand' } });
    expect(inc.stripe_refund_id).toBe('re_made_by_hand');
  });

  it('changes nothing when Stripe rejects the refund', async () => {
    const inc = openIncident();
    stripeRetrieve.mockResolvedValue(intent());
    refundCreate.mockRejectedValue(new Error('card_declined: do not leak this'));

    const res = await call((await controller()).refundStuckPayment, makeReq(ADMIN, 'admin', body, { id: inc.id }));

    expect(res.threw?.code).toBe('unavailable');
    expect(res.threw?.message).not.toContain('card_declined');
    expect(inc.status).toBe('OPEN');
    expect(transfer().status).toBe('PENDING');
  });

  it('says so, and can be retried with the same key, when the refund went out but recording failed', async () => {
    const inc = openIncident();
    stripeRetrieve.mockResolvedValue(intent());
    refundCreate.mockResolvedValue({ id: 're_test_1' });
    const fake = feeDbFake(() => tables, rpcCalls);
    let failOnce = true;
    hooks.rpc = (fn, args) => {
      if (fn === 'admin_refund_payment_incident' && failOnce) {
        failOnce = false;
        return { data: null, error: { message: 'connection reset' } };
      }
      return fake(fn, args);
    };
    const { refundStuckPayment } = await controller();

    const first = await call(refundStuckPayment, makeReq(ADMIN, 'admin', body, { id: inc.id }));
    const second = await call(refundStuckPayment, makeReq(ADMIN, 'admin', body, { id: inc.id }));

    expect(first.threw?.message).toMatch(/refund was sent, but recording it failed/i);
    expect(second.threw).toBeNull();
    expect(refundCreate.mock.calls[0][1]).toEqual(refundCreate.mock.calls[1][1]);
    expect(inc.status).toBe('REFUNDED');
  });

  it('refunds a paid re-issue fee on a cancelled request and leaves the request alone', async () => {
    tables.reissue_requests.push({
      id: REQ_ID, tag_id: TAG_ID, requester_id: OWNER, status: 'CANCELLED', payment_status: 'AWAITING_PAYMENT',
      stripe_payment_intent_id: 'pi_reissue_654321', charged_amount: 1000,
    });
    const inc = openIncident({
      kind: 'reissue_fee', transfer_id: null, reissue_request_id: REQ_ID,
      stripe_payment_intent_id: 'pi_reissue_654321', reason: 'not_payable', amount: 1000,
    });
    stripeRetrieve.mockResolvedValue(reissueIntent());
    refundCreate.mockResolvedValue({ id: 're_reissue_1' });

    const res = await call((await controller()).refundStuckPayment, makeReq(ADMIN, 'admin', { ...body, confirmSuffix: '654321' }, { id: inc.id }));

    expect(res.body).toMatchObject({ data: { status: 'REFUNDED', transferCancelled: false } });
    expect(tables.reissue_requests[0]).toMatchObject({ status: 'CANCELLED', payment_status: 'AWAITING_PAYMENT' });
    expect(transfer().status).toBe('PENDING');
  });
});

// ── Admin: queue ────────────────────────────────────────────────────────────

describe('admin: queue', () => {
  it('lists open incidents with what they point at, and no personal data', async () => {
    openIncident();
    openIncident({ id: '88888888-8888-4888-8888-888888888888', stripe_payment_intent_id: 'pi_old', status: 'RESOLVED', resolution: 'webhook' });

    const res = await call((await controller()).listStuckPayments, makeReq(SUPPORT, 'support'));

    expect(res.body).toMatchObject({ success: true, error: null });
    const data = res.body.data as { items: Row[]; total: number; canRefund: boolean };
    expect(data.total).toBe(1);
    expect(data.items[0]).toMatchObject({
      kind: 'transfer_fee', reason: 'no_recipient', status: 'OPEN', paymentIntentId: PI, amount: 250,
      target: { tagId: TAG_ID, chipName: 'chip_009', status: 'PENDING', fulfilled: false },
    });
    expect(data.canRefund).toBe(false);
    const blob = JSON.stringify(res.body);
    expect(blob).not.toContain('@example.com');
    expect(blob).not.toContain('04A27E02936980');
  });

  it('tells an admin they may refund, and warns when nobody would be notified', async () => {
    const res = await call((await controller()).listStuckPayments, makeReq(ADMIN, 'admin', {}, {}, { status: 'ALL' }));

    expect(res.body.data).toMatchObject({ canRefund: true, githubIssuesConfigured: false, sweepConfigured: false });
  });

  it('rejects an unknown filter', async () => {
    const res = await call((await controller()).listStuckPayments, makeReq(SUPPORT, 'support', {}, {}, { status: 'EVERYTHING' }));

    expect(res.threw?.code).toBe('invalid_argument');
  });
});

// ── GitHub Issues ───────────────────────────────────────────────────────────

describe('GitHub Issue for the debug team', () => {
  const fee = { intentId: PI, kind: 'transfer_fee' as const, transferId: TRANSFER_ID, reissueRequestId: null, amount: 250, currency: 'usd' };
  const issueResponse = (n: number) => ({ ok: true, status: 201, json: async () => ({ number: n, html_url: `https://github.com/suprMan21/auctionX/issues/${n}` }) });
  const report = async () => (await import('../lib/payments/paymentIncidents')).reportStuckPayment;

  it('does not call GitHub at all without a token, and still records the incident', async () => {
    const row = await (await report())(createMockSupabase(tables, hooks) as never, fee, 'no_recipient', { requestId: 'req-1' });

    expect(row?.status).toBe('OPEN');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens one issue on the app repo for a new incident and stores its link', async () => {
    process.env.GITHUB_ISSUES_TOKEN = 'github_pat_test';
    fetchMock.mockResolvedValue(issueResponse(41));

    await (await report())(createMockSupabase(tables, hooks) as never, fee, 'no_recipient', { requestId: 'req-1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://api.github.com/repos/suprMan21/auctionX/issues');
    expect(init.headers.Authorization).toBe('Bearer github_pat_test');
    expect(JSON.parse(init.body).labels).toEqual(['stuck-payment']);
    expect(incidents()[0]).toMatchObject({ github_issue_number: 41, github_issue_url: 'https://github.com/suprMan21/auctionX/issues/41' });
  });

  it('puts ids in the issue and nothing personal', async () => {
    process.env.GITHUB_ISSUES_TOKEN = 'github_pat_test';
    fetchMock.mockResolvedValue(issueResponse(41));

    await (await report())(createMockSupabase(tables, hooks) as never, fee, 'no_recipient', { requestId: 'req-1', errorCode: 'apply_rpc_failed' });

    const sent = (fetchMock.mock.calls[0] as [string, { body: string }])[1].body;
    expect(sent).toContain(TRANSFER_ID);
    expect(sent).toContain(PI);
    expect(sent).toContain('req-1');
    expect(sent).not.toContain('@example.com');
    expect(sent).not.toContain(OWNER);
    expect(sent).not.toContain(BUYER);
    expect(sent).not.toContain('04A27E02936980');
  });

  it('does not open a second issue or spam comments when the same payment is seen again', async () => {
    process.env.GITHUB_ISSUES_TOKEN = 'github_pat_test';
    fetchMock.mockResolvedValue(issueResponse(41));
    const run = await report();

    await run(createMockSupabase(tables, hooks) as never, fee, 'no_recipient', { requestId: 'req-1' });
    await run(createMockSupabase(tables, hooks) as never, fee, 'no_recipient', { requestId: 'req-2' });
    await run(createMockSupabase(tables, hooks) as never, fee, 'no_recipient', { requestId: 'req-3' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(incidents()).toHaveLength(1);
    expect(incidents()[0].seen_count).toBe(3);
  });

  it('comments on the existing issue for a repeat once six hours have passed', async () => {
    process.env.GITHUB_ISSUES_TOKEN = 'github_pat_test';
    openIncident({
      github_issue_number: 41, github_issue_url: 'https://github.com/suprMan21/auctionX/issues/41',
      github_last_comment_at: new Date(Date.now() - 7 * 3600 * 1000).toISOString(),
    });
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 1 }) });

    await (await report())(createMockSupabase(tables, hooks) as never, fee, 'no_recipient', { requestId: 'req-9' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://api.github.com/repos/suprMan21/auctionX/issues/41/comments');
  });

  it('opens the issue on a later sighting when the first attempt failed', async () => {
    process.env.GITHUB_ISSUES_TOKEN = 'github_pat_test';
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) });
    const run = await report();
    await run(createMockSupabase(tables, hooks) as never, fee, 'no_recipient', { requestId: 'req-1' });
    expect(incidents()[0].github_issue_number).toBeNull();

    // The failed attempt's claim has gone stale.
    incidents()[0].github_claimed_at = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    fetchMock.mockResolvedValueOnce(issueResponse(42));
    await run(createMockSupabase(tables, hooks) as never, fee, 'no_recipient', { requestId: 'req-2' });

    expect(incidents()[0].github_issue_number).toBe(42);
  });

  it('lets only one of two concurrent sightings open the issue', async () => {
    process.env.GITHUB_ISSUES_TOKEN = 'github_pat_test';
    openIncident({ github_claimed_at: new Date().toISOString() });

    await (await report())(createMockSupabase(tables, hooks) as never, fee, 'no_recipient', { requestId: 'req-2' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never lets a GitHub outage fail the payment path', async () => {
    process.env.GITHUB_ISSUES_TOKEN = 'github_pat_test';
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));

    const row = await (await report())(createMockSupabase(tables, hooks) as never, fee, 'apply_failed', { requestId: 'req-1' });

    expect(row?.reason).toBe('apply_failed');
  });

  it('opens a ticket for a webhook the sweep had to cover for, marked as already applied', async () => {
    process.env.GITHUB_ISSUES_TOKEN = 'github_pat_test';
    fetchMock.mockResolvedValue(issueResponse(43));
    stripeIntents = [intent()];

    await (await sweep())(createMockSupabase(tables, hooks) as never, stripe as never, ctx, NOW);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body) as { title: string; body: string };
    expect(sent.title).toContain('webhook_missed');
    expect(sent.body).toMatch(/already applied/i);
  });

  it('never logs the token', async () => {
    process.env.GITHUB_ISSUES_TOKEN = 'github_pat_secret_value';
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await (await report())(createMockSupabase(tables, hooks) as never, fee, 'no_recipient', { requestId: 'req-1' });

    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('github_pat_secret_value');
    expect(logSpy.blob()).not.toContain('github_pat_secret_value');
  });
});

// ── The invariant ───────────────────────────────────────────────────────────

describe('COMPLETED only ever follows a verified payment', () => {
  it('allows exactly webhook, sweep and reapply as triggers for to=COMPLETED in these paths', async () => {
    // Sweep on one transfer...
    stripeIntents = [intent()];
    await (await sweep())(createMockSupabase(tables, hooks) as never, stripe as never, ctx, NOW);

    const completions = events('transfer.state_change').filter((e) => e.to === 'COMPLETED');
    expect(completions.length).toBeGreaterThan(0);
    expect(completions.every((e) => ['webhook', 'sweep', 'reapply'].includes(String(e.trigger)))).toBe(true);
    // ...and each one has a reconcile event with the same request id.
    for (const c of completions) {
      expect(events('payment.reconcile').some((r) => r.request_id === c.request_id && r.outcome === 'applied')).toBe(true);
    }
  });

  it('never applies anything without a Stripe-succeeded PaymentIntent in hand', async () => {
    // No intents from Stripe: the sweep has nothing to act on, whatever our rows say.
    stripeIntents = [];

    const summary = await (await sweep())(createMockSupabase(tables, hooks) as never, stripe as never, ctx, NOW);

    expect(summary.applied).toBe(0);
    expect(transfer().status).toBe('PENDING');
    expect(rpcCalls).toHaveLength(0);
  });
});
