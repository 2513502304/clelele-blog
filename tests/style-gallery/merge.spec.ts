import { expect, test } from '@playwright/test';
import type { GalleryMergeSelection } from '../../src/lib/style-gallery-merge-types';

const cards = ['a', 'b'].map((letter, side) => ({
  revision: letter.repeat(64),
  tags: side === 0 ? ['插画'] : ['现实'],
  likeCounts: { [`example-${side}`]: side + 1 },
  item: {
    version: 4,
    slug: `2026-09-0${side + 1}-${letter.repeat(12)}`,
    imageHash: letter.repeat(64),
    title: `Card ${side + 1}`,
    date: `2026-09-0${side + 1}T08:00:00Z`,
    sourceImage: `/api/style-gallery/image/source/${letter.repeat(12)}.png`,
    images: [{ imageHash: letter.repeat(64), sourceImage: `/api/style-gallery/image/source/${letter.repeat(12)}.png` }],
    prompts: [
      {
        id: letter.repeat(64),
        prompt: `模型 ${side + 1} 的完整提示词\n${'保留换行与主体风格。'.repeat(45)}`,
        originalPrompt: side === 0 ? `原始请求 1\n${'较长的原始请求，保留换行。\n'.repeat(100)}` : '原始请求 2',
        model: `Model ${side + 1}`,
        importedAt: `2026-09-0${side + 1}T08:00:00Z`,
      },
    ],
    examples: [
      {
        id: `example-${side}`,
        src: `/api/style-gallery/image/examples/images/${letter.repeat(64)}.png`,
        imageHash: letter.repeat(64),
        alt: `Example ${side}`,
        model: 'GPT-Image',
        uploadedAt: '2026-09-10T00:00:00Z',
      },
    ],
  },
}));
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640"><defs><linearGradient id="a" x2="1" y2="1"><stop stop-color="#8ccdcc"/><stop offset="1" stop-color="#b8b8d9"/></linearGradient></defs><rect width="480" height="640" fill="url(#a)"/><circle cx="240" cy="280" r="140" fill="#eee" opacity=".6"/></svg>';

