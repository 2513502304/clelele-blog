import { expect, type Locator, type Page, test } from '@playwright/test';

async function setup(page: Page, path: string) {
  await page.route('**/*', (route) => {
    if (route.request().url().includes('/api/live2d')) return route.abort();
    if (route.request().resourceType() === 'image')
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640"><rect width="480" height="640" fill="#cbbad2"/></svg>',
      });
    return route.continue();
  });
  await page.goto(`/image-style-prompt-gallery${path}`, { waitUntil: 'domcontentloaded' });
  const trigger = page.getByRole('button', { name: '批量标签', exact: true });
  await expect.poll(() => trigger.evaluate((el) => !el.closest('astro-island')?.hasAttribute('ssr'))).toBe(true);
  await trigger.click();
}
async function dragInside(page: Page, card: Locator, modifier?: 'Control' | 'Shift') {
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  if (!box) throw new Error('Missing card geometry');
  const y = Math.max(100, box.y + Math.min(box.height / 2, 150));
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.move(box.x + 20, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 50, y + 25, { steps: 5 });
  await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
}

for (const path of ['', '/index', '/examples']) {
  test(`marquee replaces/appends selections and wheel scrolling retains the gesture: ${path || 'preview'}`, async ({
    page,
  }) => {
    await setup(page, path);
    let accidentalDialogs = 0;
    page.on('dialog', async (dialog) => {
      accidentalDialogs++;
      await dialog.dismiss();
    });
    // Native selection above the gallery remains available while multi-select is enabled.
    const heading = page.locator('h1').first();
    await heading.scrollIntoViewIfNeeded();
    const headingBox = await heading.boundingBox();
    if (!headingBox) throw new Error('Missing heading');
    await page.mouse.move(headingBox.x + 20, headingBox.y + 10);
    await page.mouse.down();
    expect(
      await heading.evaluate((el) => {
        const event = new Event('selectstart', { bubbles: true, cancelable: true });
        el.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    ).toBe(false);
    await page.mouse.up();
    const cards = page.locator('[data-gallery-selection-id]');
    const selected = page.locator('[data-gallery-selection-id][data-selected="true"]');
    const dock = page.locator('[data-gallery-selection-dock]');
    if (!path) {
      const collapse = dock.getByRole('button', { name: /^已选择/ });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(collapse).toHaveAttribute('aria-expanded', 'false');
      await page.setViewportSize({ width: 1512, height: 870 });
      await expect(collapse).toHaveAttribute('aria-expanded', 'true');
      await collapse.click();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.setViewportSize({ width: 1512, height: 870 });
      await expect(collapse).toHaveAttribute('aria-expanded', 'false');
      await collapse.click();
    }
    // Real users begin in the empty margin above the grid, not necessarily on an image.
    await cards.first().scrollIntoViewIfNeeded();
    const firstBox = await cards.first().boundingBox();
    if (!firstBox) throw new Error('Missing card');
    await page.mouse.move(firstBox.x - 20, firstBox.y + firstBox.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(firstBox.x + 60, firstBox.y + firstBox.height * 0.5, { steps: 8 });
    await expect(page.locator('[data-gallery-marquee]')).toBeVisible();
    await page.mouse.up();
    await expect(selected).toHaveCount(1);
    expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toBe('');
    // Drag from an action button without accidentally invoking Select all on pointerup.
    const action = await dock.getByRole('button', { name: '全选筛选结果', exact: true }).boundingBox();
    const beforeActionDrag = await dock.boundingBox();
    if (!action || !beforeActionDrag) throw new Error('Missing dock action');
    await page.mouse.move(action.x + 30, action.y + 20);
    await page.mouse.down();
    await page.mouse.move(action.x - 70, action.y - 30, { steps: 8 });
    await page.mouse.up();
    expect((await dock.boundingBox())?.x).toBeLessThan(beforeActionDrag.x - 80);
    await expect(selected).toHaveCount(1);
    await page.waitForTimeout(550);
    const handle = dock.getByRole('button', { name: '拖动多选工具栏' });
    const oldDock = await dock.boundingBox();
    const handleBox = await handle.boundingBox();
    if (!oldDock || !handleBox) throw new Error('Missing dock');
    await page.mouse.move(handleBox.x + 10, handleBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(handleBox.x - 150, handleBox.y - 70, { steps: 6 });
    await page.mouse.up();
    expect((await dock.boundingBox())?.x).toBeLessThan(oldDock.x - 100);
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    await page.setViewportSize({ width: 1100, height: 700 });
    const fitted = await dock.boundingBox();
    expect((fitted?.x ?? 0) + (fitted?.width ?? 0)).toBeLessThanOrEqual(1100);
    await page.setViewportSize({ width: 1512, height: 870 });
    // Park the movable dock in the sidebar before exercising cards underneath its prior position.
    const parkedHandle = await handle.boundingBox();
    if (!parkedHandle) throw new Error('Missing handle');
    await page.mouse.move(parkedHandle.x + 10, parkedHandle.y + 10);
    await page.mouse.down();
    await page.mouse.move(30, 160, { steps: 8 });
    await page.mouse.up();
    await dragInside(page, cards.nth(0));
    await expect(selected).toHaveCount(1);
    await dragInside(page, cards.nth(1), 'Control');
    await expect(selected).toHaveCount(2);
    await dragInside(page, cards.nth(2), 'Shift');
    await expect(selected).toHaveCount(3);
    await dragInside(page, cards.nth(1));
    await expect(selected).toHaveCount(1);
    await expect(cards.nth(1)).toHaveAttribute('data-selected', 'true');
    await cards.nth(0).scrollIntoViewIfNeeded();
    const bounds = await cards.nth(0).boundingBox();
    if (!bounds) throw new Error('Missing first card');
    await page.mouse.move(bounds.x + 20, Math.max(bounds.y + bounds.height / 2, 140));
    await page.mouse.down();
    await page.mouse.move(bounds.x + 60, Math.max(bounds.y + bounds.height / 2, 140) + 10);
    const before = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 650);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before);
    await expect(page.locator('[data-gallery-marquee]')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(cards.nth(1)).toHaveAttribute('data-selected', 'true');
    await expect(selected).toHaveCount(1);
    const position = await page.evaluate(() => scrollY);
    await dock.getByRole('button', { name: '清空选择', exact: true }).click();
    await expect(selected).toHaveCount(0);
    expect(await page.evaluate(() => scrollY)).toBe(position);
    await dock.getByRole('button', { name: /^已选择/ }).click();
    await expect(dock.getByRole('button', { name: '清空选择' })).toHaveCount(0);
    await page.screenshot({ path: `/tmp/gallery56-selection-${path.slice(1) || 'preview'}.png` });
    await dock.getByRole('button', { name: /^已选择/ }).click();
    await dock.getByRole('button', { name: '退出多选', exact: true }).click();
    await expect(dock).toHaveCount(0);
    expect(accidentalDialogs).toBe(0);
  });
}

test('merge pair survives filtering and opens automatically with the saved token', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('style-gallery-upload-token', 'test-only'));
  let hashes: string[] = [];
  await setup(page, '');
  await page.route('**/api/style-gallery/merge', (route) => {
    hashes = route.request().postDataJSON().hashes;
    return route.fulfill({ status: 409, body: 'Test preview conflict' });
  });
  await page.getByRole('button', { name: '合并卡片', exact: true }).click();
  const cards = page.locator('[data-gallery-selection-id]');
  const first = await cards.nth(0).getAttribute('data-gallery-selection-id');
  const second = await cards.nth(1).getAttribute('data-gallery-selection-id');
  await cards.nth(0).getByRole('checkbox').check();
  const search = page.locator('input[placeholder^="搜索文本"]');
  await search.fill(second?.slice(-12) ?? 'missing');
  await expect(cards).toHaveCount(1);
  await cards.first().getByRole('checkbox').check();
  const dock = page.locator('[data-gallery-selection-dock]');
  await expect(dock).toContainText(first?.slice(-12) ?? 'missing');
  await dock.getByRole('button', { name: '确认两张并比较' }).click();
  await expect.poll(() => hashes.length).toBe(2);
  expect(hashes.map((hash) => hash.slice(0, 12))).toEqual([first?.slice(-12), second?.slice(-12)]);
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('数据已发生变化');
});

test('detail sub-images share marquee, floating platform/download/delete actions and exit', async ({ page }) => {
  await page.route('**/*', (route) => {
    if (route.request().url().includes('/api/live2d')) return route.abort();
    if (route.request().resourceType() === 'image')
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640"/>',
      });
    return route.continue();
  });
  await page.goto('/image-style-prompt-gallery/2026-08-18-4a3484f05086');
  const toggle = page.getByRole('button', { name: '选择图片', exact: true });
  await expect.poll(() => toggle.evaluate((el) => !el.closest('astro-island')?.hasAttribute('ssr'))).toBe(true);
  await toggle.click();
  const cards = page.locator('[data-gallery-selection-id]');
  const toolbar = page.locator('[data-gallery-management].sticky');
  await toolbar.scrollIntoViewIfNeeded();
  const toolbarBox = await toolbar.boundingBox();
  if (!toolbarBox) throw new Error('Missing selection toolbar');
  await page.mouse.move(toolbarBox.x + 3, toolbarBox.y + 3);
  await page.mouse.down();
  await page.mouse.move(toolbarBox.x + 80, toolbarBox.y + 100, { steps: 5 });
  await expect(page.locator('[data-gallery-marquee]')).toBeHidden();
  await page.mouse.up();
  await expect(page.locator('[data-gallery-selection-id][data-selected="true"]')).toHaveCount(0);
  await dragInside(page, cards.first());
  const dock = page.locator('[data-gallery-selection-dock]');
  await expect(dock.getByRole('button', { name: '已选择 1 项', exact: true })).toBeVisible();
  for (const name of ['下载', '删除', '更改平台']) await expect(dock.getByRole('button', { name, exact: true })).toBeEnabled();
  await dock.getByRole('button', { name: '全选图片', exact: true }).click();
  await expect(page.locator('[data-gallery-selection-id][data-selected="true"]')).toHaveCount(await cards.count());
  await dock.getByRole('button', { name: '退出多选', exact: true }).click();
  await expect(dock).toHaveCount(0);
  await expect(page.locator('[data-gallery-selection-id][data-selected="true"]')).toHaveCount(0);
});

