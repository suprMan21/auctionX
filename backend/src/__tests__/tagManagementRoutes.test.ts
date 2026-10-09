import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

/**
 * S-NFC3 — route surface.
 *
 * Proves the endpoints are mounted, ordered correctly, and gated. It does NOT
 * exercise database behaviour: these run without Supabase credentials, so every
 * assertion stops at the auth boundary or the route-matching boundary, which is
 * exactly what this file is for.
 *
 * Route-ordering matters here in two specific ways, both of which have bitten
 * this project before (lesson #5, static routes before parameterized):
 *   - `/transfer/initiate` must not be swallowed by `/transfer/:id/...`
 *   - the S-NFC3 static routes must not be swallowed by the pre-existing
 *     `GET /:tagId` in routes/nfc.ts
 */

const isUnmounted = (res: { status: number; body?: Record<string, unknown> }): boolean =>
  res.status === 404 && res.body?.error === 'Not found' && res.body?.success === undefined;

const loadApp = async () => {
  vi.resetModules();
  const { createApp } = await import('../app');
  return createApp();
};

type Probe = { status: number; body?: Record<string, unknown> };

const UUID = '00000000-0000-4000-8000-000000000000';

describe('S-NFC3 tag management routes', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // The marketplace stays parked: S-NFC3 is token-platform surface and must
    // be reachable with FEATURE_MARKETPLACE off.
    delete process.env.FEATURE_MARKETPLACE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const TOKEN_ROUTES = [
    { method: 'post', path: '/api/v1/nfc/enroll' },
    { method: 'get', path: '/api/v1/nfc/enroll/precheck/04A27E02936980' },
    { method: 'post', path: '/api/v1/nfc/claim' },
    { method: 'post', path: '/api/v1/nfc/release' },
    { method: 'post', path: '/api/v1/nfc/replace' },
    { method: 'post', path: '/api/v1/nfc/reissue-request' },
    // S-ADMIN1 Ph2 owner re-issue: photo upload URL, list, pay, cancel.
    { method: 'post', path: '/api/v1/nfc/reissue-request/photo-url' },
    { method: 'get', path: '/api/v1/nfc/reissue-requests/mine' },
    { method: 'post', path: `/api/v1/nfc/reissue-requests/${UUID}/pay` },
    { method: 'post', path: `/api/v1/nfc/reissue-requests/${UUID}/cancel` },
    { method: 'post', path: '/api/v1/nfc/transfer/initiate' },
    { method: 'post', path: `/api/v1/nfc/transfer/${UUID}/complete` },
    { method: 'post', path: `/api/v1/nfc/transfer/${UUID}/cancel` },
    { method: 'patch', path: `/api/v1/nfc/${UUID}/disclosure` },
    // S-NFC3-FE reads — the caller's own data, so also behind requireAuth.
    { method: 'get', path: '/api/v1/nfc/mine' },
    { method: 'get', path: '/api/v1/nfc/transfers/incoming' },
    { method: 'get', path: `/api/v1/nfc/transfer/${UUID}` },
    { method: 'get', path: `/api/v1/nfc/${UUID}/receipt` },
  ] as const;

  it.each(TOKEN_ROUTES)('mounts $method $path with the marketplace parked', async ({ method, path }) => {
    const app = await loadApp();
    const res: Probe = await (request(app) as never as Record<string, (p: string) => Promise<Probe>>)[method](path);

    expect(isUnmounted(res)).toBe(false);
  });

  it.each(TOKEN_ROUTES)('requires authentication on $method $path', async ({ method, path }) => {
    const app = await loadApp();
    const res: Probe = await (request(app) as never as Record<string, (p: string) => Promise<Probe>>)[method](path);

    // Every ownership-mutating route sits behind requireAuth.
    expect(res.status).toBe(401);
  });

  it('keeps the parked one-sided POST /nfc/transfer unmounted', async () => {
    const app = await loadApp();
    const res: Probe = await request(app).post('/api/v1/nfc/transfer');

    // Leaving it live would be a free path around the $2.50 transfer fee.
    expect(isUnmounted(res)).toBe(true);
  });

  it('keeps the parked /nfc/register and /nfc/mint unmounted', async () => {
    const app = await loadApp();

    expect(isUnmounted(await request(app).post('/api/v1/nfc/register'))).toBe(true);
    // "No NFTs, ever" (Locked, 2026-09-18).
    expect(isUnmounted(await request(app).post('/api/v1/nfc/mint'))).toBe(true);
  });

  it('does not match /transfer/initiate as a transfer id', async () => {
    const app = await loadApp();
    // If ordering were wrong, this would fall through to /transfer/:id/... and
    // never reach the initiate handler. requireAuth answering 401 proves it
    // matched a real route rather than the catch-all.
    const res: Probe = await request(app).post('/api/v1/nfc/transfer/initiate');

    expect(isUnmounted(res)).toBe(false);
    expect(res.status).toBe(401);
  });

  it('does not let /nfc/mine fall through to the legacy GET /nfc/:tagId', async () => {
    const app = await loadApp();
    // The legacy public route would answer without auth; 401 proves the
    // static S-NFC3-FE route matched first.
    const res: Probe = await request(app).get('/api/v1/nfc/mine');
    expect(res.status).toBe(401);
  });

  it('mounts POST /nfc/tap publicly (a bad body is a 400, never a 401)', async () => {
    const app = await loadApp();
    const res: Probe = await request(app).post('/api/v1/nfc/tap').send({});

    expect(isUnmounted(res)).toBe(false);
    expect(res.status).toBe(400);
    expect(res.body?.success).toBe(false);
  });

  it('treats a bad bearer token on /nfc/tap as anonymous, not 401', async () => {
    const app = await loadApp();
    const res: Probe = await request(app)
      .post('/api/v1/nfc/tap')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({});

    expect(res.status).toBe(400);
  });

  it('never sends an internal error message to the client', async () => {
    // A parseable SUN URL with no Supabase env reaches createClient, which
    // throws a plain Error ("supabaseUrl is required"): exactly the kind of
    // internal message that must not reach the client.
    delete process.env.SUPABASE_URL;
    const app = await loadApp();
    const res: Probe = await request(app)
      .post('/api/v1/nfc/tap')
      .send({ sunMessage: 'https://am.example/verify/x?picc_data=EF963FF7828658A599F3041510671E88&cmac=94EED9EE65337086' });

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body?.error).toBe('Internal server error');
  });

  it('mounts the ownership lookup unauthenticated', async () => {
    const app = await loadApp();
    const res: Probe = await request(app).get('/api/v1/ownership/0x' + 'a'.repeat(64));

    // An Ownership ID is publishable; the lookup is deliberately public. It must
    // not answer 401.
    expect(isUnmounted(res)).toBe(false);
    expect(res.status).not.toBe(401);
  });

  it('rejects a malformed Ownership ID as not found, revealing nothing', async () => {
    const app = await loadApp();
    const res: Probe = await request(app).get('/api/v1/ownership/not-an-ownership-id');

    expect(res.status).toBe(404);
    // Same answer as an unknown-but-well-formed id: confirming the format was
    // right is already information for an enumerator.
    expect(res.body?.success).toBe(false);
  });

  it('mounts the token-fee webhook separately from the parked Stripe webhooks', async () => {
    const app = await loadApp();
    const res: Probe = await request(app).post('/api/v1/webhooks/stripe-token-fees');

    expect(isUnmounted(res)).toBe(false);
    // No signature and no secret configured -> 400, never a silent accept.
    expect(res.status).toBe(400);
    expect(res.body?.received).toBe(false);
  });

  it('keeps the parked Connect webhook unmounted', async () => {
    const app = await loadApp();
    expect(isUnmounted(await request(app).post('/api/v1/webhooks/stripe-account'))).toBe(true);
  });

  it('answers in the { success, data, error } house shape', async () => {
    const app = await loadApp();
    const res: Probe = await request(app).get('/api/v1/ownership/not-an-ownership-id');

    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('data', null);
    expect(res.body).toHaveProperty('error');
  });
});
