import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a running website + API (real database, demo seed).
 *   WEB_URL      website under test (default http://localhost:3000)
 *   API_URL      API base (default http://localhost:4000/api/v1)
 *   E2E_API_LOG  optional: API log file, lets the sign-up test read the one-time code printed by the "log" email driver
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
    baseURL: process.env.WEB_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 }, launchOptions: { executablePath } }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions: { executablePath } }, testMatch: /mobile\.spec\.ts/ },
  ],
});
