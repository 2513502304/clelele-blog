import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) =>
    route.request().resourceType() === 'image'
      ? route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="700"><defs><linearGradient id="g"><stop stop-color="#a6c9b4"/><stop offset="1" stop-color="#f0bdad"/></linearGradient></defs><rect width="1800" height="700" fill="url(#g)"/><circle cx="1200" cy="300" r="280" fill="#778596"/></svg>',
        })
      : route.continue(),
  );
  await page.route('**/api/live2d**', (route) => route.abort());
});

/** Inspect actual pixels, not the renderer's diagnostic flags. */
async function drawnPixels(page: import('@playwright/test').Page) {
  return page.locator('#ambient-effects').evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext('2d');
    if (!context) throw new Error('Canvas2D unavailable');
    const data = context.getImageData(0, 0, element.width, element.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++;
    return count;
  });
}
const roundedFont = /寒蝉全圆体/;
const serifFont = /Songti SC/;

test('banner controls use actual pointer drags and persist independent layers across navigation', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.site-banner h2')).toHaveCount(0);
  await expect(page.locator('.site-banner h1')).toHaveText('clelele的博客');
  await page.getByRole('button', { name: '主题与阅读', exact: true }).click();
  const panel = page.locator('.appearance-panel');
  await panel.getByRole('button', { name: '横幅', exact: true }).click();
  await expect(panel.locator('.scenery-looks button')).toHaveCount(6);
  await panel.getByRole('button', { name: '暖调胶片', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-scene-tone', 'warm');
  const slider = panel.getByRole('slider', { name: '遮罩强度 slider', exact: true });
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();
  if (!box) throw new Error('Slider not visible');
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await panel.getByRole('spinbutton', { name: '遮罩强度', exact: true }).inputValue()))
    .toBeGreaterThan(55);
  await expect(page.locator('.site-banner .banner-mask')).toHaveCSS('opacity', /0\.[56]/);
  await panel.locator('summary').filter({ hasText: '标题排印' }).click();
  await panel.getByRole('spinbutton', { name: '文字不透明度', exact: true }).fill('70');
  await panel.getByRole('combobox', { name: '字重', exact: true }).selectOption('400');
  await expect(page.locator('.site-banner .banner-copy')).toHaveCSS('opacity', '0.7');
  await expect(page.locator('.site-banner h1')).toHaveCSS('font-weight', '400');
  await page.screenshot({ path: '/tmp/banner-settings.png' });
  await panel.getByRole('button', { name: '关闭主题设置' }).click();
  await page.locator('nav a[href="/weekly"]').first().click();
  await expect(page.locator('.site-banner h1')).not.toHaveText('clelele的博客');
  await expect(page.locator('.site-banner .banner-copy')).toHaveCSS('opacity', '0.7');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-scene-tone', 'warm');
  await expect(page.locator('.site-banner h1')).toHaveCSS('font-weight', '400');
});

