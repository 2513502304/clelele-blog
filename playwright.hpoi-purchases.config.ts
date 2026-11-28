import { defineConfig, devices } from '@playwright/test';

/** Local synthetic owner sessions only; these values cannot authenticate against a deployed site. */
export default defineConfig({
  testDir: './tests/hpoi-purchases',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: 'test-results/hpoi-purchases',
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4347', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'node node_modules/astro/astro.js dev --host 127.0.0.1 --port 4347',
    url: 'http://127.0.0.1:4347',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      SITE_ADMIN_GITHUB_ID: '1001',
      STYLE_GALLERY_SESSION_SECRET: 'hpoi-local-e2e-session-secret-0000000000000000',
      STYLE_GALLERY_GITHUB_CLIENT_ID: 'local-test',
      STYLE_GALLERY_GITHUB_CLIENT_SECRET: 'local-test',
      STYLE_GALLERY_GITHUB_REDIRECT_URI: 'http://127.0.0.1:4347/api/style-gallery/auth/github/callback',
      HPOI_PURCHASES_BUCKET: '',
      HPOI_PURCHASES_COOKIE: '',
      LIVE2D_E2E: '1',
    },
  },
});
