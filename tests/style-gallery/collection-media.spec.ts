import { expect, test } from '@playwright/test';
import { APPEARANCES } from '../../src/components/theme/appearance';

const image = (wide: boolean) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${wide ? 900 : 300}" height="600"><rect width="100%" height="100%" fill="#adbacb"/></svg>`;

for (const kind of ['bangumi', 'hpoi']) {
  test(`${kind} masonry keeps intrinsic ratios, equal widths and non-overlapping cards`, async ({ page }) => {
    await page.route('**/*', (route) =>
      route.request().resourceType() === 'image'
        ? route.fulfill({ contentType: 'image/svg+xml', body: image(route.request().url().includes('wide')) })
        : route.continue(),
    );
    await page.route('**/api/live2d**', (route) => route.abort());
    await page.route(`**/api/${kind}?**`, (route) =>
      route.fulfill({
        json: {
          items: Array.from({ length: 12 }, (_, i) =>
            kind === 'bangumi'
              ? {
                  subject_id: i + 1,
                  type: 2,
                  tags: [],
                  rate: 7,
                  subject: {
                    id: i + 1,
                    name: `Title ${i}`,
                    name_cn: '',
                    score: 8,
                    images: { common: `https://images.test/${i % 2 ? 'tall' : 'wide'}.svg` },
                  },
                }
              : {
                  id: String(i + 1),
                  title: `Figure ${i}`,
                  imageUrl: `https://rfx.hpoi.net/gk/${i % 2 ? 'tall' : 'wide'}.svg`,
                  detailUrl: `https://www.hpoi.net/hobby/${i + 1}`,
                  score: '8',
                },
          ),
          next: null,
          total: 12,
          meta: {
            profile: { name: 'Fixture', profileUrl: 'https://www.hpoi.net/user/1', stats: {} },
            warnings: [],
            fetchedAt: '2026-10-05T00:00:00Z',
          },
        },
      }),
    );
    await page.goto(`/${kind}`, { waitUntil: 'domcontentloaded' });
    const cards = page.locator('[data-gallery-layout] > a');
    await expect(cards).toHaveCount(12);
    await cards.first().scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        cards
          .locator('img')
          .first()
          .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth),
      )
      .toBe(900);
    await expect
      .poll(async () => {
        const rects = await cards
          .locator('img')
          .evaluateAll((imgs) =>
            imgs
              .slice(0, 2)
              .map((img) => ({ width: img.getBoundingClientRect().width, height: img.getBoundingClientRect().height })),
          );
        return rects.map((r) => Math.round((r.width / r.height) * 100));
      })
      .toEqual([150, 50]);
    const boxes = await cards.evaluateAll((nodes) =>
      nodes.slice(0, 8).map((node) => {
        const b = node.getBoundingClientRect();
        return { x: b.x, y: b.y, bottom: b.bottom, w: b.width };
      }),
    );
    expect(Math.max(...boxes.map((b) => b.w)) - Math.min(...boxes.map((b) => b.w))).toBeLessThan(1);
    expect(Math.abs(boxes[0].bottom - boxes[1].bottom)).toBeGreaterThan(100);
    expect(boxes[4].y).toBeGreaterThanOrEqual(boxes[0].bottom);
    await page.getByRole('button', { name: '瀑布流', exact: true }).click();
    await expect(page.locator('[data-gallery-layout]')).toHaveAttribute('data-gallery-layout', 'grid');
  });
}

test('Hpoi shows cards while scores are pending, then caches scores across reloads', async ({ page }) => {
  await page.route('**/*', (route) =>
    route.request().resourceType() === 'image'
      ? route.fulfill({ contentType: 'image/svg+xml', body: image(false) })
      : route.continue(),
  );
  await page.route('**/api/live2d**', (route) => route.abort());
  await page.route('**/api/hpoi?**', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: '123',
            title: 'Visible before rating',
            imageUrl: null,
            detailUrl: 'https://www.hpoi.net/hobby/123',
            score: null,
          },
        ],
        next: null,
        meta: {
          profile: { name: 'Fixture', profileUrl: 'https://www.hpoi.net/user/1', stats: {} },
          warnings: [],
          fetchedAt: '2026-10-05T00:00:00Z',
        },
      },
    }),
  );
  let release: (() => void) | undefined;
  let reads = 0;
  await page.route('**/api/hpoi/ratings?**', async (route) => {
    reads++;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({ json: { '123': '4.77' } });
  });
  await page.goto('/hpoi', { waitUntil: 'domcontentloaded' });
  const card = page.locator('[data-gallery-layout] > a');
  await expect(card).toContainText('Visible before rating');
  await expect.poll(() => !!release).toBe(true);
  release?.();
  await expect(card).toContainText('4.77');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(card).toContainText('4.77');
  expect(reads).toBe(1);
});

test('sidebar proposals are interactive and inherit every light/dark theme without overflow', async ({ page }) => {
  await page.goto('/sidebar-lab');
  await expect(page.locator('.sidebar')).toHaveCount(4);
  for (const preset of APPEARANCES) {
    await page.locator('#palette').selectOption(preset.id);
    for (const dark of [true, false]) {
      await page.locator('#dark').click();
      await expect(page.locator('#dark')).toHaveAttribute('aria-pressed', String(dark));
      const fits = await page
        .locator('.sidebar')
        .evaluateAll((nodes) => nodes.every((n) => n.scrollWidth <= n.clientWidth + 1));
      expect(fits).toBe(true);
    }
  }
  await page.getByRole('button', { name: '单独预览私人索引' }).click();
  await expect(page.locator('.study:visible')).toHaveCount(1);
  await page.getByRole('button', { name: '查看全部方案' }).click();
  await expect(page.locator('.study:visible')).toHaveCount(4);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('banner aliases reuse cached same-origin bytes without signed-URL redirects', async ({ page, context, browserName }) => {
  // No routes: Playwright interception disables the HTTP cache we are testing.
  await page.goto('/sidebar-lab');
  const result = await page.evaluate(async () => {
    const loaded: string[] = [];
    const cacheHeaders: (string | null)[] = [];
    for (const slot of ['home', 'weekly', 'hpoi']) {
      const response = await fetch(`/api/site-assets/${slot}`);
      await response.arrayBuffer();
      loaded.push(response.url);
      cacheHeaders.push(response.headers.get('cache-control'));
    }
    const url = loaded[0];
    performance.clearResourceTimings();
    for (let i = 0; i < 2; i++) await (await fetch(url)).arrayBuffer();
    return {
      urls: loaded,
      cacheHeaders,
    };
  });
  expect(new Set(result.urls).size).toBe(1);
  expect(result.urls[0]).toMatch(/\/api\/site-assets\/[a-f0-9]{64}\.png$/);
  expect(result.cacheHeaders.every((value) => value?.includes('max-age=86400'))).toBe(true);
  // Offline byte reuse is verified in Chromium; WebKit verifies the stable URL/cache-header contract above.
  if (browserName !== 'chromium') return;
  await context.setOffline(true);
  try {
    expect(
      await page.evaluate(async (url) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        return image.naturalWidth;
      }, result.urls[0]),
    ).toBeGreaterThan(0);
  } finally {
    await context.setOffline(false);
  }
});
