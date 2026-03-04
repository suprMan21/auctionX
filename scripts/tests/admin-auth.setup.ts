/**
 * Playwright setup: authenticate as an admin user.
 * Saves browser storage state to .auth/admin.json for reuse by visual-admin project.
 *
 * Requires PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD env vars.
 * If missing, writes empty storage state so admin routes capture redirect-to-login screenshots.
 */
import { test as setup } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const AUTH_DIR = path.resolve(__dirname, '../.auth');
const ADMIN_STATE = path.join(AUTH_DIR, 'admin.json');

const EMPTY_STATE = { cookies: [], origins: [] };

setup('authenticate as admin', async ({ page }) => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const email = process.env.PLAYWRIGHT_ADMIN_EMAIL;
  const password = process.env.PLAYWRIGHT_ADMIN_PASSWORD;

  if (!email || !password) {
    console.warn('⚠ PLAYWRIGHT_ADMIN_EMAIL / PLAYWRIGHT_ADMIN_PASSWORD not set — writing empty auth state');
    fs.writeFileSync(ADMIN_STATE, JSON.stringify(EMPTY_STATE));
    return;
  }

  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();

  // Wait for authenticated redirect
  await page.waitForURL(/\/(my-listings|dashboard|admin|browse|profile)/, { timeout: 15000 });

  await page.context().storageState({ path: ADMIN_STATE });
  console.log('✔ Admin auth state saved to', ADMIN_STATE);
});
