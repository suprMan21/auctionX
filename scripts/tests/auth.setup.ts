/**
 * Playwright setup: authenticate as a regular user.
 * Saves browser storage state to .auth/user.json for reuse by visual-user project.
 *
 * Requires PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD env vars.
 * If missing, writes empty storage state so protected routes capture redirect-to-login screenshots.
 */
import { test as setup } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const AUTH_DIR = path.resolve(__dirname, '../.auth');
const USER_STATE = path.join(AUTH_DIR, 'user.json');

const EMPTY_STATE = { cookies: [], origins: [] };

setup('authenticate as user', async ({ page }) => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const email = process.env.PLAYWRIGHT_TEST_EMAIL;
  const password = process.env.PLAYWRIGHT_TEST_PASSWORD;

  if (!email || !password) {
    console.warn('⚠ PLAYWRIGHT_TEST_EMAIL / PLAYWRIGHT_TEST_PASSWORD not set — writing empty auth state');
    fs.writeFileSync(USER_STATE, JSON.stringify(EMPTY_STATE));
    return;
  }

  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();

  // Wait for authenticated redirect
  await page.waitForURL(/\/(my-listings|dashboard|browse|profile)/, { timeout: 15000 });

  await page.context().storageState({ path: USER_STATE });
  console.log('✔ User auth state saved to', USER_STATE);
});
