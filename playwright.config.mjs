import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8098',
    viewport: { width: 1440, height: 1000 },
    channel: process.env.CI ? undefined : 'msedge',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node scripts/serve.mjs 8098',
    url: 'http://127.0.0.1:8098/api/health',
    reuseExistingServer: false,
    timeout: 15000
  }
});
