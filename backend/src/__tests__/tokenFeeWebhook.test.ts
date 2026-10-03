import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes } from 'crypto';
import request from 'supertest';
import express from 'express';
import { createMockSupabase, resetMockIds, type Tables, type Row } from './helpers/supabaseMock';
import { spyOnSecurityEvents, type SecurityEventSpy } from './helpers/securityEvents';

/**
 * S-NFC3 — the token-fee webhook.
 *
 * This is the only path that may move a transfer to COMPLETED. The acceptance
 * criteria exercised here:
 *   - "Transfer completes only after webhook success"
 *   - "No transfer reaches COMPLETED without a transfer.state_change whose
 *      trigger=webhook"
 *   - an unsigned or badly-signed request changes nothing
 *   - a redelivered event is idempotent, not a double-apply
 */

const TAG_ID = '55555555-5555-4555-8555-555555555555';
const TRANSFER_ID = '66666666-6666-4666-8666-666666666666';
const OWNER = '11111111-1111-4111-8111-111111111111';
const BUYER = '22222222-2222-4222-8222-222222222222';

let tables: Tables;
let logSpy: SecurityEventSpy;

const constructEventAsync = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(tables),
}));

vi.mock('../lib/stripe', () => ({
  getStripe: () => ({ webhooks: { constructEventAsync } }),
}));

const succeededEvent = (overrides: Row = {}) => ({
  type: 'payment_intent.succeeded',
  id: 'evt_1',
  data: {
    object: {
      id: 'pi_test_123',
      metadata: { transfer_id: TRANSFER_ID, tag_id: TAG_ID, kind: 'token_transfer_fee' },
      ...overrides,
    },
  },
});

const buildApp = async () => {
  vi.resetModules();
  const { default: router } = await import('../routes/tokenFeeWebhook');
  const app = express();
  // Mirrors the raw mount in app.ts: signature verification needs the
  // unparsed bytes, so express.json() must never run first.
  app.use('/api/v1/webhooks/stripe-token-fees', express.raw({ type: 'application/json' }), router);
  return app;
};

const eventsNamed = (name: string) => logSpy.named(name);

const post = async (app: express.Express, body: Row = {}, signed = true) => {
  const req = request(app).post('/api/v1/webhooks/stripe-token-fees');
  if (signed) req.set('stripe-signature', 't=1,v1=deadbeef');
  return req.set('content-type', 'application/json').send(body as never);
};

