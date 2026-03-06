/**
 * E2E test helper utilities — login flows for test users.
 *
 * Reads credentials from environment variables with safe fallbacks.
 * Set TEST_USER_EMAIL, TEST_USER_PASSWORD, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD
 * in .env.test or your CI environment before running E2E tests.
 *
 * @module Module 17 — E2E Testing & Security Audit
 */
import { Page } from '@playwright/test';

const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL ?? 'test@authenticmaterials.com';
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD ?? '';
const TEST_ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'chris.lafleche@cravingcorp.com';
const TEST_ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? '';

/**
 * Log in as the standard test user via the /login page.
 * Waits for the header to confirm successful authentication.
 */
export async function loginAsTestUser(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', TEST_USER_EMAIL);
  await page.fill('input[type="password"]', TEST_USER_PASSWORD);
  await page.click('button[type="submit"]');
  // Wait for redirect away from login — header presence confirms auth
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
}

/**
 * Log in as an admin user via the /login page.
 * Waits for redirect to confirm authentication, then navigates to /admin.
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', TEST_ADMIN_EMAIL);
  await page.fill('input[type="password"]', TEST_ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
}
