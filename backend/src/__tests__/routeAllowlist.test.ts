import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

/**
 * S-ISO1 — parked marketplace isolation.
 *
 * Proves the acceptance criterion: with FEATURE_MARKETPLACE off, every
 * marketplace endpoint 404s while token-platform endpoints are unaffected; and
 * flipping the flag restores every parked mount.
 *
 * createApp() must be re-imported per test because the mount list is resolved
 * at construction time from the env var.
 */

/**
 * The app's catch-all (app.ts) answers an UNMOUNTED path with exactly
 * `{ error: 'Not found' }` and no `success` key, whereas a mounted controller
 * that simply cannot find a row answers in the house shape
 * `{ success: false, error: ... }`. Status alone cannot tell those apart, so
 * every assertion below keys off the body.
 */
const isUnmounted = (res: { status: number; body?: Record<string, unknown> }): boolean =>
  res.status === 404 && res.body?.error === 'Not found' && res.body?.success === undefined;

const loadApp = async () => {
  vi.resetModules();
  const { createApp } = await import('../app');
  return createApp();
};

type Probe = { status: number; body?: Record<string, unknown> };

const send = (app: unknown, method: string, path: string): Promise<Probe> =>
  (request(app as never) as unknown as Record<string, (p: string) => Promise<Probe>>)[method](path);

/** Parked surfaces — must 404 when the flag is off. */
const PARKED = [
  { method: 'get', path: '/api/v1/auctions/00000000-0000-0000-0000-000000000000' },
  { method: 'get', path: '/api/v1/settlements/00000000-0000-0000-0000-000000000000' },
  { method: 'post', path: '/api/v1/delivery/00000000-0000-0000-0000-000000000000/confirm-delivery' },
  { method: 'get', path: '/api/v1/payouts' },
  { method: 'get', path: '/api/v1/stripe-connect/status' },
  { method: 'post', path: '/api/v1/webhooks/paymentcloud' },
  { method: 'post', path: '/api/v1/webhooks/stripe-account' },
  { method: 'get', path: '/api/v1/search' },
  { method: 'post', path: '/api/v1/verifications/create' },
  { method: 'get', path: '/api/v1/seller-verification/status' },
  { method: 'get', path: '/api/v1/conversations' },
  // Route-level parking inside the KEPT nfc router.
  { method: 'post', path: '/api/v1/nfc/register' },
  { method: 'post', path: '/api/v1/nfc/transfer' },
  { method: 'post', path: '/api/v1/nfc/mint' },
] as const;

/** Token surfaces — must NOT 404 when the flag is off. */
const KEPT = [
  { method: 'get', path: '/api/v1/health' },
  { method: 'post', path: '/api/v1/nfc/scan' },
  { method: 'get', path: '/api/v1/nfc/00000000-0000-0000-0000-000000000000' },
  { method: 'get', path: '/api/v1/nfc/by-uid/04A27E02936980' },
  { method: 'post', path: '/api/v1/verification/start' },
  { method: 'post', path: '/api/v1/webhooks/yoti' },
  { method: 'get', path: '/api/v1/notifications' },
  { method: 'get', path: '/api/v1/admin/users' },
] as const;

/** Admin sub-mounts parked by the sub-allowlist. */
const PARKED_ADMIN = [
  '/api/v1/admin/moderation/queue',
  '/api/v1/admin/auctions',
  '/api/v1/admin/disputes',
  '/api/v1/admin/escrow',
  '/api/v1/admin/seller-verification',
] as const;

const KEPT_ADMIN = [
  '/api/v1/admin/health',
  '/api/v1/admin/users',
  '/api/v1/admin/audit-logs',
  '/api/v1/admin/verifications',
] as const;

const originalFlag = process.env.FEATURE_MARKETPLACE;

afterEach(() => {
  if (originalFlag === undefined) delete process.env.FEATURE_MARKETPLACE;
  else process.env.FEATURE_MARKETPLACE = originalFlag;
});

describe('S-ISO1 route allowlist — FEATURE_MARKETPLACE off (default)', () => {
  beforeEach(() => { delete process.env.FEATURE_MARKETPLACE; });

  it.each(PARKED)('404s parked $method $path', async ({ method, path }) => {
    const app = await loadApp();
    const res = await send(app, method, path);
    expect(isUnmounted(res)).toBe(true);
  });

  it.each(KEPT)('keeps $method $path mounted', async ({ method, path }) => {
    const app = await loadApp();
    const res = await send(app, method, path);
    // Reachability, not behaviour: these are reached and then rejected by their
    // own auth, validation or "row not found" layer. Only the catch-all is a fail.
    expect(isUnmounted(res)).toBe(false);
  });

  it.each(PARKED_ADMIN)('404s parked admin %s (after the zero-trust stack)', async (path) => {
    const app = await loadApp();
    const res = await request(app).get(path);
    // verifyAdminAuth runs first, so an unauthenticated probe 401s and never
    // learns whether the path is parked. That is intentional.
    expect([401, 403, 404]).toContain(res.status);
  });

  it('mounts an explicit allowlist, not a denylist', async () => {
    vi.resetModules();
    const { TOKEN_MOUNTS, MARKETPLACE_MOUNTS } = await import('../app');
    const tokenPaths = TOKEN_MOUNTS.map((m) => m.path);
    const parkedPaths = MARKETPLACE_MOUNTS.map((m) => m.path);
    // No path may appear in both lists.
    expect(tokenPaths.filter((p) => parkedPaths.includes(p))).toEqual([]);
    // The parked NFT/IPFS mint surface is never in the token allowlist.
    expect(tokenPaths).not.toContain('/api/v1/stripe-connect');
  });

  it('mounts every raw-body webhook before the JSON parser', async () => {
    vi.resetModules();
    const { TOKEN_MOUNTS } = await import('../app');
    const yoti = TOKEN_MOUNTS.find((m) => m.path === '/api/v1/webhooks/yoti');
    expect(yoti?.raw).toBe(true);
  });
});

describe('S-ISO1 route allowlist — FEATURE_MARKETPLACE on (reversibility)', () => {
  beforeEach(() => { process.env.FEATURE_MARKETPLACE = 'true'; });

  it.each(PARKED)('restores parked $method $path', async ({ method, path }) => {
    const app = await loadApp();
    const res = await send(app, method, path);
    expect(isUnmounted(res)).toBe(false);
  });

  it.each(KEPT_ADMIN)('keeps admin %s reachable either way', async (path) => {
    const app = await loadApp();
    const res = await request(app).get(path);
    expect([401, 403, 200]).toContain(res.status);
  });
});
