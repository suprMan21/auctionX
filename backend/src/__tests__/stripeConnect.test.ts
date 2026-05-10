import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const accountsCreateMock = vi.fn();
const accountsRetrieveMock = vi.fn();
const accountLinksCreateMock = vi.fn();
const constructEventAsyncMock = vi.fn();

vi.mock('../lib/stripe', () => ({
  getStripe: () => ({
    accounts: { create: accountsCreateMock, retrieve: accountsRetrieveMock },
    accountLinks: { create: accountLinksCreateMock },
    webhooks: { constructEventAsync: constructEventAsyncMock },
  }),
}));

let mockUserRow: Record<string, unknown> | null = { stripe_connect_account_id: null };
const updateMock = vi.fn(async () => ({ error: null, count: 1 }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: mockUserRow, error: null }),
        }),
      }),
      update: () => ({
        eq: updateMock,
      }),
    }),
  }),
}));

// Logger is not interesting for these tests; let it pass through.
vi.mock('../lib/logger', () => ({
  withLogContext: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

// Set required env BEFORE importing the controller so getServiceClient builds.
process.env['SUPABASE_URL'] = 'http://localhost:54321';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key';
process.env['FRONTEND_URL'] = 'http://localhost:5173';

import {
  createOnboardingLink,
  getConnectStatus,
  applyAccountUpdate,
} from '../controllers/stripeConnectController';

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
  return res as Response & { _status?: number; _json?: { success: boolean; data?: unknown; error?: string } };
}

function makeReq(overrides: Partial<Request> & { user?: { id: string; email?: string } } = {}) {
  return {
    requestId: 'test-req-id',
    path: '/stripe-connect/test',
    user: overrides.user ?? { id: 'user-1', email: 'seller@example.com' },
    ...overrides,
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUserRow = { stripe_connect_account_id: null };
});

// ── createOnboardingLink ──────────────────────────────────────────────────────

describe('createOnboardingLink', () => {
  it('creates a Stripe Express account on first call and returns onboarding URL', async () => {
    accountsCreateMock.mockResolvedValueOnce({ id: 'acct_test_123' });
    accountLinksCreateMock.mockResolvedValueOnce({ url: 'https://stripe.com/onboarding/abc' });

    const req = makeReq();
    const res = makeRes();
    await createOnboardingLink(req as never, res);

    expect(accountsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'express',
        country: 'CA',
        email: 'seller@example.com',
      }),
    );
    expect(accountLinksCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        account: 'acct_test_123',
        type: 'account_onboarding',
        return_url: 'http://localhost:5173/settings/payouts?return=1',
      }),
    );
    expect(res._json).toEqual({
      success: true,
      data: { url: 'https://stripe.com/onboarding/abc' },
    });
  });

  it('reuses existing Stripe account if user already has one', async () => {
    mockUserRow = { stripe_connect_account_id: 'acct_existing_999' };
    accountLinksCreateMock.mockResolvedValueOnce({ url: 'https://stripe.com/onboarding/xyz' });

    const req = makeReq();
    const res = makeRes();
    await createOnboardingLink(req as never, res);

    expect(accountsCreateMock).not.toHaveBeenCalled();
    expect(accountLinksCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ account: 'acct_existing_999' }),
    );
  });

  it('returns 401 when user is unauthenticated', async () => {
    const req = makeReq({ user: undefined });
    const res = makeRes();
    await createOnboardingLink(req as never, res);

    expect(res._status).toBe(401);
    expect((res._json as { success: boolean }).success).toBe(false);
  });
});

// ── getConnectStatus ──────────────────────────────────────────────────────────

describe('getConnectStatus', () => {
  it('returns not_started for a user with no Connect account', async () => {
    mockUserRow = {
      stripe_connect_account_id: null,
      stripe_connect_charges_enabled: false,
      stripe_connect_payouts_enabled: false,
      stripe_connect_onboarding_started_at: null,
    };

    const req = makeReq();
    const res = makeRes();
    await getConnectStatus(req as never, res);

    expect(accountsRetrieveMock).not.toHaveBeenCalled();
    expect((res._json as { data: { status: string } }).data.status).toBe('not_started');
  });

  it('returns active when both flags are true', async () => {
    mockUserRow = {
      stripe_connect_account_id: 'acct_x',
      stripe_connect_charges_enabled: true,
      stripe_connect_payouts_enabled: true,
      stripe_connect_onboarding_started_at: '2026-05-09T00:00:00Z',
    };

    const req = makeReq();
    const res = makeRes();
    await getConnectStatus(req as never, res);

    expect(accountsRetrieveMock).not.toHaveBeenCalled();
    expect((res._json as { data: { status: string } }).data.status).toBe('active');
  });

  it('lazily refreshes from Stripe when stored flags are stale', async () => {
    mockUserRow = {
      stripe_connect_account_id: 'acct_stale',
      stripe_connect_charges_enabled: false,
      stripe_connect_payouts_enabled: false,
      stripe_connect_onboarding_started_at: '2026-05-09T00:00:00Z',
    };
    accountsRetrieveMock.mockResolvedValueOnce({
      charges_enabled: true,
      payouts_enabled: true,
      requirements: { disabled_reason: null },
    });

    const req = makeReq();
    const res = makeRes();
    await getConnectStatus(req as never, res);

    expect(accountsRetrieveMock).toHaveBeenCalledWith('acct_stale');
    expect((res._json as { data: { status: string } }).data.status).toBe('active');
  });

  it('returns restricted when Stripe reports a disabled_reason', async () => {
    mockUserRow = {
      stripe_connect_account_id: 'acct_restricted',
      stripe_connect_charges_enabled: false,
      stripe_connect_payouts_enabled: false,
      stripe_connect_onboarding_started_at: '2026-05-09T00:00:00Z',
    };
    accountsRetrieveMock.mockResolvedValueOnce({
      charges_enabled: false,
      payouts_enabled: false,
      requirements: { disabled_reason: 'requirements.past_due' },
    });

    const req = makeReq();
    const res = makeRes();
    await getConnectStatus(req as never, res);

    const data = (res._json as { data: { status: string; disabledReason: string | null } }).data;
    expect(data.status).toBe('restricted');
    expect(data.disabledReason).toBe('requirements.past_due');
  });
});

// ── applyAccountUpdate ────────────────────────────────────────────────────────

describe('applyAccountUpdate', () => {
  it('updates the user row keyed by stripe_connect_account_id', async () => {
    const account = {
      id: 'acct_update_1',
      charges_enabled: true,
      payouts_enabled: true,
    } as never;

    const result = await applyAccountUpdate(account);

    expect(updateMock).toHaveBeenCalledWith('stripe_connect_account_id', 'acct_update_1');
    expect(result.updated).toBe(true);
  });
});
