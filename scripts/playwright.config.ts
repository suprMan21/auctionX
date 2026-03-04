import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  workers: 1,
  reporter: [
    ['json', { outputFile: path.resolve(__dirname, 'reports', `smoke-${timestamp}.json`) }],
    ['html', { outputFolder: path.resolve(__dirname, 'reports', `visual-${timestamp}`), open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://d1bwev65w7rqzl.cloudfront.net',
    screenshot: 'on',
    extraHTTPHeaders: {
      'x-test-run': 'staging-suite',
    },
  },
  projects: [
    // ── Smoke tests (unchanged) ──────────────────────────────────────────────
    {
      name: 'smoke',
      testMatch: '**/smoke.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },

    // ── Auth setup projects ──────────────────────────────────────────────────
    {
      name: 'setup-user',
      testMatch: '**/auth.setup.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'setup-admin',
      testMatch: '**/admin-auth.setup.ts',
      use: { ...devices['Desktop Chrome'] },
    },

    // ── Visual capture projects (filtered by @tag) ───────────────────────────
    {
      name: 'visual-public',
      testMatch: '**/visual.spec.ts',
      grep: /@public/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: 'visual-user',
      testMatch: '**/visual.spec.ts',
      grep: /@user/,
      dependencies: ['setup-user'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        storageState: path.resolve(__dirname, '.auth', 'user.json'),
      },
    },
    {
      name: 'visual-admin',
      testMatch: '**/visual.spec.ts',
      grep: /@admin/,
      dependencies: ['setup-admin'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        storageState: path.resolve(__dirname, '.auth', 'admin.json'),
      },
    },
  ],
  outputDir: path.resolve(__dirname, 'reports', 'test-artifacts'),
});
