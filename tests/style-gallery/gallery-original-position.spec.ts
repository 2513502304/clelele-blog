import { expect, type Locator, type Page, test } from '@playwright/test';

test.skip(process.env.GALLERY_SCROLL_FIXTURE !== '1', 'Requires the opt-in long catalog');

const slug = '2026-10-01-000000000060';
const exampleId = 'scroll-95-1';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="960"><path fill="#b9dce5" d="M0 0h640v960H0z"/></svg>';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/style-gallery/tags') {
      return route.fulfill({ json: { version: 1, items: { [slug]: ['定位测试'] } } });
    }
    if (path === '/api/style-gallery/prompt-search-index') {
      return route.fulfill({ json: { [slug]: '唯一命中' } });
    }
    if (path.startsWith('/api/live2d')) return route.abort();
    if (request.resourceType() === 'image') return route.fulfill({ contentType: 'image/svg+xml', body: svg });
    return route.continue();
  });
});

/** Geometry, focus and glow together catch a jump against the old filtered DOM. */
async function expectLocated(page: Page, card: Locator) {
  await expect(card).toBeFocused();
  await expect(card).toBeInViewport({ ratio: 0.5 });
  await expect
    .poll(() => card.evaluate((element) => element.getAnimations().some((animation) => animation.playState === 'running')))
    .toBe(true);
  await expect(page.getByRole('button', { name: /^查看原始位置:/ })).toHaveCount(0);
  for (const key of ['q', 'tag', 'from', 'to', 'platform']) {
    expect(new URL(page.url()).searchParams.has(key)).toBe(false);
  }
}

for (const mode of ['preview', 'index'] as const) {
  test(`${mode}: restore a deep result, its neighbors and the chosen sort without loading every card`, async ({
    page,
  }, testInfo) => {
    const path = mode === 'preview' ? '/image-style-prompt-gallery' : '/image-style-prompt-gallery/index';
    const query = mode === 'preview' ? '唯一命中' : '#定位测试';
    await page.goto(
      `${path}?q=${encodeURIComponent(query)}&tag=${encodeURIComponent('定位测试')}&from=2026-09-26&to=2026-09-26&sort=id&dir=desc&layout=grid`,
    );
    const cards = page.locator('[data-gallery-marquee-area] > [data-gallery-selection-id]');
    await expect(cards).toHaveCount(1);
    const locate = cards.first().getByRole('button', { name: /^查看原始位置:/ });
    await expect(locate).toBeVisible();
    await cards.first().screenshot({ path: testInfo.outputPath('filtered-card.png') });
    // Selection mode retains its own controls and must not unexpectedly clear a selection.
    await page.getByRole('button', { name: '批量标签', exact: true }).click();
    await expect(locate).toHaveCount(0);
    await page.getByRole('button', { name: '退出多选', exact: true }).last().click();
    await locate.focus();
    await page.keyboard.press('Enter');

    const located = page.locator(`#style-gallery-${mode === 'preview' ? 'preview' : 'index'}-source-${slug}`);
    await expectLocated(page, located);
    expect(new URL(page.url()).searchParams.get('sort')).toBe('id');
    expect(new URL(page.url()).searchParams.get('dir')).toBe('desc');
    expect(new URL(page.url()).searchParams.get('layout')).toBe('grid');
    // Descending order places this result beyond both the 24- and 72-card first batches.
    const identities = await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-gallery-selection-id')));
    const index = identities.indexOf(slug);
    expect(index).toBeGreaterThan(72);
    expect(identities[index - 1]).toBe('2026-10-01-000000000061');
    expect(identities[index + 1]).toBe('2026-10-01-00000000005f');
    expect(identities.length).toBeLessThan(192);
    if (mode === 'preview') await expect(page.locator('[data-gallery-layout]')).toHaveAttribute('data-gallery-layout', 'grid');
  });
}

for (const grouped of [false, true]) {
  test(`sub-gallery grouped=${grouped}: reset visual search and locate the current full-list representative`, async ({
    page,
  }) => {
    await page.route('**/api/style-gallery/visual-search', (route) => route.fulfill({ json: { matches: [exampleId] } }));
    await page.goto(`/image-style-prompt-gallery/examples?sort=id&grouped=${grouped}&platform=PixAI`);
    await page.getByRole('button', { name: '视觉筛选', exact: true }).click();
    await page.getByRole('button', { name: '调色盘', exact: true }).click();
    await page.getByRole('button', { name: '开始筛选', exact: true }).click();
    const cards = page.locator('[data-gallery-layout] > figure');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveAttribute('id', `style-gallery-overview-example-${exampleId}`);
    await cards
      .first()
      .getByRole('button', { name: /^查看原始位置:/ })
      .click();

    // The first member was filtered out. Its cover must return when the group is restored.
    const cover = grouped ? 'scroll-95-0' : exampleId;
    const target = page.locator(`#style-gallery-overview-example-${cover}`);
    await expectLocated(page, target);
    await expect(page.getByRole('button', { name: '视觉筛选', exact: true })).toBeAttached();
    await expect(page.locator('[data-gallery-layout]')).toHaveAttribute('data-gallery-layout', 'masonry');
    await expect(page.getByRole('button', { name: '同源折叠', exact: true })).toHaveAttribute('aria-pressed', String(grouped));
    const ids = await cards.evaluateAll((nodes) => nodes.map((node) => node.id));
    const index = ids.indexOf(`style-gallery-overview-example-${cover}`);
    expect(index).toBeGreaterThan(24);
    expect(ids[index - 1]).toBe(`style-gallery-overview-example-scroll-${grouped ? '94-0' : '95-0'}`);
    expect(ids[index + 1]).toBe(`style-gallery-overview-example-scroll-96-0`);
  });
}

test('a late visual search cannot replace the restored list or move focus away from the target', async ({ page }) => {
  let release: (() => void) | undefined;
  await page.route('**/api/style-gallery/visual-search', async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({ json: { matches: [] } }).catch(() => {});
  });
  await page.goto(`/image-style-prompt-gallery?q=${encodeURIComponent('唯一命中')}`);
  const locate = page.getByRole('button', { name: /^查看原始位置:/ });
  await expect(locate).toHaveCount(1);
  await page.getByRole('button', { name: '视觉筛选', exact: true }).click();
  await page.getByRole('button', { name: '调色盘', exact: true }).click();
  await page.getByRole('button', { name: '开始筛选', exact: true }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await locate.click();
  const target = page.locator(`#style-gallery-preview-source-${slug}`);
  await expectLocated(page, target);
  release?.();
  await page.waitForTimeout(200);
  await expect(target).toBeFocused();
  expect(await page.locator('[data-gallery-layout] > article').count()).toBeGreaterThan(24);
});
