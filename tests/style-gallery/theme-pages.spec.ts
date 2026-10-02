import { expect, test } from '@playwright/test';
import { APPEARANCES } from '../../src/components/theme/appearance';

const routes = [
  '/',
  '/weekly',
  '/about',
  '/links',
  '/music',
  '/bangumi',
  '/hpoi',
  '/image-style-prompt-gallery',
  '/image-style-prompt-gallery/examples',
  '/image-style-prompt-gallery/2026-09-23-35dc5191ccad',
];
test('all palettes keep page/control surfaces related across routes and light/dark modes', async ({ page }) => {
  test.setTimeout(180000);
  await page.route('**/*', (r) =>
    r.request().resourceType() === 'image'
      ? r.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="960"><rect width="640" height="960" fill="#adc9ba"/></svg>',
        })
      : r.continue(),
  );
  await page.route('**/api/live2d**', (r) => r.abort());
  await page.route('**/api/music/meting?**', (r) =>
    r.fulfill({
      json: [
        { name: 'Theme fixture song', artist: 'Fixture artist', url: '/fixture-audio.mp3', pic: '/fixture-cover.png', lrc: '' },
      ],
    }),
  );
  await page.route('**/api/bangumi?**', (r) => r.fulfill({ json: { items: [], next: null, total: 0 } }));
  await page.route('**/api/hpoi?**', (r) =>
    r.fulfill({
      json: {
        items: [],
        next: null,
        meta: {
          profile: { name: 'Fixture', profileUrl: 'https://www.hpoi.net/user/1', stats: {} },
          warnings: [],
          fetchedAt: '2026-10-02T00:00:00Z',
        },
      },
    }),
  );
  for (const route of routes) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main')).toBeVisible();
    if (route === '/music') await expect(page.getByText('Theme fixture song').first()).toBeVisible();
    const results = await page.evaluate(
      (ids) => {
        const root = document.documentElement;
        const probe = document.createElement('input');
        document.querySelector('main')?.append(probe);
        const rows = [false, true].flatMap((dark) => {
          root.classList.toggle('dark', dark);
          return ids.map((id) => {
            root.dataset.appearance = id;
            const css = getComputedStyle(probe),
              tokens = getComputedStyle(root);
            return {
              id,
              dark,
              input: css.backgroundImage,
              card: tokens.getPropertyValue('--card'),
              bg: tokens.getPropertyValue('--background'),
            };
          });
        });
        probe.remove();
        return rows;
      },
      APPEARANCES.filter((p) => p.id !== 'original').map((p) => p.id),
    );
    for (const row of results) {
      expect(row.input, `${route} ${row.id} ${row.dark}`).toContain('linear-gradient');
      expect(row.card).not.toBe(row.bg);
    }
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
      document.documentElement.dataset.appearance = 'blueprint';
    });
    await page.evaluate(() => window.scrollTo(0, 550));
    await page.waitForTimeout(350); // Allow color transitions to settle before visual inspection.
    await page.screenshot({ path: `/tmp/theme-route-${route.replaceAll('/', '_') || 'home'}.png` });
  }
});

test('baseline is 95 percent of old size; density changes section spacing; panel transparency is shared', async ({ page }) => {
  await page.goto('/image-style-prompt-gallery', { waitUntil: 'domcontentloaded' });
  expect(await page.locator('html').evaluate((el) => getComputedStyle(el).fontSize)).toBe('15.2px');
  const surface = page.locator('[data-gallery-selection-surface]');
  const normal = await surface.evaluate((el) => parseFloat(getComputedStyle(el).gap));
  await page.evaluate(() => {
    document.documentElement.dataset.readingDensity = 'compact';
  });
  expect(await surface.evaluate((el) => parseFloat(getComputedStyle(el).gap))).toBeCloseTo(normal * 0.75, 1);
  const description = page.locator('[data-gallery-selection-surface] header p').nth(1);
  await expect(description).toHaveCSS('max-width', 'none');
  const blur = await page.evaluate(() => {
    const panel = document.createElement('section');
    panel.className = 'live2d-panel';
    document.body.append(panel);
    const glass = getComputedStyle(panel).backdropFilter;
    document.documentElement.dataset.readingTransparency = 'solid';
    const solid = getComputedStyle(panel).backdropFilter;
    panel.remove();
    return { glass, solid };
  });
  expect(blur.glass).toContain('blur');
  expect(blur.solid).toBe('none');
  await page.evaluate(() => {
    localStorage.setItem('appearance-reading', JSON.stringify({ fontSize: 95 }));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-reading-font-size', '100');
  expect(await page.locator('html').evaluate((el) => getComputedStyle(el).fontSize)).toBe('15.2px');
});
