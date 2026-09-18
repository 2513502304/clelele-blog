import { expect, type Page, test } from '@playwright/test';

async function openCuration(page: Page, name: string) {
  const trigger = page.getByRole('button', { name, exact: true });
  // Astro SSR buttons exist before their React click handlers are attached.
  await expect
    .poll(() => trigger.evaluate((el) => !el.closest('astro-island')?.hasAttribute('ssr')), { timeout: 30_000 })
    .toBe(true);
  await trigger.click();
}

const slug = '2026-09-14-a25e4e99486d';
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="900"><rect width="640" height="900" fill="#ddadb8"/></svg>';

for (const mobile of [false, true]) {
  for (const path of ['', '/index']) {
    test(`manual collection form keeps drafts and fits ${mobile ? 'mobile' : 'desktop'} ${path || 'preview'}`, async ({
      page,
    }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      let mutations = 0;
      await page.route('**/*', async (route) => {
        if (route.request().resourceType() === 'image') return route.fulfill({ contentType: 'image/svg+xml', body: svg });
        if (route.request().url().includes('/api/style-gallery/') && route.request().method() !== 'GET') {
          mutations++;
          return route.fulfill({ status: 401 });
        }
        return route.continue();
      });
      await page.goto(`/image-style-prompt-gallery${path}`, { waitUntil: 'domcontentloaded' });
      const management = page.locator('[data-gallery-management]');
      const collectBox = await management.getByRole('button', { name: '收藏图片', exact: true }).boundingBox();
      const bulkBox = await management.getByRole('button', { name: '批量标签', exact: true }).boundingBox();
      expect(Math.abs((collectBox?.y ?? 0) - (bulkBox?.y ?? 0))).toBeLessThan(2);
      await openCuration(page, '收藏图片');
      const dialog = page.getByRole('dialog', { name: '收藏图片', exact: true });
      await expect(dialog.getByLabel('模型反推 Prompt')).toBeVisible();
      expect((await dialog.getByLabel('模型反推 Prompt').boundingBox())?.height).toBeGreaterThanOrEqual(140);
      await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
      const longPrompt = '保留真正的 Prompt <主体>，段落和换行。\n'.repeat(2500);
      await dialog.getByLabel('模型反推 Prompt').fill(longPrompt);
      const dimensions = await dialog
        .getByLabel('模型反推 Prompt')
        .evaluate((el) => ({ height: el.clientHeight, scroll: el.scrollHeight }));
      expect(dimensions.height).toBeLessThan(250);
      expect(dimensions.scroll).toBeGreaterThan(dimensions.height);
      await expect(dialog.getByRole('combobox', { name: '标签（选填）' })).toBeAttached();
      page.once('dialog', (confirmation) => confirmation.dismiss());
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      await expect(dialog.getByLabel('模型反推 Prompt')).toHaveValue(longPrompt);
      const box = await dialog.boundingBox();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) + 1);
      await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeInViewport();
      expect(mutations).toBe(0);
      await page.screenshot({ path: `/tmp/gallery51-collect-${mobile ? 'mobile' : 'desktop'}${path.replace('/', '-')}.png` });
      page.once('dialog', (confirmation) => confirmation.accept());
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      await expect(dialog).not.toBeVisible();
    });
  }
}

test('detail prompt edit preserves a rejected draft and publishes successful text to copy/display', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('style-gallery-upload-token', 'test-only'));
  let attempts = 0;
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() === 'image') return route.fulfill({ contentType: 'image/svg+xml', body: svg });
    if (route.request().method() === 'PATCH' && route.request().url().includes('/api/style-gallery/prompts/')) {
      attempts++;
      expect(route.request().headers().authorization).toBe('Bearer test-only');
      const body = route.request().postDataJSON();
      if (attempts === 1) return route.fulfill({ status: 409, body: 'Conflict' });
      return route.fulfill({
        json: {
          activePromptId: 'b'.repeat(64),
          prompts: [
            {
              id: 'b'.repeat(64),
              prompt: body.prompt,
              originalPrompt: body.originalPrompt || undefined,
              model: 'Collected',
              importedAt: new Date().toISOString(),
            },
          ],
        },
      });
    }
    return route.continue();
  });
  await page.goto(`/image-style-prompt-gallery/${slug}`, { waitUntil: 'domcontentloaded' });
  await openCuration(page, '编辑 Prompt');
  const dialog = page.getByRole('dialog', { name: '编辑 Prompt', exact: true });
  await expect(dialog.getByLabel('管理 token')).toHaveValue('test-only');
  await dialog.getByLabel('模型反推 Prompt').fill('Corrected reusable prompt');
  await dialog.getByLabel('用户原始 Prompt（选填）').fill('Added original\nSecond line');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('该提示词已被修改');
  await expect(dialog.getByLabel('模型反推 Prompt')).toHaveValue('Corrected reusable prompt');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Corrected reusable prompt', { exact: true })).toBeVisible();
  await expect(page.locator('[data-gallery-original-prompt]')).toContainText('Added original');
  await openCuration(page, '编辑 Prompt');
  await dialog.getByLabel('用户原始 Prompt（选填）').fill('');
  await dialog.getByLabel('模型反推 Prompt').fill('Long model prompt for sticky alignment.\n'.repeat(100));
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('[data-gallery-original-prompt]')).toHaveCount(0);
  const bottom = await page
    .locator('[data-gallery-detail-sticky]')
    .evaluate((el) => ({ column: el.getBoundingClientRect().bottom, image: el.children[1].getBoundingClientRect().bottom }));
  expect(Math.abs(bottom.column - bottom.image)).toBeLessThan(2);
  const article = page.locator('article[data-pagefind-body]');
  await article.evaluate((element) => window.scrollTo(0, element.getBoundingClientRect().bottom + scrollY - innerHeight + 120));
  await expect
    .poll(() =>
      article.evaluate((element) => {
        const left = element.querySelector('aside')?.children[1].getBoundingClientRect();
        const right = element.querySelector(':scope > section .overflow-hidden')?.getBoundingClientRect();
        return left && right ? Math.abs(left.bottom - right.bottom) : Number.POSITIVE_INFINITY;
      }),
    )
    .toBeLessThan(2);
});

