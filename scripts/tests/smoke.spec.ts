import { test, expect } from '@playwright/test';
import { TEST_ROUTES, getRoutePath } from './routes';

const BACKEND_URL = process.env.PLAYWRIGHT_BACKEND_URL || 'https://vw7zy9mkyg.us-east-2.awsapprunner.com';

// ── Page routes ────────────────────────────────────────────────────────────────

const publicRoutes = TEST_ROUTES.filter((r) => r.auth === 'public');

test.describe('Public routes load successfully', () => {
  for (const route of publicRoutes) {
    test(`GET ${getRoutePath(route)} → 200 and renders`, async ({ page }) => {
      const response = await page.goto(getRoutePath(route));
      expect(response?.status()).toBeLessThan(400);
      await expect(page).toHaveTitle(/AuctionX/i);
    });
  }
});

test.describe('Auth-gated routes redirect to login', () => {
  const gatedRoutes = ['/profile', '/admin'];

  for (const path of gatedRoutes) {
    test(`GET ${path} → redirects to /login`, async ({ page }) => {
      await page.goto(path);
      // Wait for redirect to settle
      await page.waitForURL(/\/(login|register)/, { timeout: 10000 });
      expect(page.url()).toMatch(/\/(login|register)/);
    });
  }
});

// ── API health ────────────────────────────────────────────────────────────────

test.describe('Backend API', () => {
  test('GET /api/v1/health → 200 with expected shape', async ({ request }) => {
    const resp = await request.get(`${BACKEND_URL}/api/v1/health`);
    expect(resp.status()).toBe(200);

    const body = await resp.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('ts');
    expect(['healthy', 'ok', 'degraded']).toContain(body.status);
  });

  test('OPTIONS /api/v1/health → CORS headers present', async ({ request }) => {
    const resp = await request.fetch(`${BACKEND_URL}/api/v1/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://d1bwev65w7rqzl.cloudfront.net',
        'Access-Control-Request-Method': 'GET',
      },
    });

    // 200 or 204 both acceptable for preflight
    expect([200, 204]).toContain(resp.status());

    const acao = resp.headers()['access-control-allow-origin'];
    expect(acao).toBeTruthy();
  });

  test('GET /api/v1/nonexistent → 404 JSON', async ({ request }) => {
    const resp = await request.get(`${BACKEND_URL}/api/v1/nonexistent`);
    expect(resp.status()).toBe(404);
    const ct = resp.headers()['content-type'] ?? '';
    expect(ct).toContain('application/json');
  });
});

// ── Auth flow (requires env vars) ─────────────────────────────────────────────

const testEmail = process.env.PLAYWRIGHT_TEST_EMAIL;
const testPassword = process.env.PLAYWRIGHT_TEST_PASSWORD;

test.describe('Auth flow', () => {
  test.skip(!testEmail || !testPassword, 'PLAYWRIGHT_TEST_EMAIL / PLAYWRIGHT_TEST_PASSWORD not set');

  test('Login → dashboard → logout', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel(/email/i).fill(testEmail!);
    await page.getByLabel(/password/i).fill(testPassword!);
    await page.getByRole('button', { name: /sign in|log in/i }).click();

    // Should land somewhere authenticated
    await page.waitForURL(/\/(dashboard|browse|profile)/, { timeout: 15000 });

    // Logout via header menu (varies by implementation)
    const logoutTrigger = page.getByRole('button', { name: /logout|sign out|account/i }).first();
    if (await logoutTrigger.isVisible()) {
      await logoutTrigger.click();
      // Look for logout option in dropdown if present
      const logoutOption = page.getByRole('menuitem', { name: /logout|sign out/i });
      if (await logoutOption.isVisible({ timeout: 2000 })) {
        await logoutOption.click();
      }
      await page.waitForURL(/\/(login|\/)?$/, { timeout: 10000 });
    }
  });
});