beforeEach(() => {
  resetMockIds();
  constructEventAsync.mockReset();
  logSpy = spyOnSecurityEvents();
  vi.spyOn(console, 'error').mockImplementation(() => {});

  process.env.OWNERSHIP_SALT_KEY = randomBytes(32).toString('base64');
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  process.env.STRIPE_TOKEN_FEE_WEBHOOK_SECRET = 'whsec_test';

  tables = {
    nfc_tags: [{
      id: TAG_ID, tag_uid: '04A27E02936980', lifecycle_status: 'ACTIVE',
      current_owner_id: OWNER, sun_counter: 2,
    }],
    ownership_transfers: [{
      id: TRANSFER_ID, tag_id: TAG_ID, from_user_id: OWNER, to_user_id: BUYER,
      status: 'PENDING', stripe_payment_intent_id: 'pi_test_123',
    }],
    ownership_proofs: [{
      id: 'proof-1', tag_id: TAG_ID, ownership_id: `0x${'a'.repeat(64)}`,
      status: 'current', owner_id: OWNER,
    }],
    users: [
      { id: OWNER, role: 'user', email: 'owner@example.com', billing_country: 'US' },
      { id: BUYER, role: 'user', email: 'buyer@example.com', billing_country: 'US' },
    ],
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.STRIPE_TOKEN_FEE_WEBHOOK_SECRET;
});

const transfer = (): Row => tables.ownership_transfers[0];
const tag = (): Row => tables.nfc_tags[0];

describe('POST /api/v1/webhooks/stripe-token-fees', () => {
  it('leaves the transfer PENDING and asks Stripe to retry when the salt key is missing', async () => {
    // 2026-10-03 regression: minting used to run AFTER completion, so a missing
    // key left a COMPLETED transfer with no Ownership ID that no retry could fix.
    delete process.env.OWNERSHIP_SALT_KEY;
    constructEventAsync.mockResolvedValue(succeededEvent());
    const app = await buildApp();

    const res = await post(app);

    expect(res.status).toBe(500);
    expect(transfer().status).toBe('PENDING');
    expect(tag().current_owner_id).not.toBe(BUYER);
    expect(tables.ownership_proofs.filter((p) => p.status === 'current' && p.owner_id === BUYER)).toHaveLength(0);
  });

  it('completes the transfer and moves ownership on payment_intent.succeeded', async () => {
    constructEventAsync.mockResolvedValue(succeededEvent());
    const app = await buildApp();

    const res = await post(app);

    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(true);
    expect(transfer().status).toBe('COMPLETED');
    expect(transfer().transfer_fee_paid).toBe(true);
    expect(tag().current_owner_id).toBe(BUYER);
  });

  it('records the completion with trigger=webhook, and no other trigger ever does', async () => {
    constructEventAsync.mockResolvedValue(succeededEvent());
    const app = await buildApp();

    await post(app);

    const completions = eventsNamed('transfer.state_change').filter((e) => e.to === 'COMPLETED');
    expect(completions).toHaveLength(1);
    // S-SEC0 treats to=COMPLETED with trigger != webhook as Critical.
    expect(completions[0]).toMatchObject({ trigger: 'webhook', from: 'PENDING' });
    expect(eventsNamed('transfer.state_change').every(
      (e: Record<string, unknown>) => e.to !== 'COMPLETED' || e.trigger === 'webhook',
    )).toBe(true);
  });

  it('rotates the ownership proof to the new owner', async () => {
    constructEventAsync.mockResolvedValue(succeededEvent());
    const app = await buildApp();

    await post(app);

    const current = tables.ownership_proofs.filter((p) => p.status === 'current');
    expect(current).toHaveLength(1);
    expect(current[0].owner_id).toBe(BUYER);
    // The previous ID goes stale and is never linked to the new one publicly.
    expect(tables.ownership_proofs.find((p) => p.id === 'proof-1')?.status).toBe('stale');
    expect(current[0].ownership_id).not.toBe(`0x${'a'.repeat(64)}`);
  });

  it('rejects a request with no signature and changes nothing', async () => {
    const app = await buildApp();

    const res = await post(app, {}, false);

    expect(res.status).toBe(400);
    expect(transfer().status).toBe('PENDING');
    expect(eventsNamed('payment.webhook')[0]).toMatchObject({
      signature_valid: false, result: 'forbidden',
    });
  });

  it('rejects a bad signature and changes nothing', async () => {
    constructEventAsync.mockRejectedValue(new Error('No signatures found matching the expected signature'));
    const app = await buildApp();

    const res = await post(app);

    expect(res.status).toBe(400);
    expect(transfer().status).toBe('PENDING');
    expect(tag().current_owner_id).toBe(OWNER);
    expect(eventsNamed('payment.webhook')[0]).toMatchObject({ signature_valid: false });
  });

  it('refuses to act when the signing secret is not configured', async () => {
    delete process.env.STRIPE_TOKEN_FEE_WEBHOOK_SECRET;
    const app = await buildApp();

    const res = await post(app);

    expect(res.status).toBe(400);
    expect(transfer().status).toBe('PENDING');
  });

  it('is idempotent on a redelivered event', async () => {
    constructEventAsync.mockResolvedValue(succeededEvent());
    const app = await buildApp();

    await post(app);
    logSpy.clear();
    const res = await post(app);

    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(false);
    expect(res.body.reason).toBe('already_completed');
    expect(eventsNamed('payment.webhook')[0]).toMatchObject({ idempotent_replay: true });
    // Exactly one current proof — a double-apply would have minted a second.
    expect(tables.ownership_proofs.filter((p) => p.status === 'current')).toHaveLength(1);
  });

  it('ignores an event type other than payment_intent.succeeded', async () => {
    constructEventAsync.mockResolvedValue({
      type: 'payment_intent.payment_failed', id: 'evt_2',
      data: { object: { id: 'pi_test_123', metadata: { transfer_id: TRANSFER_ID, kind: 'token_transfer_fee' } } },
    });
    const app = await buildApp();

    const res = await post(app);

    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(false);
    expect(transfer().status).toBe('PENDING');
  });

  it('ignores a PaymentIntent from another flow', async () => {
    constructEventAsync.mockResolvedValue({
      type: 'payment_intent.succeeded', id: 'evt_3',
      data: { object: { id: 'pi_other', metadata: { kind: 'marketplace_settlement' } } },
    });
    const app = await buildApp();

    const res = await post(app);

    expect(res.body.applied).toBe(false);
    expect(transfer().status).toBe('PENDING');
  });

  it('refuses a succeeded intent that does not match the transfer row', async () => {
    constructEventAsync.mockResolvedValue(succeededEvent({ id: 'pi_someone_else' }));
    const app = await buildApp();

    const res = await post(app);

    expect(res.body.applied).toBe(false);
    expect(transfer().status).toBe('PENDING');
    expect(eventsNamed('payment.webhook')[0]).toMatchObject({ result: 'forbidden' });
  });

  it('will not complete a transfer that has no resolved recipient, and asks Stripe to retry', async () => {
    tables.ownership_transfers[0].to_user_id = null;
    constructEventAsync.mockResolvedValue(succeededEvent());
    const app = await buildApp();

    const res = await post(app);

    // Paid but unapplied: a 200 would drop the event for good (2026-10-03).
    expect(res.status).toBe(500);
    expect(res.body.applied).toBe(false);
    expect(transfer().status).toBe('PENDING');
  });

  it('applies on the retry once the recipient has been resolved', async () => {
    tables.ownership_transfers[0].to_user_id = null;
    constructEventAsync.mockResolvedValue(succeededEvent());
    const app = await buildApp();
    expect((await post(app)).status).toBe(500);

    tables.ownership_transfers[0].to_user_id = BUYER;
    const retry = await post(app);

    expect(retry.status).toBe(200);
    expect(retry.body.applied).toBe(true);
    expect(transfer().status).toBe('COMPLETED');
    expect(tag().current_owner_id).toBe(BUYER);
  });

  it('will not complete a CANCELLED transfer', async () => {
    tables.ownership_transfers[0].status = 'CANCELLED';
    constructEventAsync.mockResolvedValue(succeededEvent());
    const app = await buildApp();

    const res = await post(app);

    expect(res.body.applied).toBe(false);
    expect(transfer().status).toBe('CANCELLED');
    expect(tag().current_owner_id).toBe(OWNER);
  });

  it('emits no forbidden value in any webhook log line', async () => {
    constructEventAsync.mockResolvedValue(succeededEvent());
    const app = await buildApp();

    await post(app);

    const blob = logSpy.blob();
    expect(blob).not.toContain('whsec_test');
    expect(blob).not.toContain('04A27E02936980');
    expect(blob).not.toContain('owner@example.com');
    expect(blob).not.toContain('buyer@example.com');
  });
});
