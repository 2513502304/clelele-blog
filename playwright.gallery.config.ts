import { defineConfig, devices } from '@playwright/test';

// Integration coverage against the real gallery data source configured for local development.
export default defineConfig({
  testDir: './tests/style-gallery',
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.GALLERY_BASE ?? 'http://127.0.0.1:4333',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1512, height: 870 } } }],
  webServer: process.env.GALLERY_BASE
    ? undefined
    : {
        command: 'npm run dev -- --host 127.0.0.1 --port 4333',
        url: 'http://127.0.0.1:4333',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
