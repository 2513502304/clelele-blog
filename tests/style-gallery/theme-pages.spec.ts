import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { APPEARANCES } from '../../src/components/theme/appearance';

const routes = [
  '/',
  '/weekly',
  '/about',
  '/friends',
  '/music',
  '/bangumi',
  '/hpoi',
  '/image-style-prompt-gallery',
  '/image-style-prompt-gallery/examples',
  '/image-style-prompt-gallery/2026-09-23-35dc5191ccad',
  '/image-style-prompt-gallery/index',
  '/post/note/shoka-features',
  '/post/markdown-features',
  '/post/weekly-example-1',
  '/categories/note/front-end',
  '/categories/weekly',
  '/tags/markdown',
  '/archives',
  '/posts',
  '/en/post/note/shoka-features',
  '/ja/post/markdown-features',
  '/en/categories/note/front-end',
  '/ja/tags/markdown',
  '/en/image-style-prompt-gallery/2026-09-23-35dc5191ccad',
  '/ja/image-style-prompt-gallery/examples',
];
test('all palettes keep page/control surfaces related across routes and light/dark modes', async ({ page }) => {
  test.setTimeout(300000);
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
    const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
    // A themed 404 also contains <main>; require the intended route to render successfully.
    expect(response?.status(), route).toBe(200);
    expect(new URL(page.url()).pathname.replace(/\/$/, ''), route).toBe(route.replace(/\/$/, ''));
    await expect(page.locator('main').first()).toBeVisible();
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
    if (route === '/music') await expect(page.getByText('Theme fixture song').first()).toBeVisible();
    const results = await page.evaluate(
      (ids) => {
        const root = document.documentElement;
        const probe = document.createElement('input');
        document.querySelector('main')?.append(probe);
        const textProbe = document.createElement('span');
        textProbe.style.color = 'hsl(var(--muted-foreground))';
        document.body.append(textProbe);
        const rows = [false, true].flatMap((dark) => {
          root.classList.toggle('dark', dark);
          return ids.map((id) => {
            root.dataset.appearance = id;
            const label = document.querySelector('label[for="friend-site"]');
            const shell = document.querySelector('main .shadow-box.bg-gradient-start');
            const css = getComputedStyle(probe),
              tokens = getComputedStyle(root);
            return {
              id,
              dark,
              input: css.backgroundImage,
              card: tokens.getPropertyValue('--card'),
              bg: tokens.getPropertyValue('--background'),
              label: label ? getComputedStyle(label).color : null,
              mutedText: getComputedStyle(textProbe).color,
              readingShell: shell ? getComputedStyle(shell).backgroundColor : null,
              canvas: getComputedStyle(document.querySelector('.page-reading-layout') ?? root).backgroundImage,
            };
          });
        });
        probe.remove();
        textProbe.remove();
        return rows;
      },
      APPEARANCES.filter((p) => p.id !== 'original').map((p) => p.id),
    );
    for (const row of results) {
      expect(row.input, `${route} ${row.id} ${row.dark}`).toContain('linear-gradient');
      expect(row.card).not.toBe(row.bg);
      if (row.label) expect(row.label, `${route} ${row.id} label`).toBe(row.mutedText);
      if (row.readingShell) {
        expect(row.readingShell, `${route} ${row.id} reading shell`).toBe('rgba(0, 0, 0, 0)');
        expect(row.canvas, `${route} ${row.id} canvas`).toContain('radial-gradient');
      }
    }
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
      document.documentElement.dataset.appearance = 'blueprint';
    });
    await page.evaluate(() => window.scrollTo(0, 550));
    await page.waitForTimeout(350); // Allow color transitions to settle before visual inspection.
    await page.screenshot({ animations: 'disabled', path: `/tmp/theme-route-${route.replaceAll('/', '_') || 'home'}.png` });
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
  const panels = await page.evaluate(() =>
    ['live2d-panel', 'live2d-status', 'live2d-dialogue', 'live2d-wake'].map((className) => {
      const panel = document.createElement('section');
      panel.className = className;
      document.body.append(panel);
      document.documentElement.dataset.readingTransparency = 'glass';
      const glass = getComputedStyle(panel).backdropFilter;
      document.documentElement.dataset.readingTransparency = 'solid';
      const solid = getComputedStyle(panel).backdropFilter;
      panel.remove();
      return { className, glass, solid };
    }),
  );
  for (const panel of panels) {
    expect(panel.glass, panel.className).toContain('blur');
    expect(panel.solid, panel.className).toBe('none');
  }
  await page.evaluate(() => {
    localStorage.setItem('appearance-reading', JSON.stringify({ fontSize: 95 }));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-reading-font-size', '100');
  expect(await page.locator('html').evaluate((el) => getComputedStyle(el).fontSize)).toBe('15.2px');
});

