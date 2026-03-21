/**
 * API Integration Tests — HTTP contract verification for all major endpoint categories.
 *
 * Tests public endpoints return correct shapes, protected endpoints return 401
 * when called without a token, and admin endpoints return 401 without admin credentials.
 *
 * Requires the backend dev server running at http://localhost:3001.
 * Run with: npx vitest run src/__tests__/api.integration.test.ts
 *
 * Skips automatically if the server is not reachable.
 *
 * @module Module 17 — E2E Testing & Security Audit
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://localhost:3001/api/v1';

let serverAvailable = false;

beforeAll(async () => {
  try {
    const res = await fetch(`${BASE.replace('/api/v1', '')}/api/v1/health`, {
      signal: AbortSignal.timeout(2000),
    });
    serverAvailable = res.ok || res.status < 500;
  } catch {
    serverAvailable = false;
    console.log('⚠ Backend server not running — skipping integration tests');
  }
});

// Helper: fetch with optional bearer token
async function apiFetch(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<Response> {
  const { token, ...rest } = options;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(rest.headers as Record<string, string> | undefined),
  };
  return fetch(`${BASE}${path}`, { ...rest, headers });
}

/** Skip helper — call at the top of each test body. */
function requireServer() {
  if (!serverAvailable) {
    return true;
  }
  return false;
}

// ── Public endpoints ──────────────────────────────────────────────────────────

describe('Public search endpoint', () => {
  it('GET /search?q=test → 200 with results/total/page shape', async (ctx) => {
    if (requireServer()) return ctx.skip();
    const res = await apiFetch('/search?q=test');
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { results: unknown[]; total: number; page: number } };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.results)).toBe(true);
    expect(typeof body.data.total).toBe('number');
    expect(typeof body.data.page).toBe('number');
  });

  it('GET /search (no params) → 200', async (ctx) => {
    if (requireServer()) return ctx.skip();
    const res = await apiFetch('/search');
    expect(res.status).toBe(200);
  });
});

describe('Public verification endpoint', () => {
  it('GET /verifications/public/nonexistent_token_99 → 404', async (ctx) => {
    if (requireServer()) return ctx.skip();
    const res = await apiFetch('/verifications/public/nonexistent_token_99');
    expect(res.status).toBe(404);
  });
});

// ── Protected endpoints — expect 401 without token ───────────────────────────

describe('Protected endpoints — 401 without auth', () => {
  const protectedRoutes: Array<{ method: string; path: string }> = [
    { method: 'GET', path: '/conversations' },
    { method: 'GET', path: '/payouts' },
    { method: 'POST', path: '/auctions/00000000-0000-0000-0000-000000000000/bids' },
    { method: 'GET', path: '/notifications' },
    { method: 'GET', path: '/notifications/preferences' },
  ];

  for (const route of protectedRoutes) {
    it(`${route.method} ${route.path} → 401`, async (ctx) => {
      if (requireServer()) return ctx.skip();
      const res = await apiFetch(route.path, { method: route.method });
      expect(res.status).toBe(401);
    });
  }
});

// ── Admin endpoints — expect 401 without token ───────────────────────────────

describe('Admin endpoints — 401 without auth', () => {
  const adminRoutes: Array<{ method: string; path: string }> = [
    { method: 'GET', path: '/admin/users' },
    { method: 'GET', path: '/admin/moderation' },
    { method: 'GET', path: '/admin/audit-logs' },
  ];

  for (const route of adminRoutes) {
    it(`${route.method} ${route.path} → 401`, async (ctx) => {
      if (requireServer()) return ctx.skip();
      const res = await apiFetch(route.path, { method: route.method });
      expect(res.status).toBe(401);
    });
  }
});

// ── Response shape contract ───────────────────────────────────────────────────

describe('Error response shape contract', () => {
  it('401 responses include { success: false, error: string }', async (ctx) => {
    if (requireServer()) return ctx.skip();
    const res = await apiFetch('/conversations');
    const body = await res.json() as { success: boolean; error: string };
    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe('string');
  });
});
