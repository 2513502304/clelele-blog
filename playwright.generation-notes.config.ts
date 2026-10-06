import { defineConfig, devices } from '@playwright/test';

/** Isolated fixture server keeps checks independent of HF. Run separately from Astro check/build, which rewrite Vite's cache. */
export default defineConfig({
  testDir: './tests/style-gallery',
  testMatch: [
    'generation-notes.spec.ts',
    'profile-crop.spec.ts',
    'design-lab.spec.ts',
    'appearance.spec.ts',
    'banner-atmosphere.spec.ts',
    'collections.spec.ts',
    'collection-media.spec.ts',
    'sidebar-loading.spec.ts',
    'theme-pages.spec.ts',
    'theme-refinement.spec.ts',
  ],
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { baseURL: 'http://127.0.0.1:4340', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1512, height: 870 } } },
    {
      name: 'webkit',
      testMatch: [
        'profile-crop.spec.ts',
        'appearance.spec.ts',
        'banner-atmosphere.spec.ts',
        'collections.spec.ts',
        'collection-media.spec.ts',
        'sidebar-loading.spec.ts',
        'theme-pages.spec.ts',
        'theme-refinement.spec.ts',
      ],
      use: { ...devices['Desktop Safari'], viewport: { width: 1512, height: 870 } },
    },
  ],
  webServer: {
    command:
      'node --import ./tests/style-gallery/generation-fixture.mjs node_modules/astro/astro.js dev --host 127.0.0.1 --port 4340',
    url: 'http://127.0.0.1:4340',
    timeout: 120_000,
  },
});
