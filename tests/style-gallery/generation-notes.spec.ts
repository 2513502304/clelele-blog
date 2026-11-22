import { expect, type Page, test } from '@playwright/test';

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="960"><rect width="640" height="960" fill="#adddd1"/></svg>';

async function imagesOnlyFixture(page: Page) {
  await page.route('**/*', (route) => {
    const path = new URL(route.request().url()).pathname;
    // Exercise real page launchers; server metadata comes from the isolated read-only fixture.
    if (path.startsWith('/api/style-gallery/') && route.request().method() !== 'GET') return route.abort();
    if (path.startsWith('/api/live2d')) return route.abort();
    if (path.startsWith('/api/style-gallery/image/') || route.request().resourceType() === 'image')
      return route.fulfill({ contentType: 'image/svg+xml', body: svg });
    return route.continue();
  });
}

async function checkPromptViewer(page: Page, prompt: string) {
  const details = page.locator('[data-generation-reader]');
  await expect(details).toBeVisible();
  await expect(details).toHaveAttribute('data-expanded', 'false');
  expect((await details.boundingBox())?.width).toBeLessThanOrEqual(192);
  await details.getByRole('button', { name: '复制全部生成图片 prompt', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(prompt);
  await expect(details.locator('output')).not.toBeEmpty();
  await expect(details.locator('output')).toBeEmpty();
  await details.locator('.generation-glass-toggle').click();
  const full = details.locator('[data-prompt-text]');
  expect(await full.textContent()).toBe(prompt);
  const pageScroll = await page.evaluate(() => scrollY);
  await full.hover();
  await page.mouse.wheel(0, 300);
  await expect.poll(() => full.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollY)).toBe(pageScroll);
  await details.getByRole('button', { name: '复制全部生成图片 prompt', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(prompt);
}

test('group overview has no misleading note excerpt; each image opens its own complete prompt and platform', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await imagesOnlyFixture(page);
  await page.goto('/image-style-prompt-gallery/examples', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-example-note]')).toHaveCount(0);
  const stack = page.locator('.gallery-source-stack').first();
  await stack.scrollIntoViewIfNeeded();
  await expect(stack.locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
  await stack.click();
  const prompt = Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 行：保留角色特征、花瓣、水彩笔触和完整换行。`).join('\n');
  await checkPromptViewer(page, prompt);
  await expect(page.locator('[data-generation-platform]')).toHaveText('PixAI');
  const panel = page.locator('[data-generation-reader]');
  const before = await panel.boundingBox();
  if (!before) throw new Error('Missing prompt reader');
  // Drag from prompt text, not a dedicated handle; releasing must not toggle or copy.
  await page.mouse.move(before.x + 80, before.y + 150);
  await page.mouse.down();
  await page.mouse.move(before.x + 230, before.y + 90, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())?.x).toBeGreaterThan(before.x + 100);
  await expect(panel).toHaveAttribute('data-expanded', 'true');
  // Cancelled mouse drags must not swallow the next touch/pen-generated click.
  for (const ending of ['pointercancel', 'blur', 'outside-release']) {
    await panel.evaluate((el, ending) => {
      const box = el.getBoundingClientRect();
      const start = { bubbles: true, pointerId: 7, pointerType: 'mouse', button: 0, clientX: box.x + 30, clientY: box.y + 30 };
      el.dispatchEvent(new PointerEvent('pointerdown', start));
      window.dispatchEvent(new PointerEvent('pointermove', { ...start, clientX: start.clientX + 20 }));
      window.dispatchEvent(
        ending === 'blur' ? new Event('blur') : new PointerEvent(ending === 'pointercancel' ? ending : 'pointerup', start),
      );
      el.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    }, ending);
    await expect(panel).toHaveAttribute('data-expanded', 'false');
    await panel.locator('.generation-glass-toggle').click();
  }
  await page.screenshot({ path: '/tmp/gallery-glass-reader.png' });
});

test('detail note is three preview rows and opens its complete generation prompt', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await imagesOnlyFixture(page);
  await page.goto('/image-style-prompt-gallery/2026-09-23-35dc5191ccad', { waitUntil: 'domcontentloaded' });
  const input = page.locator('[data-example-note-input]');
  await input.fill('多行输入\n'.repeat(100));
  const inputBox = await input.evaluate((el) => {
    const css = getComputedStyle(el);
    return {
      rows: (el.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom)) / parseFloat(css.lineHeight),
      scroll: el.scrollHeight > el.clientHeight,
    };
  });
  expect(inputBox.rows).toBeCloseTo(5, 1);
  expect(inputBox.scroll).toBe(true);
  await page.evaluate(() => {
    document.documentElement.dataset.readingTransparency = 'solid';
  });
  const management = page.locator('[data-gallery-management]');
  await expect(management).toHaveCSS('backdrop-filter', 'none');
  expect(
    await management.evaluate((el) => {
      const color = getComputedStyle(el).backgroundColor;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return ctx.getImageData(0, 0, 1, 1).data[3];
    }),
  ).toBe(255);
  const note = page.locator('[data-example-note]').first();
  await note.scrollIntoViewIfNeeded();
  const box = await note.evaluate((el) => ({
    rows: el.clientHeight / Number.parseFloat(getComputedStyle(el).lineHeight),
    overflow: el.scrollHeight > el.clientHeight,
  }));
  expect(box.rows).toBeCloseTo(3, 1);
  expect(box.overflow).toBe(true);
  const prompt = (await note.textContent()) ?? '';
  expect(prompt).not.toBe('');
  await page.screenshot({ path: '/tmp/gallery-detail-three-rows.png' });
  const card = note.locator('xpath=ancestor::figure');
  await expect(card.locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
  await card
    .locator('button')
    .filter({ has: page.locator('img') })
    .first()
    .click();
  await checkPromptViewer(page, prompt);
  await page.screenshot({ path: '/tmp/gallery-detail-generation-note.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = page.locator('[data-generation-reader]');
  const bounds = await panel.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
  expect(bounds?.y).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: '/tmp/gallery-prompt-mobile.png' });
});

test('platform remains visible without a note, and does not leak the previous image prompt', async ({ page }) => {
  await imagesOnlyFixture(page);
  await page.goto('/image-style-prompt-gallery/examples', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.gallery-source-stack').first().locator('xpath=ancestor::astro-island')).not.toHaveAttribute(
    'ssr',
  );
  await page.evaluate(async () => {
    const path = '/src/store/modal.ts';
    const { openModal } = await import(path);
    openModal('imageLightbox', {
      images: [{ src: '/api/site-assets/home', alt: 'Platform-only output', generationPlatform: 'GPT-Image' }],
      currentIndex: 0,
    });
  });
  await expect(page.locator('[data-generation-platform]')).toHaveText('GPT-Image');
  await expect(page.locator('[data-generation-reader]')).toHaveAttribute('data-expanded', 'false');
  await expect(page.locator('.generation-glass-toggle')).toHaveCount(0);
  expect(await page.locator('[data-generation-reader]').ariaSnapshot()).toContain('GPT-Image');
});

test('detail masonry reserves each aspect ratio and grid toggle preserves selections and URL state', async ({ page }) => {
  await imagesOnlyFixture(page);
  await page.goto('/image-style-prompt-gallery/2026-09-23-35dc5191ccad', { waitUntil: 'domcontentloaded' });
  const grid = page.locator('[data-gallery-layout]');
  const toggle = page.getByRole('button', { name: '瀑布流', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(grid).toHaveAttribute('data-gallery-layout', 'masonry');
  const cards = grid.locator('figure');
  await cards.first().scrollIntoViewIfNeeded();
  await expect
    .poll(async () => ((await cards.first().boundingBox())?.height ?? 0) - ((await cards.nth(1).boundingBox())?.height ?? 0))
    .toBeGreaterThan(80);
  await cards.first().getByRole('checkbox').check();
  await toggle.click();
  await expect(page).toHaveURL(/layout=grid/);
  await expect(grid).toHaveAttribute('data-gallery-layout', 'grid');
  expect((await cards.first().boundingBox())?.height ?? 0).toBeCloseTo((await cards.nth(1).boundingBox())?.height ?? 0, 0);
  await expect(cards.first().getByRole('checkbox')).toBeChecked();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(grid).toHaveAttribute('data-gallery-layout', 'grid');
  await toggle.click();
  await expect(grid).toHaveAttribute('data-gallery-layout', 'masonry');
});

test('reference viewer follows wheel travel across fine and coarse input', async ({ page }) => {
  await imagesOnlyFixture(page);
  await page.goto('/image-style-prompt-gallery/2026-09-23-35dc5191ccad', { waitUntil: 'domcontentloaded' });
  const studio = page.locator('.gallery-generator');
  await expect(studio.locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
  await studio.getByRole('button', { name: '用此提示词生图' }).click();
  await studio.getByRole('button', { name: '生成记录' }).click();
  await studio.getByRole('button', { name: '放大查看' }).click();
  const dialog = studio.getByRole('dialog');
  const surface = dialog.locator('.studio-inspect-surface');
  await expect.poll(() => surface.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await surface.hover();
  await page.mouse.wheel(0, -100);
  await expect(dialog.locator('output')).toHaveText('108%');
  // Twenty precision-trackpad deltas must exactly undo one 100px notch.
  await surface.evaluate((el) => {
    for (let i = 0; i < 20; i++) el.dispatchEvent(new WheelEvent('wheel', { deltaY: 5, cancelable: true }));
  });
  await expect(dialog.locator('output')).toHaveText('100%');
  await surface.dispatchEvent('wheel', { deltaMode: 2, deltaY: -3 });
  await expect(dialog.locator('output')).toHaveText('112%');
});

test('published outputs compare without credentials and both panes follow the same zoom', async ({ page }) => {
  await imagesOnlyFixture(page);
  await page.goto('/image-style-prompt-gallery/2026-09-23-35dc5191ccad', { waitUntil: 'domcontentloaded' });
  const launch = page.locator('.studio-example-compare button').first();
  await expect(launch.locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
  await launch.click();
  const dialog = page.getByRole('dialog', { name: '放大对比' });
  const seam = dialog.getByRole('slider', { name: '参考图对比分界' });
  await seam.focus();
  await seam.press('Shift+ArrowRight');
  await expect(seam).toHaveAttribute('aria-valuenow', '60');
  const area = dialog.locator('.studio-inspect-surface');
  const bounds = await area.boundingBox();
  if (!bounds) throw new Error('Missing comparison surface');
  await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(seam).toHaveAttribute('aria-valuenow', '25');
  await expect(dialog.getByRole('slider', { name: /参考占比/ })).toHaveValue('25');
  await dialog.getByRole('button', { name: '并排' }).click();
  const panes = area.locator('.studio-pair-pane');
  expect((await panes.nth(1).boundingBox())?.x).toBeCloseTo(bounds.x + bounds.width / 2, 0);
  await expect
    .poll(() =>
      panes
        .first()
        .locator('img')
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await dialog.getByRole('button', { name: '放大', exact: true }).click();
  await expect(dialog.locator('output')).toHaveText('112%');
  const transforms = await panes.locator('img').evaluateAll((imgs) => imgs.map((img) => getComputedStyle(img).transform));
  expect(transforms[0]).toBe(transforms[1]);
  await dialog.getByRole('button', { name: '适应画布' }).click();
  await expect(dialog.locator('output')).toHaveText('100%');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('new GPT defaults and model order survive a draft reset', async ({ page }) => {
  await imagesOnlyFixture(page);
  await page.goto('/image-style-prompt-gallery/2026-09-23-35dc5191ccad', { waitUntil: 'domcontentloaded' });
  const studio = page.locator('.gallery-generator');
  await expect(studio.locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
  await studio.getByRole('button', { name: '用此提示词生图' }).click();
  const model = studio.getByRole('combobox', { name: '模型', exact: true });
  await expect(model).toHaveValue('gpt-image-2.6-sunburst');
  expect((await model.locator('option').allTextContents()).slice(0, 4)).toEqual([
    'gpt-image-2.6-sunburst',
    'gpt-image-2.6-flare',
    'gpt-image-2.5-sunburst',
    'gpt-image-2.5-flare',
  ]);
  await model.selectOption('gpt-image-2.5-flare');
  await studio.getByRole('combobox', { name: '尺寸', exact: true }).selectOption('1024x1024');
  await studio.getByRole('combobox', { name: '质量', exact: true }).selectOption('low');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(studio.locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
  await studio.getByRole('button', { name: '用此提示词生图' }).click();
  await expect(model).toHaveValue('gpt-image-2.5-flare');
  await studio.getByRole('button', { name: '恢复默认参数' }).click();
  await expect(model).toHaveValue('gpt-image-2.6-sunburst');
  await expect(studio.getByRole('combobox', { name: '尺寸', exact: true })).toHaveValue('auto');
  await expect(studio.getByRole('combobox', { name: '质量', exact: true })).toHaveValue('high');
});
