import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests of the admin panel against a running panel + API (real database, base + demo seed).
 *   ADMIN_URL    panel under test (default http://localhost:3001)
 *   API_URL      API base (default http://localhost:4000/api/v1)
 *   SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD  the seeded super admin (SEED_SUPERADMIN_* in the API)
 *   PW_CHROMIUM_PATH optional: use an already installed Chromium
 */
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.ADMIN_URL || 'http://localhost:3001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions: { executablePath } }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions: { executablePath } }, testMatch: /mobile\.spec\.ts/ },
  ],
});