test('all effects are bounded and stop for reduced motion, off, and navigation', async ({ page }) => {
  await page.goto('/about', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '主题与阅读', exact: true }).click();
  const panel = page.locator('.appearance-panel');
  await panel.getByRole('button', { name: '氛围', exact: true }).click();
  await expect(panel.locator('.scenery-effects button')).toHaveCount(9);
  const canvas = page.locator('#ambient-effects');
  for (const name of ['樱花', '轻雪', '细雨', '萤火', '星光', '落叶', '光斑', '极光']) {
    await panel.getByRole('button', { name, exact: true }).click();
    await expect(canvas).toHaveAttribute('data-running', 'true');
    await expect(canvas).toHaveCSS('pointer-events', 'none');
    expect(Number(await canvas.getAttribute('data-particles'))).toBeLessThanOrEqual(90);
    await expect.poll(() => drawnPixels(page)).toBeGreaterThan(20);
  }
  await page.screenshot({ path: '/tmp/banner-effects.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(canvas).toHaveAttribute('data-running', 'false');
  await expect.poll(() => drawnPixels(page)).toBe(0);
  for (const wave of await page.locator('.site-banner .parallax > use').all()) {
    await expect(wave).toHaveCSS('animation-name', 'none');
  }
  await expect(panel.locator('output')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(canvas).toHaveAttribute('data-running', 'true');
  await panel.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-running', 'false');
  await panel.getByRole('button', { name: '樱花', exact: true }).click();
  await panel.getByRole('button', { name: '关闭主题设置' }).click();
  await page.locator('nav a[href="/"]').first().click();
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toHaveAttribute('data-running', 'true');
});

test('banner typography overrides reading fonts while local resets preserve other preferences', async ({ page }) => {
  await page.goto('/weekly', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '主题与阅读', exact: true }).click();
  const panel = page.locator('.appearance-panel');
  await panel.getByRole('button', { name: '纸上画廊', exact: true }).click();
  await panel.getByRole('button', { name: '阅读与界面', exact: true }).click();
  await panel.getByRole('combobox', { name: '字体', exact: true }).selectOption('mono');
  await panel.getByRole('button', { name: '横幅', exact: true }).click();
  await panel.locator('summary').filter({ hasText: '标题排印' }).click();
  for (const [option, font] of [
    ['round', roundedFont],
    ['serif', serifFont],
  ] as const) {
    await panel.getByRole('combobox', { name: '标题字体', exact: true }).selectOption(option);
    await expect(page.locator('.site-banner h1')).toHaveCSS('font-family', font);
    await expect(panel.locator('.scenery-preview h1')).toHaveCSS('font-family', font);
  }
  await panel.getByRole('button', { name: '暖调胶片', exact: true }).click();
  await panel.getByRole('button', { name: '氛围', exact: true }).click();
  await panel.getByRole('button', { name: '樱花', exact: true }).click();
  await panel.getByRole('button', { name: '重置氛围', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-scene-tone', 'warm');
  await expect(page.locator('html')).toHaveAttribute('data-scene-effect', 'none');
  await panel.getByRole('button', { name: '樱花', exact: true }).click();
  await panel.getByRole('button', { name: '横幅', exact: true }).click();
  await panel.getByRole('button', { name: '重置横幅', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-scene-effect', 'sakura');
  await expect(page.locator('html')).toHaveAttribute('data-scene-tone', 'neutral');
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'paper');
  await expect(page.locator('html')).toHaveAttribute('data-reading-font', 'mono');
  await panel.getByRole('button', { name: '阅读与界面', exact: true }).click();
  await panel.getByRole('combobox', { name: '主题动效', exact: true }).selectOption('reduced');
  await expect(page.locator('#ambient-effects')).toHaveAttribute('data-running', 'false');
  await expect.poll(() => drawnPixels(page)).toBe(0);
});

test('storage is optional and preferences remain intact through an Astro navigation', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException('Blocked', 'SecurityError');
    };
    Storage.prototype.setItem = () => {
      throw new DOMException('Blocked', 'SecurityError');
    };
  });
  await page.goto('/about', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '主题与阅读', exact: true }).click();
  await page.getByRole('button', { name: '横幅', exact: true }).click();
  await page.getByRole('button', { name: '蓝调时刻', exact: true }).click();
  await page.getByRole('button', { name: '关闭主题设置' }).click();
  await page.locator('nav a[href="/weekly"]').first().click();
  await expect(page).toHaveURL(/\/weekly$/);
  await expect(page.locator('html')).toHaveAttribute('data-scene-tone', 'cool');
  await expect(page.locator('.site-banner .banner-image')).toHaveCSS('filter', /brightness\(0.95\)/);
});

test('other-tab updates synchronize controls and failed renderer chunks fail gracefully', async ({ page, context }) => {
  await page.route('**/ambient-renderer*', (route) => route.abort());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/about', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '主题与阅读', exact: true }).click();
  await page.getByRole('button', { name: '氛围', exact: true }).click();
  await page.getByRole('button', { name: '樱花', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '特效暂时未能加载' })).toBeVisible();
  expect(errors.filter((text) => /import|module|fetch/i.test(text))).toEqual([]);
  const other = await context.newPage();
  await other.goto('/about', { waitUntil: 'domcontentloaded' });
  await other.evaluate(() => localStorage.setItem('appearance-scenery', JSON.stringify({ mask: 22, effect: 'none' })));
  await expect(page.locator('html')).toHaveAttribute('data-scene-effect', 'none');
  await expect(page.locator('.site-banner .banner-mask')).toHaveCSS('opacity', '0.22');
  await expect(page.getByRole('button', { name: '关闭', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await other.close();
});

test('small screens keep controls in reach and the canvas resolution bounded', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/about', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '主题与阅读', exact: true }).click();
  const panel = page.locator('.appearance-panel');
  for (const tab of ['横幅', '氛围']) {
    await panel.getByRole('button', { name: tab, exact: true }).click();
    const box = await panel.boundingBox();
    if (!box) throw new Error('Panel not visible');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
  }
  await panel.getByRole('button', { name: '星光', exact: true }).click();
  await panel.getByRole('spinbutton', { name: '数量', exact: true }).fill('100');
  await expect(page.locator('#ambient-effects')).toHaveAttribute('data-particles', '40');
  await expect(page.locator('#ambient-effects')).toHaveAttribute('width', '390');
  await expect.poll(() => drawnPixels(page)).toBeGreaterThan(20);
  await page.screenshot({ path: '/tmp/banner-mobile.png' });
});

test('storage normalization and localized nested-page banners survive page reloads', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'appearance-scenery',
      JSON.stringify({ mask: 999, textOpacity: 0, blur: -10, effect: 'not-an-effect', textColor: 'red; color: red' }),
    ),
  );
  await page.goto('/image-style-prompt-gallery', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.site-banner h1')).toContainText('图像风格提示词画廊');
  await expect(page.locator('.site-banner .banner-copy')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('.site-banner .banner-mask')).toHaveCSS('opacity', '0.85');
  await expect(page.locator('html')).toHaveAttribute('data-scene-effect', 'none');
  await expect(page.locator('html')).toHaveAttribute('data-scene-text-color', 'white');
  await page.getByRole('button', { name: '主题与阅读', exact: true }).click();
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  await expect(page.locator('.site-banner .banner-copy')).toHaveCSS('visibility', 'visible');
  await expect(page.locator('.site-banner .banner-mask')).toHaveCSS('opacity', '0.4');
});