for (const path of ['', '/index']) {
  test(`merge comparison protects selections, previews groups and confirms the final write on ${path || 'preview'}`, async ({
    page,
  }) => {
    if (path) await page.setViewportSize({ width: 390, height: 844 });
    let saves = 0;
    let posted: { selection: GalleryMergeSelection } | undefined;
    let fail = true;
    await page.route('**/*', async (route) => {
      if (route.request().url().includes('/api/live2d')) return route.abort();
      if (route.request().resourceType() === 'image') return route.fulfill({ contentType: 'image/svg+xml', body: svg });
      if (route.request().url().endsWith('/api/style-gallery/merge')) {
        const body = route.request().postDataJSON();
        if (body.action === 'preview')
          return route.fulfill({
            json: { cards: cards.map((card, side) => ({ ...card, item: { ...card.item, imageHash: body.hashes[side] } })) },
          });
        saves++;
        posted = body;
        return fail ? route.fulfill({ status: 409 }) : route.fulfill({ json: { slug: cards[0].item.slug } });
      }
      if (route.request().isNavigationRequest() && route.request().url().endsWith(cards[0].item.slug))
        return route.fulfill({ contentType: 'text/html', body: '<h1>Merged card</h1>' });
      return route.continue();
    });
    await page.goto(`/image-style-prompt-gallery${path}`, { waitUntil: 'domcontentloaded' });
    const trigger = page.getByRole('button', { name: '合并卡片', exact: true });
    await expect
      .poll(() => trigger.evaluate((el) => !el.closest('astro-island')?.hasAttribute('ssr')), { timeout: 30000 })
      .toBe(true);
    const collectBox = await page.getByRole('button', { name: '收藏图片', exact: true }).boundingBox();
    const mergeBox = await trigger.boundingBox();
    expect(collectBox && mergeBox && mergeBox.x >= collectBox.x + collectBox.width).toBeTruthy();
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: '合并两张卡片', exact: true });
    await expect(dialog).not.toBeVisible();
    const choices = page.getByRole('checkbox', { name: /^选择来源 / });
    await choices.nth(0).check();
    await choices.nth(1).check();
    await expect(choices.nth(2)).toBeDisabled();
    const dock = page.locator('[data-gallery-selection-dock]');
    if (path) await dock.getByRole('button', { name: /^已选择/ }).click();
    await dock.getByRole('button', { name: '确认两张并比较' }).click();
    await dialog.getByLabel('管理 token').fill('test-token');
    await dialog.getByRole('button', { name: '加载对比', exact: true }).click();
    const right = dialog.getByRole('region', { name: '卡片 2', exact: true });
    await expect(right).toBeVisible();
    const scrolling = await dialog
      .locator('[data-merge-scroll], [data-merge-prompt], [data-merge-original]')
      .evaluateAll((elements) =>
        elements.map((element) => ({
          height: element.clientHeight,
          total: element.scrollHeight,
          overflow: getComputedStyle(element).overflowY,
        })),
      );
    expect(scrolling[0].total).toBeGreaterThan(scrolling[0].height);
    expect(scrolling.filter((area) => area.total > area.height).length).toBeGreaterThanOrEqual(4);
    expect(scrolling.every((area) => area.overflow === 'scroll')).toBe(true);
    await expect(dialog.getByRole('button', { name: '确认合并…', exact: true })).toBeInViewport();
    await right.getByRole('radio', { name: '原始请求 2', exact: true }).check();
    await right.getByRole('radio', { name: /导入日期/ }).check();
    await right.getByRole('checkbox', { name: /Sub-images/ }).uncheck();
    await right.getByRole('button', { name: '预览 1 张子图', exact: true }).last().click();
    const viewer = page.getByRole('dialog', { name: '子图预览', exact: true });
    await expect(viewer).toBeVisible();
    await expect(viewer).toHaveCSS('opacity', '1');
    await expect(viewer.getByRole('button', { name: '旋转 90°', exact: true })).toBeVisible();
    await expect(viewer.getByRole('button', { name: /复制|定位|下载/ })).toHaveCount(0);
    await viewer.getByRole('button', { name: /关闭|Close/ }).click();
    await expect(right.getByRole('checkbox', { name: /Sub-images/ })).not.toBeChecked();
    const pageY = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.scrollY)).toBe(pageY);
    page.once('dialog', async (confirmation) => {
      expect(confirmation.message()).toContain('放弃');
      await confirmation.dismiss();
    });
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dialog).toBeVisible();
    // Full-page navigation must preserve the draft when its native unload confirmation is rejected.
    page.once('dialog', async (confirmation) => {
      expect(confirmation.type()).toBe('beforeunload');
      await confirmation.dismiss();
    });
    await page.evaluate(() => {
      window.location.assign('/about');
    });
    await expect(dialog).toBeVisible();
    await expect(right.getByRole('checkbox', { name: /Sub-images/ })).not.toBeChecked();
    page.once('dialog', async (confirmation) => {
      expect(confirmation.message()).toContain('确认合并');
      await confirmation.dismiss();
    });
    await dialog.getByRole('button', { name: '确认合并…', exact: true }).click();
    expect(saves).toBe(0);
    page.once('dialog', (confirmation) => confirmation.accept());
    await dialog.getByRole('button', { name: '确认合并…', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('数据已发生变化');
    expect(posted?.selection.prompts).toHaveLength(2);
    expect(posted?.selection.examples).toEqual([0]);
    expect(posted?.selection.original?.side).toBe(1);
    expect(posted?.selection.date).toBe(1);
    await page.screenshot({ path: `/tmp/gallery53-merge-${path ? 'mobile' : 'desktop'}.png` });
    fail = false;
    page.once('dialog', (confirmation) => confirmation.accept());
    await dialog.getByRole('button', { name: '确认合并…', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(cards[0].item.slug));
    expect(saves).toBe(2);
  });
}
