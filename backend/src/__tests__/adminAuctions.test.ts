import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// ── Supabase mock harness ─────────────────────────────────────────────────────
//
// The controllers chain `.from(table).select(cols).eq(col, val).single()` etc., so we
// stub the chain by returning the same proxy on every chainable method and resolving the
// terminator (single/limit/range) from a per-table FIFO queue.

type Resolver = () => Promise<{ data: unknown; error: unknown }> | { data: unknown; error: unknown };

const responses = new Map<string, Resolver[]>();
let lastUpdatePayload: Record<string, unknown> | null = null;

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
  const passthrough = (...rest: any[]) => {
    // Update payload capture for assertions.
    if (rest.length > 0 && typeof rest[0] === 'object' && rest[0] !== null) {
      lastUpdatePayload = rest[0] as Record<string, unknown>;
    }
    return chain;
  };
  chain.select = passthrough;
  chain.insert = passthrough;
  chain.update = passthrough;
  chain.delete = passthrough;
  chain.upsert = passthrough;
  chain.eq = passthrough;
  chain.in = passthrough;
  chain.or = passthrough;
  chain.ilike = passthrough;
  chain.order = passthrough;
  chain.range = passthrough;
  // Terminators — resolve from queue.
  chain.single = async () => nextResolver(table)();
  chain.limit = async () => nextResolver(table)();
  chain.maybeSingle = async () => nextResolver(table)();
  // Also make the chain "then-able" so awaiting the chain directly (without an explicit
  // terminator) resolves from the queue, matching e.g. `await supabase.from().update().eq()`.
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
  createClient: () => ({
    from: (table: string) => buildChain(table),
  }),
}));

