/**
 * S25 Dispute Resolution vitest suite.
 *
 * Covers:
 *   - openDispute happy path persists evidence_urls + transitions to DISPUTED
 *   - openDispute rejects when caller is not the buyer
 *   - openDispute rejects when settlement is not ESCROW_HOLD
 *   - openDispute validates evidence_urls (non-S3 → 400)
 *   - admin approve FULL_REFUND calls Stripe refund (no amount) + transitions to REFUNDED
 *   - admin approve PARTIAL_REFUND calls Stripe refund with the partial amount
 *   - admin approve PARTIAL_REFUND rejects when amount >= gross (must use FULL)
 *   - admin approve with Stripe failure → 502 + state unchanged
 *   - admin reject sets appeal_deadline = now + 7d + resolution_action = REJECTED
 *
 * All mocked — no live Stripe, no live DB.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// ── Supabase mock harness (mirrors yotiVerification.test.ts) ─────────────────
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
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  const captureUpdate = (payload: unknown) => {
    if (payload && typeof payload === 'object') {
      (updatePayloads[table] = updatePayloads[table] ?? []).push(payload as Record<string, unknown>);
    }
    return chain;
  };
  const captureInsert = (payload: unknown) => {
    if (payload && typeof payload === 'object') {
      (insertPayloads[table] = insertPayloads[table] ?? []).push(payload as Record<string, unknown>);
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
  chain.order = passthrough;
  chain.range = passthrough;
  chain.single = async () => nextResolver(table)();
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

// ── Stripe SDK mock ──────────────────────────────────────────────────────────
const { stripeMock } = vi.hoisted(() => ({
  stripeMock: {
    lastRefundParams: null as { payment_intent?: string; amount?: number; reason?: string; metadata?: Record<string, string> } | null,
    shouldFail: false,
    failureMessage: 'card_declined',
    nextRefundId: 're_test_001',
  },
}));

vi.mock('../lib/stripe', () => ({
  getStripe: () => ({
    refunds: {
      create: async (params: { payment_intent?: string; amount?: number; reason?: string; metadata?: Record<string, string> }) => {
        stripeMock.lastRefundParams = params;
        if (stripeMock.shouldFail) {
          throw new Error(stripeMock.failureMessage);
        }
        return {
          id: stripeMock.nextRefundId,
          amount: params.amount ?? 5000,
          status: 'succeeded',
        };
      },
    },
  }),
}));

// Suppress logger output during tests.
vi.mock('../lib/logger', () => ({
  log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  withLogContext: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

// Spy notificationService so emails don't try to read users/notification_preferences.
const { notificationSendBatchSpy } = vi.hoisted(() => ({
  notificationSendBatchSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/notifications/notificationService', () => ({
  notificationService: {
    send: vi.fn().mockResolvedValue(undefined),
    sendBatch: notificationSendBatchSpy,
  },
}));

// Mock the auditLog middleware to be a no-op.
vi.mock('../middleware/auditLog', () => ({
  auditLog: () => (_req: Request, _res: Response, next: () => void) => next(),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeRes() {
  const res: Partial<Response> & { _status: number; _body: unknown } = {
    _status: 200,
    _body: undefined,
  };
  res.status = ((code: number) => {
    res._status = code;
    return res as Response;
  }) as Response['status'];
  res.json = ((body: unknown) => {
    res._body = body;
    return res as Response;
  }) as Response['json'];
  return res as Response & { _status: number; _body: unknown };
}

function resetHarness() {
  responses.clear();
  for (const key of Object.keys(updatePayloads)) delete updatePayloads[key];
  for (const key of Object.keys(insertPayloads)) delete insertPayloads[key];
  stripeMock.lastRefundParams = null;
  stripeMock.shouldFail = false;
  notificationSendBatchSpy.mockClear();
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test_key';
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.AWS_S3_BUCKET = 'auctionx-media-prod-cl';
}

// ── openDispute (buyer) ──────────────────────────────────────────────────────
describe('openDispute', () => {
  beforeEach(() => {
    resetHarness();
  });

  it('opens a dispute on ESCROW_HOLD settlement and persists evidence_urls', async () => {
    const { openDispute } = await import('../controllers/payoutController');

    enqueue('settlements', () => ({
      data: {
        id: 's1',
        buyer_id: 'buyer1',
        seller_id: 'seller1',
        status: 'ESCROW_HOLD',
        auction_id: 'a1',
      },
      error: null,
    }));
    enqueue('settlements', () => ({ data: null, error: null }));
    enqueue('moderation_queue', () => ({ data: null, error: null }));

    const req = {
      user: { id: 'buyer1' },
      params: { id: 's1' },
      body: {
        reason: 'The item never arrived after 30 days of waiting.',
        evidence_urls: [
          'https://auctionx-media-prod-cl.s3.us-east-2.amazonaws.com/disputes/s1/buyer1/1234.jpg',
        ],
      },
      path: '/test',
      requestId: 'r1',
    } as unknown as Parameters<typeof openDispute>[0];

    const res = makeRes();
    await openDispute(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ success: true });

    const settlementUpdates = updatePayloads['settlements'] ?? [];
    expect(settlementUpdates).toHaveLength(1);
    expect(settlementUpdates[0]).toMatchObject({
      status: 'DISPUTED',
      evidence_urls: expect.arrayContaining([
        expect.stringContaining('auctionx-media-prod-cl.s3'),
      ]),
    });
    expect(notificationSendBatchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects when caller is not the buyer', async () => {
    const { openDispute } = await import('../controllers/payoutController');

    enqueue('settlements', () => ({
      data: {
        id: 's1',
        buyer_id: 'buyer1',
        seller_id: 'seller1',
        status: 'ESCROW_HOLD',
        auction_id: 'a1',
      },
      error: null,
    }));

    const req = {
      user: { id: 'someone_else' },
      params: { id: 's1' },
      body: { reason: 'I am not the buyer but trying to open a dispute anyway.' },
      path: '/test',
      requestId: 'r2',
    } as unknown as Parameters<typeof openDispute>[0];

    const res = makeRes();
    await openDispute(req, res);

    expect(res._status).toBe(403);
    expect((res._body as { code: string }).code).toBe('permission_denied');
  });

  it('rejects when settlement is not ESCROW_HOLD', async () => {
    const { openDispute } = await import('../controllers/payoutController');

    enqueue('settlements', () => ({
      data: {
        id: 's1',
        buyer_id: 'buyer1',
        seller_id: 'seller1',
        status: 'PENDING_PAYMENT',
        auction_id: 'a1',
      },
      error: null,
    }));

    const req = {
      user: { id: 'buyer1' },
      params: { id: 's1' },
      body: { reason: 'Trying to dispute before payment lands which is not allowed.' },
      path: '/test',
      requestId: 'r3',
    } as unknown as Parameters<typeof openDispute>[0];

    const res = makeRes();
    await openDispute(req, res);

    expect(res._status).toBe(409);
    expect((res._body as { code: string }).code).toBe('conflict');
  });

  it('rejects non-S3 evidence URLs with 400', async () => {
    const { openDispute } = await import('../controllers/payoutController');

    const req = {
      user: { id: 'buyer1' },
      params: { id: 's1' },
      body: {
        reason: 'Item never arrived, very upset, want a refund please.',
        evidence_urls: ['https://evil.example.com/phish.jpg'],
      },
      path: '/test',
      requestId: 'r4',
    } as unknown as Parameters<typeof openDispute>[0];

    const res = makeRes();
    await openDispute(req, res);

    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toMatch(/S3/);
  });
});

// ── Admin approve/reject ─────────────────────────────────────────────────────
type RouterStackLayer = {
  route?: {
    path: string;
    stack: Array<{
      handle: (req: Request, res: Response, next?: () => void) => Promise<void> | void;
    }>;
  };
};

async function findRouteHandler(
  path: string,
): Promise<(req: Request, res: Response) => Promise<void>> {
  const disputesRouter = (await import('../routes/admin/disputes')).default;
  const stack = (disputesRouter as unknown as { stack: RouterStackLayer[] }).stack;
  const layer = stack.find((l) => l.route?.path === path);
  if (!layer?.route) {
    throw new Error(`No route registered for path=${path}`);
  }
  const handler = layer.route.stack.slice(-1)[0]?.handle;
  if (!handler) {
    throw new Error(`No handler on route ${path}`);
  }
  return handler as (req: Request, res: Response) => Promise<void>;
}

async function callApprove(body: Record<string, unknown>) {
  const handler = await findRouteHandler('/:settlementId/approve');
  const req = {
    user: { id: 'admin1' },
    params: { settlementId: 's1' },
    body,
  } as unknown as Request;
  const res = makeRes();
  await handler(req, res);
  return res;
}

async function callReject(body: Record<string, unknown>) {
  const handler = await findRouteHandler('/:settlementId/reject');
  const req = {
    user: { id: 'admin1' },
    params: { settlementId: 's1' },
    body,
  } as unknown as Request;
  const res = makeRes();
  await handler(req, res);
  return res;
}

describe('admin approve dispute', () => {
  beforeEach(() => {
    resetHarness();
  });

  it('FULL_REFUND calls Stripe with no amount and transitions to REFUNDED', async () => {
    // loadDisputedSettlement
    enqueue('settlements', () => ({
      data: {
        id: 's1',
        status: 'DISPUTED',
        buyer_id: 'buyer1',
        seller_id: 'seller1',
        gross_amount_cents: 5000,
        transaction_id: 't1',
        escrow_ends_at: '2026-06-15T00:00:00Z',
      },
      error: null,
    }));
    // refundSettlement → settlements lookup
    enqueue('settlements', () => ({
      data: { id: 's1', transaction_id: 't1', gross_amount_cents: 5000 },
      error: null,
    }));
    // refundSettlement → transactions lookup
    enqueue('transactions', () => ({
      data: { id: 't1', successful_processor: 'STRIPE', successful_payment_id: 'pi_test_123' },
      error: null,
    }));
    // refunds insert
    enqueue('refunds', () => ({ data: null, error: null }));
    // settlements update
    enqueue('settlements', () => ({ data: null, error: null }));

    const res = await callApprove({
      action: 'FULL_REFUND',
      notes: 'Item never arrived after 60 days, refunding in full.',
    });

    expect(res._status).toBe(200);
    expect((res._body as { status: string }).status).toBe('REFUNDED');
    expect(stripeMock.lastRefundParams).toMatchObject({
      payment_intent: 'pi_test_123',
      reason: 'requested_by_customer',
    });
    expect(stripeMock.lastRefundParams?.amount).toBeUndefined(); // full refund → no amount
    const settlementUpdates = updatePayloads['settlements'] ?? [];
    expect(settlementUpdates.at(-1)).toMatchObject({
      status: 'REFUNDED',
      resolution_action: 'FULL_REFUND',
      processor_refund_id: 're_test_001',
    });
  });

  it('PARTIAL_REFUND calls Stripe with partial amount', async () => {
    enqueue('settlements', () => ({
      data: {
        id: 's1',
        status: 'DISPUTED',
        buyer_id: 'buyer1',
        seller_id: 'seller1',
        gross_amount_cents: 5000,
        transaction_id: 't1',
        escrow_ends_at: '2026-06-15T00:00:00Z',
      },
      error: null,
    }));
    enqueue('settlements', () => ({
      data: { id: 's1', transaction_id: 't1', gross_amount_cents: 5000 },
      error: null,
    }));
    enqueue('transactions', () => ({
      data: { id: 't1', successful_processor: 'STRIPE', successful_payment_id: 'pi_test_123' },
      error: null,
    }));
    enqueue('refunds', () => ({ data: null, error: null }));
    enqueue('settlements', () => ({ data: null, error: null }));

    const res = await callApprove({
      action: 'PARTIAL_REFUND',
      partial_amount_cents: 2000,
      notes: 'Half refund — buyer accepted compromise.',
    });

    expect(res._status).toBe(200);
    expect(stripeMock.lastRefundParams).toMatchObject({
      payment_intent: 'pi_test_123',
      amount: 2000,
    });
    const settlementUpdates = updatePayloads['settlements'] ?? [];
    expect(settlementUpdates.at(-1)).toMatchObject({
      resolution_action: 'PARTIAL_REFUND',
      partial_refund_amount_cents: 2000,
    });
  });

  it('PARTIAL_REFUND with amount >= gross is rejected with 400', async () => {
    enqueue('settlements', () => ({
      data: {
        id: 's1',
        status: 'DISPUTED',
        buyer_id: 'buyer1',
        seller_id: 'seller1',
        gross_amount_cents: 5000,
        transaction_id: 't1',
        escrow_ends_at: '2026-06-15T00:00:00Z',
      },
      error: null,
    }));

    const res = await callApprove({
      action: 'PARTIAL_REFUND',
      partial_amount_cents: 5000,
      notes: 'Trying partial for the full amount which is wrong.',
    });

    expect(res._status).toBe(400);
    expect(stripeMock.lastRefundParams).toBeNull();
  });

  it('Stripe failure leaves settlement unchanged and returns 502', async () => {
    stripeMock.shouldFail = true;

    enqueue('settlements', () => ({
      data: {
        id: 's1',
        status: 'DISPUTED',
        buyer_id: 'buyer1',
        seller_id: 'seller1',
        gross_amount_cents: 5000,
        transaction_id: 't1',
        escrow_ends_at: '2026-06-15T00:00:00Z',
      },
      error: null,
    }));
    enqueue('settlements', () => ({
      data: { id: 's1', transaction_id: 't1', gross_amount_cents: 5000 },
      error: null,
    }));
    enqueue('transactions', () => ({
      data: { id: 't1', successful_processor: 'STRIPE', successful_payment_id: 'pi_test_123' },
      error: null,
    }));

    const res = await callApprove({
      action: 'FULL_REFUND',
      notes: 'Trying a full refund but Stripe is going to barf.',
    });

    expect(res._status).toBe(502);
    expect((res._body as { code: string }).code).toBe('STRIPE_ERROR');
    // No settlements update should have happened.
    expect(updatePayloads['settlements'] ?? []).toHaveLength(0);
  });
});

describe('admin reject dispute', () => {
  beforeEach(() => {
    resetHarness();
  });

  it('sets appeal_deadline = now + 7d and resolution_action = REJECTED', async () => {
    enqueue('settlements', () => ({
      data: {
        id: 's1',
        status: 'DISPUTED',
        buyer_id: 'buyer1',
        seller_id: 'seller1',
        gross_amount_cents: 5000,
        transaction_id: 't1',
        escrow_ends_at: '2026-06-08T00:00:00Z',
      },
      error: null,
    }));
    enqueue('settlements', () => ({ data: null, error: null }));

    const res = await callReject({
      notes: 'Buyer evidence inconclusive, denying the dispute claim.',
    });

    expect(res._status).toBe(200);
    expect((res._body as { resolutionAction: string }).resolutionAction).toBe('REJECTED');

    const settlementUpdates = updatePayloads['settlements'] ?? [];
    expect(settlementUpdates).toHaveLength(1);
    const upd = settlementUpdates[0];
    expect(upd).toMatchObject({
      status: 'ESCROW_HOLD',
      resolution_action: 'REJECTED',
    });
    expect(typeof upd.appeal_deadline).toBe('string');

    // Verify the deadline is ~7 days out (allow 1 minute slack for test execution).
    const deadline = new Date(upd.appeal_deadline as string).getTime();
    const expected = Date.now() + 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(deadline - expected)).toBeLessThan(60_000);
  });
});