test('marquee geometry follows wheel scrolling with a stationary pointer and returns to its anchor', async ({ page }) => {
  await setup(page, '');
  const card = page.locator('[data-gallery-selection-id]').first();
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  if (!box) throw new Error('Missing card');
  const x = box.x - 20,
    y = box.y + 120;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 100, y + 60, { steps: 5 });
  const rectangle = page.locator('[data-gallery-marquee]');
  await expect(rectangle).toBeVisible();
  const startScroll = await page.evaluate(() => scrollY);
  const start = await rectangle.boundingBox();
  if (!start) throw new Error('Missing marquee');
  await page.mouse.wheel(0, 350);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(startScroll + 300);
  await expect
    .poll(async () => {
      const actual = await rectangle.boundingBox();
      if (!actual) return Infinity;
      const delta = (await page.evaluate(() => scrollY)) - startScroll;
      return Math.abs(actual.y - (start.y - delta)) + Math.abs(actual.height - (start.height + delta));
    })
    .toBeLessThan(2);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(startScroll + 300);
  await page.mouse.wheel(0, -350);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(startScroll + 2);
  await expect.poll(async () => Math.abs(((await rectangle.boundingBox())?.height ?? Infinity) - start.height)).toBeLessThan(2);
  await page.mouse.up();
  await expect(rectangle).toBeHidden();
});

test('stable pointer movement reuses card geometry rather than measuring every mounted card each frame', async ({ page }) => {
  await setup(page, '');
  const card = page.locator('[data-gallery-selection-id]').first();
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  if (!box) throw new Error('Missing card');
  await page.mouse.move(box.x + 20, box.y + 130);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 180, { steps: 5 });
  await expect(card).toHaveAttribute('data-selected', 'true');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const original = Element.prototype.getBoundingClientRect;
    (window as unknown as { cardMeasurements: number }).cardMeasurements = 0;
    Element.prototype.getBoundingClientRect = function () {
      if (this.hasAttribute('data-gallery-selection-id'))
        (window as unknown as { cardMeasurements: number }).cardMeasurements++;
      return original.call(this);
    };
  });
  await page.mouse.move(box.x + 100, box.y + 190, { steps: 20 });
  const count = await page.evaluate(() => (window as unknown as { cardMeasurements: number }).cardMeasurements);
  expect(count).toBeLessThan(await page.locator('[data-gallery-selection-id]').count());
  await page.mouse.up();
});
