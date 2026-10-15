import { expect, test } from '@playwright/test';
import sharp from 'sharp';

// GALLERY_SCROLL_FIXTURE=1 enables the real progressive list with stable source geometry.
test.skip(process.env.GALLERY_SCROLL_FIXTURE !== '1', 'Requires the opt-in long catalog');

test.beforeEach(async ({ page }) => {
  const original = await sharp('public/img/cover/6.webp').resize(1664, 2432).webp().toBuffer();
  const preview = await sharp(original).resize(720).webp().toBuffer();
  await page.route('**/*', (route) => {
    if (route.request().resourceType() !== 'image') return route.continue();
    return route.fulfill({
      contentType: 'image/webp',
      body: route.request().url().includes('/thumb/') ? preview : original,
    });
  });
  await page.route('**/api/live2d**', (route) => route.abort());
});

test('appends preserve existing measurements, nodes and positions; offscreen glass never hides card content', async ({
  page,
}) => {
  await page.goto('/image-style-prompt-gallery');
  const grid = page.locator('[data-gallery-layout]');
  const cards = grid.locator('article');
  await expect(cards).toHaveCount(24);
  await expect
    .poll(() =>
      cards
        .first()
        .locator('img')
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(720);
  await expect(cards.last()).toHaveAttribute('data-gallery-near-viewport', 'false');
  await page.evaluate(() => {
    const query = document.querySelectorAll.bind(document);
    document.body.dataset.sidebarScans = '0';
    document.querySelectorAll = ((selector: string) => {
      if (selector === '[data-home-info-container]') {
        document.body.dataset.sidebarScans = String(Number(document.body.dataset.sidebarScans) + 1);
      }
      return query(selector);
    }) as typeof document.querySelectorAll;
  });
  // Spy on actual layout reads, not an implementation-maintained diagnostic counter.
  await cards.first().evaluate((card: HTMLElement) => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    if (!descriptor?.get) throw new Error('Missing offsetHeight getter');
    card.dataset.heightReads = '0';
    Object.defineProperty(card, 'offsetHeight', {
      configurable: true,
      get() {
        card.dataset.heightReads = String(Number(card.dataset.heightReads) + 1);
        return descriptor.get?.call(card);
      },
    });
    card.dataset.beforeTop = card.style.top;
  });
  await page.getByRole('button', { name: '加载更多结果', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(cards).toHaveCount(48);
  // The old sidebar observer scheduled one document scan per DOM mutation,
  // starving animation frames after a large append. Include its delayed work.
  await page.waitForTimeout(200);
  await expect(page.locator('body')).toHaveAttribute('data-sidebar-scans', '0');
  await expect(cards.first()).toHaveAttribute('data-height-reads', '0');
  expect(await cards.first().evaluate((card: HTMLElement) => card.style.top === card.dataset.beforeTop)).toBe(true);
  const distant = cards.nth(40);
  await expect(distant).toHaveAttribute('data-gallery-near-viewport', 'false');
  await expect(distant).toHaveCSS('content-visibility', 'visible');
  await expect(distant).toHaveCSS('opacity', '1');
  await expect(distant.locator('.glass-image-action').first()).toHaveCSS('backdrop-filter', 'none');
  expect(
    await distant
      .locator('.gallery-tag,.gallery-image-badge')
      .evaluateAll((controls) => controls.every((control) => getComputedStyle(control).backdropFilter === 'none')),
  ).toBe(true);
  await distant.scrollIntoViewIfNeeded();
  await expect(distant).toHaveAttribute('data-gallery-near-viewport', 'true');
  await expect(distant.locator('.glass-image-action').first()).not.toHaveCSS('backdrop-filter', 'none');
  await expect.poll(() => distant.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(720);

  // Width, typography and view changes must still remeasure and preserve row-major order.
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.evaluate(() => window.dispatchEvent(new Event('reading-change')));
  await expect.poll(() => cards.first().getAttribute('data-height-reads')).not.toBe('0');
  await expect.poll(() => cards.nth(3).evaluate((card: HTMLElement) => Number.parseFloat(card.style.top))).toBeGreaterThan(0);
  const boxes = await cards.evaluateAll((nodes) =>
    nodes.slice(0, 12).map((node) => {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, bottom: r.bottom };
    }),
  );
  for (let i = 3; i < boxes.length; i++) {
    expect(boxes[i].x).toBeCloseTo(boxes[i - 3].x, 0);
    expect(boxes[i].y).toBeGreaterThan(boxes[i - 3].bottom);
  }
  await page.getByRole('button', { name: '瀑布流', exact: true }).click();
  await expect(grid).toHaveAttribute('data-gallery-layout', 'grid');
  await expect(cards.first()).toHaveCSS('position', 'static');
  await page.getByRole('button', { name: '瀑布流', exact: true }).click();
  await expect(cards.first()).toHaveCSS('position', 'absolute');
});

test('previews have separate cache identities and missing previews fall back to the original', async ({ page }) => {
  const source = '/api/style-gallery/image/source/000000000001.webp';
  const preview = '/api/style-gallery/image/thumb/000000000001.webp';
  await page.goto('/image-style-prompt-gallery');
  await expect(page.locator('[data-gallery-layout] article').first()).toHaveAttribute(
    'data-gallery-near-viewport',
    /true|false/,
  );
  const image = page.locator('[data-gallery-layout] article').first().locator('img');
  await expect(image).toHaveAttribute('src', preview);
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(720);
  expect(
    await page.evaluate(async (source) => {
      const path = '/src/lib/style-gallery-image-client.ts';
      return (await import(path)).isStyleGalleryImageUrlLoaded(source);
    }, source),
  ).toBe(false);

  await page.route('**/api/style-gallery/images', async (route) => {
    const { keys } = route.request().postDataJSON();
    await route.fulfill({
      json: {
        images: Object.fromEntries(
          keys.map((key: string) => [`/api/style-gallery/image/${key}`, `/api/style-gallery/image/${key}`]),
        ),
        expiresAt: null,
      },
    });
  });
  await page
    .getByRole('button', { name: /^放大查看:/ })
    .first()
    .click();
  await expect
    .poll(() =>
      page
        .locator('[role="dialog"] img')
        .evaluateAll(
          (imgs: HTMLImageElement[], source) =>
            imgs.some((img) => img.getAttribute('src') === source && img.naturalWidth === 1664),
          source,
        ),
    )
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(image).toHaveAttribute('src', preview);

  await page.route(`**${preview}`, (route) => route.fulfill({ status: 404, body: 'No derivative' }));
  await page.reload();
  await expect(image).toHaveAttribute('src', source);
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1664);
});
