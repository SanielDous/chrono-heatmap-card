import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    timezoneId: 'Europe/Berlin',
    ...devices['Desktop Chrome'],
    viewport: { width: 1100, height: 900 },
    deviceScaleFactor: 2,
  },
  webServer: {
    command: 'pnpm exec vite --port 5173 --strictPort',
    url: 'http://localhost:5173/dev/index.html',
    reuseExistingServer: !process.env.CI,
    env: { CI: '1' },
  },
});