test('manual upload sends collection fields and navigates after saving without a discard prompt', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('style-gallery-upload-token', 'test-only'));
  const writes: string[] = [];
  let discardPrompts = 0;
  page.on('dialog', (dialog) => {
    discardPrompts++;
    void dialog.dismiss();
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/style-gallery-visual-feature-browser.ts'))
      return route.fulfill({
        contentType: 'text/javascript',
        body: 'export async function computeStyleGalleryVisualFeatureFromFile(file, imageHash) { return { imageHash }; }',
      });
    if (route.request().resourceType() === 'image') return route.fulfill({ contentType: 'image/svg+xml', body: svg });
    if (url.pathname === '/api/style-gallery/source-upload') {
      writes.push('image');
      expect(route.request().headers().authorization).toBe('Bearer test-only');
      return route.fulfill({ json: { uploaded: true } });
    }
    if (url.pathname === '/api/style-gallery/manual') {
      writes.push('metadata');
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({
        prompt: 'My reusable prompt\nSecond line\n\nThird paragraph',
        originalPrompt: 'Original instruction\nNext instruction',
        model: 'My model',
        tags: ['插画', '现实'],
      });
      expect(body.images).toHaveLength(2);
      expect(body.images[0].imageHash).toMatch(/^[a-f0-9]{64}$/);
      expect(body.images[1].imageHash).not.toBe(body.images[0].imageHash);
      expect(body.images[0].extension).toBe('png');
      return route.fulfill({ json: { slug, created: true, visualIndexUpdated: true } });
    }
    return route.continue();
  });
  await page.goto('/image-style-prompt-gallery', { waitUntil: 'domcontentloaded' });
  await openCuration(page, '收藏图片');
  const dialog = page.getByRole('dialog', { name: '收藏图片', exact: true });
  await dialog.getByLabel('参考图片', { exact: true }).setInputFiles([
    { name: 'sample.png', mimeType: 'image/png', buffer: Buffer.from('test-image') },
    { name: 'second.png', mimeType: 'image/png', buffer: Buffer.from('second-image') },
  ]);
  await dialog.getByLabel('模型反推 Prompt').fill('My reusable prompt\nSecond line\n\nThird paragraph');
  await dialog.getByLabel('用户原始 Prompt（选填）').fill('Original instruction\nNext instruction');
  await dialog.getByLabel('模型名称（选填）').fill('My model');
  const tagInput = dialog.getByRole('combobox', { name: '标签（选填）' });
  await tagInput.fill('插画');
  await tagInput.press('Enter');
  await tagInput.fill('现实'); // Saving also includes the last uncommitted draft.
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${slug}$`), { timeout: 60_000 });
  expect(writes).toEqual(['image', 'image', 'metadata']);
  expect(discardPrompts).toBe(0);
});

for (const mobile of [false, true]) {
  test(`collection scroll contains selected images and visible tag suggestions ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 650 } : { width: 1280, height: 720 });
    await page.route('**/api/style-gallery/tags*', (route) =>
      route.fulfill({ json: { version: 1, updatedAt: new Date().toISOString(), items: { sample: ['插画', '现实'] } } }),
    );
    await page.goto('/image-style-prompt-gallery', { waitUntil: 'domcontentloaded' });
    await openCuration(page, '收藏图片');
    const dialog = page.getByRole('dialog', { name: '收藏图片', exact: true });
    await dialog.getByLabel('参考图片', { exact: true }).setInputFiles({
      name: 'sample.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=',
        'base64',
      ),
    });
    const tags = dialog.getByRole('combobox', { name: '标签（选填）' });
    await tags.fill('插画');
    await expect(dialog.getByRole('option', { name: '#插画', exact: true })).toBeInViewport();
    const scroll = dialog.locator('[data-curation-scroll]');
    expect(await scroll.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await dialog.getByLabel('管理 token').scrollIntoViewIfNeeded();
    await expect(dialog.getByLabel('管理 token')).toBeInViewport();
    const pageY = await page.evaluate(() => window.scrollY);
    await dialog.getByLabel('模型反推 Prompt').hover();
    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.scrollY)).toBe(pageY);
    await page.screenshot({ path: `/tmp/gallery53-scroll-${mobile ? 'mobile' : 'desktop'}.png` });
  });
}