vi.mock('../lib/logger', () => ({
  withLogContext: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

process.env['SUPABASE_URL'] = 'http://localhost:54321';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key';

import {
  endAuction,
  cancelAuction,
} from '../controllers/adminAuctionsController';

function makeRes() {
  const res: Partial<Response> & { _status?: number; _json?: unknown } = {};
  res.status = vi.fn(function (this: Response, code: number) {
    (res as { _status?: number })._status = code;
    return this;
  }) as Response['status'];
  res.json = vi.fn(function (this: Response, body: unknown) {
    (res as { _json?: unknown })._json = body;
    return this;
  }) as Response['json'];
  return res as Response & { _status?: number; _json?: { success?: boolean; data?: unknown; error?: string; code?: string } };
}

function makeReq(overrides: Partial<Request> = {}) {
  return {
    requestId: 'test-req-id',
    path: '/admin/auctions/test',
    params: { id: 'a-1' },
    body: {},
    ...overrides,
  } as unknown as Request;
}

beforeEach(() => {
  responses.clear();
  lastUpdatePayload = null;
});

// ── endAuction ────────────────────────────────────────────────────────────────

describe('endAuction', () => {
  it('flips an ACTIVE auction to ENDED with updated end_time', async () => {
    // 1) select existing
    enqueue('auctions', () => ({ data: { id: 'a-1', status: 'ACTIVE' }, error: null }));
    // 2) update + select
    enqueue('auctions', () => ({
      data: { id: 'a-1', status: 'ENDED', end_time: '2026-05-20T00:00:00Z', updated_at: '2026-05-20T00:00:00Z' },
      error: null,
    }));
    const res = makeRes();
    await endAuction(makeReq() as Request & { requestId: string }, res);

    expect(res._status).toBeUndefined();
    expect(res._json).toEqual({
      success: true,
      data: expect.objectContaining({ id: 'a-1', status: 'ENDED' }),
    });
    expect(lastUpdatePayload).toMatchObject({ status: 'ENDED' });
  });

  it('rejects ending an auction that is not ACTIVE with failed_precondition (412)', async () => {
    enqueue('auctions', () => ({ data: { id: 'a-1', status: 'CANCELLED' }, error: null }));
    const res = makeRes();
    await endAuction(makeReq() as Request & { requestId: string }, res);
    expect(res._status).toBe(412);
    expect(res._json).toMatchObject({ success: false, code: 'failed_precondition' });
  });

  it('returns 404 when the auction does not exist', async () => {
    enqueue('auctions', () => ({ data: null, error: { code: 'PGRST116' } }));
    const res = makeRes();
    await endAuction(makeReq() as Request & { requestId: string }, res);
    expect(res._status).toBe(404);
    expect(res._json).toMatchObject({ success: false, code: 'not_found' });
  });
});

// ── cancelAuction ─────────────────────────────────────────────────────────────

describe('cancelAuction', () => {
  it('requires a non-empty reason', async () => {
    const res = makeRes();
    await cancelAuction(makeReq({ body: {} }) as Request & { requestId: string }, res);
    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ success: false, code: 'invalid_argument' });
  });

  it('cancels both auction and listing on the happy path', async () => {
    // select existing auction
    enqueue('auctions', () => ({ data: { id: 'a-1', status: 'ACTIVE', listing_id: 'L-1' }, error: null }));
    // settlements probe (empty)
    enqueue('settlements', () => ({ data: [], error: null }));
    // auction update
    enqueue('auctions', () => ({
      data: { id: 'a-1', status: 'CANCELLED', updated_at: '2026-05-20T00:00:00Z' },
      error: null,
    }));
    // listing update
    enqueue('listings', () => ({ data: { id: 'L-1', status: 'CANCELLED' }, error: null }));

    const res = makeRes();
    await cancelAuction(
      makeReq({ body: { reason: 'duplicate listing' } }) as Request & { requestId: string },
      res,
    );
    expect(res._status).toBeUndefined();
    expect(res._json).toEqual({
      success: true,
      data: expect.objectContaining({
        auction: expect.objectContaining({ status: 'CANCELLED' }),
        listing: expect.objectContaining({ status: 'CANCELLED' }),
        reason: 'duplicate listing',
      }),
    });
  });

  it('rejects cancelling a SETTLED auction', async () => {
    enqueue('auctions', () => ({ data: { id: 'a-1', status: 'SETTLED', listing_id: 'L-1' }, error: null }));
    const res = makeRes();
    await cancelAuction(
      makeReq({ body: { reason: 'oops' } }) as Request & { requestId: string },
      res,
    );
    expect(res._status).toBe(412);
    expect(res._json).toMatchObject({ success: false, code: 'failed_precondition' });
  });

  it('rejects cancelling when a settlement row already exists', async () => {
    enqueue('auctions', () => ({ data: { id: 'a-1', status: 'ENDED', listing_id: 'L-1' }, error: null }));
    enqueue('settlements', () => ({ data: [{ id: 's-1' }], error: null }));
    const res = makeRes();
    await cancelAuction(
      makeReq({ body: { reason: 'too late' } }) as Request & { requestId: string },
      res,
    );
    expect(res._status).toBe(412);
    expect(res._json).toMatchObject({ success: false, code: 'failed_precondition' });
  });

  it('rolls back the auction update when the listing update fails', async () => {
    enqueue('auctions', () => ({ data: { id: 'a-1', status: 'ACTIVE', listing_id: 'L-1' }, error: null }));
    enqueue('settlements', () => ({ data: [], error: null }));
    enqueue('auctions', () => ({
      data: { id: 'a-1', status: 'CANCELLED', updated_at: '2026-05-20T00:00:00Z' },
      error: null,
    }));
    // Listing update fails.
    enqueue('listings', () => ({ data: null, error: { message: 'boom' } }));
    // Rollback update (terminator is `await` on the chain itself, no select+single).
    enqueue('auctions', () => ({ error: null, data: null }));

    const res = makeRes();
    await cancelAuction(
      makeReq({ body: { reason: 'racing condition' } }) as Request & { requestId: string },
      res,
    );
    expect(res._status).toBe(500);
    expect(res._json).toMatchObject({ success: false, code: 'internal' });
  });
});
