import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a real Home Assistant (see e2e-ha/setup.ts and the README).
 * Expects HA on http://localhost:8123, prepared by `node e2e-ha/setup.ts`.
 */
export default defineConfig({
  testDir: 'e2e-ha',
  outputDir: 'e2e-ha-run/test-results',
  // one HA instance and one user: run the tests one after another
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  // a retry may absorb a hiccup, but a test that only passes on retry still fails the job
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'e2e-ha-run/report' }]]
    : 'list',
  use: {
    baseURL: process.env.HA_URL ?? 'http://localhost:8123',
    storageState: 'e2e-ha-run/storage-state.json',
    timezoneId: 'Europe/Berlin',
    locale: 'en-US',
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 1100 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