for (const mobile of [false, true]) {
  test(`local collection stack previews and removes images on ${mobile ? 'mobile' : 'desktop'}`, async ({ page }) => {
    await page.goto('/image-style-prompt-gallery', { waitUntil: 'domcontentloaded' });
    await openCuration(page, '收藏图片');
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const dialog = page.getByRole('dialog', { name: '收藏图片', exact: true });
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=',
      'base64',
    );
    const picker = dialog.getByLabel('参考图片', { exact: true });
    await picker.setInputFiles({ name: 'sample-1.png', mimeType: 'image/png', buffer: png });
    await picker.setInputFiles([2, 3].map((n) => ({ name: `sample-${n}.png`, mimeType: 'image/png', buffer: png })));
    await dialog.evaluate(
      (element, bytes) => {
        const clipboardData = new DataTransfer();
        clipboardData.items.add(new File([new Uint8Array(bytes)], 'pasted.png', { type: 'image/png' }));
        element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
      },
      [...png],
    );
    await expect(dialog.getByRole('list', { name: '已选图片' })).toHaveCount(0);
    const stack = dialog.getByRole('button', { name: '预览 4 张参考图片' });
    await expect(stack.locator('img')).toHaveCount(3);
    expect((await stack.boundingBox())?.width).toBeGreaterThan(mobile ? 250 : 500);
    await dialog.getByLabel('模型反推 Prompt').fill('Keep this draft');
    const pageY = await page.evaluate(() => window.scrollY);
    await stack.click();
    const viewer = page.locator('[data-image-lightbox]');
    await expect(viewer).toBeVisible();
    await expect(viewer.getByText('1 / 4')).toBeVisible();
    await expect(viewer.locator('img')).toHaveAttribute('src', /^blob:/);
    await viewer.getByRole('button', { name: '下一张', exact: true }).click();
    await expect(viewer.getByText('2 / 4')).toBeVisible();
    page.once('dialog', (confirmation) => confirmation.dismiss());
    await viewer.getByRole('button', { name: '移除当前图片', exact: true }).click();
    await expect(viewer.getByText('2 / 4')).toBeVisible();
    page.once('dialog', (confirmation) => confirmation.accept());
    await viewer.getByRole('button', { name: '移除当前图片', exact: true }).click();
    await expect(viewer.getByText('2 / 3')).toBeVisible();
    await expect(viewer.locator('img')).toHaveAttribute('alt', 'sample-3.png');

    await expect(viewer.getByRole('button', { name: /复制|定位|下载/ })).toHaveCount(0);
    await viewer.getByRole('button', { name: '放大', exact: true }).click();
    await expect(viewer.getByRole('button', { name: '重置缩放和旋转' })).toHaveText('150%');
    await viewer.getByRole('button', { name: '缩小', exact: true }).click();
    await viewer.getByRole('button', { name: '旋转 90°', exact: true }).click();
    await viewer.getByRole('button', { name: '缩放灵敏度', exact: true }).click();
    await expect(viewer.getByRole('slider', { name: '缩放灵敏度' })).toBeVisible();
    await viewer.getByRole('button', { name: '重置缩放和旋转' }).click();
    await expect(viewer.getByRole('button', { name: '重置缩放和旋转' })).toHaveText('100%');
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.scrollY)).toBe(pageY);
    await viewer.getByRole('button', { name: /关闭|Close/ }).click();
    await expect(viewer).not.toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('模型反推 Prompt')).toHaveValue('Keep this draft');
    await dialog.getByRole('button', { name: '预览 3 张参考图片' }).click();
    await expect(viewer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(viewer).not.toBeVisible();
    await expect(dialog.getByLabel('模型反推 Prompt')).toHaveValue('Keep this draft');
    await page.screenshot({ path: '/tmp/gallery54-collection.png' });
    await dialog.getByRole('button', { name: '预览 3 张参考图片' }).click();
    await expect(viewer).toBeVisible();
    for (let remaining = 3; remaining > 0; remaining--) {
      page.once('dialog', (confirmation) => confirmation.accept());
      await viewer.getByRole('button', { name: '移除当前图片', exact: true }).click();
      if (remaining > 2) await expect(viewer.getByText(`1 / ${remaining - 1}`)).toBeVisible();
    }
    await expect(viewer).not.toBeVisible();
    await expect(dialog.getByLabel('模型反推 Prompt')).toHaveValue('Keep this draft');
    await picker.setInputFiles({ name: 'sample-1.png', mimeType: 'image/png', buffer: png });
    await expect(dialog.getByRole('button', { name: '预览 1 张参考图片' })).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).toBe('hidden');
    page.once('dialog', (confirmation) => confirmation.accept());
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).not.toBe('hidden');
  });
}