test('owner nested pages and image picker share themed surfaces and primary foreground', async ({ page, context }) => {
  test.setTimeout(120000);
  const payload = Buffer.from(
    JSON.stringify({
      viewer: {
        id: 129171955,
        login: 'fixture-owner',
        avatarUrl: 'https://example.com/a.png',
        profileUrl: 'https://github.com/fixture',
      },
      expiresAt: Date.now() + 600_000,
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', 'profile-fixture-secret-for-local-tests-only').update(payload).digest('base64url');
  await context.addCookies([{ name: 'style_gallery_session', value: `${payload}.${signature}`, url: 'http://127.0.0.1:4340' }]);
  await page.route('**/*', (r) =>
    r.request().resourceType() === 'image'
      ? r.fulfill({
          contentType: 'image/png',
          body: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
            'base64',
          ),
        })
      : r.continue(),
  );
  await page.route('**/api/live2d**', (r) => r.abort());
  await page.route('**/api/music/session', (r) => r.fulfill({ json: { configured: true, connected: false } }));
  await page.route('**/api/hpoi', (r) =>
    r.fulfill({
      json: {
        profile: { name: 'Fixture', stats: {} },
        fetchedAt: '2026-10-02T00:00:00Z',
        warnings: [],
        collections: { all: [], care: [], want: [], preorder: [], buy: [], resell: [] },
      },
    }),
  );
  for (const route of ['/music/admin', '/hpoi/admin', '/admin?asset=avatar']) {
    const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
    expect(response?.status(), route).toBe(200);
    expect(new URL(page.url()).pathname).toBe(route.split('?')[0]);
    await expect(page.locator('main').first()).toBeVisible();
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
      document.documentElement.dataset.appearance = 'blueprint';
    });
    if (route.includes('?')) {
      const dialog = page.getByRole('dialog', { name: /^更换/ });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveCSS('backdrop-filter', /blur/);
      await dialog.locator('input[type=file]').setInputFiles({
        name: 'fixture.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
          'base64',
        ),
      });
      await expect(dialog.getByRole('button', { name: '使用这个构图' })).toBeEnabled();
      const results = await page.evaluate(
        (ids) => {
          const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')].filter((button) =>
            ['使用这个构图', '保存并发布'].includes(button.textContent?.trim() ?? ''),
          );
          const probe = document.createElement('span');
          probe.style.color = 'hsl(var(--primary-foreground))';
          document.body.append(probe);
          const results = [false, true].flatMap((dark) => {
            document.documentElement.classList.toggle('dark', dark);
            return ids.flatMap((id) => {
              document.documentElement.dataset.appearance = id;
              return buttons.map((button) => ({
                id,
                dark,
                label: button.textContent,
                actual: getComputedStyle(button).color,
                expected: getComputedStyle(probe).color,
              }));
            });
          });
          probe.remove();
          return results;
        },
        APPEARANCES.map((p) => p.id),
      );
      expect(results).toHaveLength(APPEARANCES.length * 4);
      for (const row of results) expect(row.actual, JSON.stringify(row)).toBe(row.expected);
      await page.evaluate(() => {
        document.documentElement.dataset.readingTransparency = 'solid';
      });
      await expect(dialog).toHaveCSS('backdrop-filter', 'none');
      await expect(page.locator('footer.glass-surface')).toHaveCSS('backdrop-filter', 'none');
    }
    await page.screenshot({ animations: 'disabled', path: `/tmp/theme-admin-${route.split('?')[0].replaceAll('/', '_')}.png` });
  }
});
