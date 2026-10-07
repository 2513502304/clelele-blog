import { expect, test } from '@playwright/test';
import sharp from 'sharp';

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
  await expect(page.locator('html')).toHaveAttribute('data-scene-effect', 'sakura');
  await panel.getByRole('button', { name: '樱花', exact: true }).click();
  await panel.getByRole('button', { name: '横幅', exact: true }).click();
  await panel.getByRole('button', { name: '重置横幅', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-scene-effect', 'sakura');
  await expect(page.locator('html')).toHaveAttribute('data-scene-tone', 'warm');
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
  await expect(page.locator('html')).toHaveAttribute('data-scene-effect', 'sakura');
  await expect(page.locator('html')).toHaveAttribute('data-scene-text-color', 'theme');
  await page.getByRole('button', { name: '主题与阅读', exact: true }).click();
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  await expect(page.locator('.site-banner .banner-copy')).toHaveCSS('visibility', 'visible');
  await expect(page.locator('.site-banner .banner-mask')).toHaveCSS('opacity', '0.3');
});

test('fresh defaults match the requested screenshots without overriding saved choices', async ({ page }) => {
  await page.goto('/about', { waitUntil: 'domcontentloaded' });
  const expected = {
    imageOpacity: 100,
    mask: 30,
    maskStyle: 'mist',
    edge: 'mist',
    ambientLight: 'wash',
    lightOpacity: 100,
    lightBlur: 30,
    lightSpread: 0,
    lightThemeBlend: 0,
    tone: 'warm',
    brightness: 100,
    contrast: 100,
    saturation: 100,
    blur: 0,
    focusX: 50,
    focusY: 50,
    textOpacity: 70,
    textSize: 100,
    textFont: 'theme',
    textWeight: '700',
    textColor: 'theme',
    textSpacing: 5,
    textShadow: 30,
    effect: 'sakura',
    density: 100,
    speed: 60,
    effectOpacity: 60,
  };
  expect(await page.evaluate(() => window.__sceneryPreferences)).toMatchObject(expected);
  await expect(page.locator('.site-banner .banner-copy')).toHaveCSS('opacity', '0.7');
  await expect(page.locator('.site-banner .banner-mask')).toHaveCSS('opacity', '0.3');
  await page.evaluate(() =>
    localStorage.setItem('appearance-scenery', JSON.stringify({ mask: 19, effect: 'none', tone: 'cool' })),
  );
  await page.reload();
  expect(await page.evaluate(() => window.__sceneryPreferences)).toMatchObject({
    mask: 19,
    effect: 'none',
    tone: 'cool',
    textOpacity: 70,
  });
});

test('static image light paints once, follows source changes and survives navigation', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('appearance-scenery', JSON.stringify({ ambientLight: 'off' })));
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args: [CanvasImageSource, ...number[]]) {
      if (this.canvas.parentElement?.id === 'banner-ambient-light') {
        this.canvas.dataset.paints = String(Number(this.canvas.dataset.paints || 0) + 1);
      }
      return Reflect.apply(original, this, args);
    };
  });
  await page.goto('/about', { waitUntil: 'domcontentloaded' });
  // Same-origin sources allow test-only pixel readback; production never reads source pixels.
  await page.locator('.site-banner .banner-image').evaluate((img: HTMLImageElement) => {
    img.src = '/test-ambient.svg';
  });
  await page.getByRole('button', { name: '主题与阅读', exact: true }).click();
  const panel = page.locator('.appearance-panel');
  await panel.getByRole('button', { name: '横幅', exact: true }).click();
  const light = page.locator('#banner-ambient-light');
  await expect(light).toHaveCSS('visibility', 'hidden');
  await panel.getByRole('button', { name: '全页漫射', exact: true }).click();
  await expect(light).toHaveCSS('visibility', 'visible');
  await expect(light).toHaveCSS('pointer-events', 'none');
  await expect(page.locator('main .shadow-box.bg-gradient-start').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('.site-banner')).toHaveCSS('mask-image', /linear-gradient/);
  const pixel = () =>
    light
      .locator('canvas')
      .evaluate((canvas: HTMLCanvasElement) => Array.from(canvas.getContext('2d')?.getImageData(48, 32, 1, 1).data ?? []));
  await expect.poll(async () => (await pixel())[3]).toBe(255);
  await expect(light.locator('canvas')).toHaveAttribute('data-paints', '1');
  await panel.getByRole('spinbutton', { name: '光晕强度', exact: true }).fill('40');
  await panel.getByRole('spinbutton', { name: '柔化程度', exact: true }).fill('70');
  await expect(light).toHaveCSS('opacity', '0.4');
  await expect(light.locator('canvas')).toHaveAttribute('data-paints', '1');
  await page.route('**/test-new-cover.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="400"><rect width="900" height="400" fill="#de1234"/></svg>',
    }),
  );
  await page.locator('.site-banner .banner-image').evaluate((img: HTMLImageElement) => {
    img.src = '/test-new-cover.svg';
  });
  await expect.poll(pixel).toEqual([222, 18, 52, 255]);
  await panel.getByRole('button', { name: '四周光晕', exact: true }).click();
  await expect(light).toHaveCSS('mask-image', /radial-gradient/);
  await panel.getByRole('button', { name: '关闭主题设置' }).click();
  await page.locator('#site-header a[href="/weekly"]').first().click();
  await expect(light).toHaveCount(1);
  await expect(light).toHaveCSS('visibility', 'visible');
  await page.getByRole('button', { name: '主题与阅读', exact: true }).click();
  await panel.getByRole('button', { name: '横幅', exact: true }).click();
  await panel.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(light).toHaveCSS('visibility', 'hidden');
  await panel.getByRole('button', { name: '全页漫射', exact: true }).click();
  await page.route('**/test-broken.svg', (route) => route.abort());
  await page.locator('.site-banner .banner-image').evaluate((img: HTMLImageElement) => {
    img.src = '/test-broken.svg';
  });
  await expect(light).toHaveCSS('visibility', 'hidden');
});

test('expanded mask and edge choices render distinct layers and accurate framing hints', async ({ page }) => {
  await page.goto('/about', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '主题与阅读', exact: true }).click();
  const panel = page.locator('.appearance-panel');
  await panel.getByRole('button', { name: '横幅', exact: true }).click();
  const mask = panel.getByRole('combobox', { name: '遮罩方式', exact: true });
  const edge = panel.getByRole('combobox', { name: '底部衔接', exact: true });
  await expect(mask.locator('option')).toHaveCount(7);
  await expect(edge.locator('option')).toHaveCount(7);
  const maskPaints: string[] = [];
  for (const choice of ['uniform', 'gradient', 'vignette', 'top', 'bottom', 'spotlight', 'mist']) {
    await mask.selectOption(choice);
    const paint = await page.locator('.site-banner .banner-mask').evaluate((el) => getComputedStyle(el).backgroundImage);
    maskPaints.push(paint);
    await expect(panel.locator('.scenery-preview .banner-mask')).toHaveCSS('background-image', paint);
  }
  expect(new Set(maskPaints).size).toBe(7);
  const edgeShapes: string[] = [];
  for (const choice of ['arc', 'diagonal', 'layered']) {
    await edge.selectOption(choice);
    const shape = await page.locator('.site-banner .wave-wrap').evaluate((el) => getComputedStyle(el).clipPath);
    edgeShapes.push(shape);
    await expect(panel.locator('.banner-edge-preview')).toHaveCSS('clip-path', shape);
    await expect(page.locator('.site-banner .wave')).toHaveCSS('visibility', 'hidden');
  }
  expect(new Set(edgeShapes).size).toBe(3);
  await edge.selectOption('mist');
  await expect(page.locator('.site-banner .wave-wrap')).toHaveCSS('backdrop-filter', 'blur(10px)');
  await edge.selectOption('straight');
  await expect(page.locator('.site-banner .wave-wrap')).toHaveCSS('display', 'none');
  await panel.locator('summary').filter({ hasText: '色彩与取景' }).click();
  const ratio = await page
    .locator('.site-banner .banner-image')
    .evaluate((img: HTMLImageElement) => img.clientWidth / img.clientHeight);
  const previewRatio = await panel.locator('.scenery-preview').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.width / r.height;
  });
  expect(previewRatio).toBeCloseTo(ratio, 1);
  await panel.getByRole('spinbutton', { name: '图片上下位置', exact: true }).fill('80');
  await expect(page.locator('.site-banner .banner-image')).toHaveCSS('object-position', '50% 80%');
  await expect(panel.locator('.scenery-preview .banner-image')).toHaveCSS('object-position', '50% 80%');
});

test('ambient light blends cover edges and preserves palette selection in light and dark themes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/image-style-prompt-gallery/2026-09-23-35dc5191ccad', { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important}' });
  await page.getByRole('button', { name: '主题与阅读', exact: true }).click();
  const panel = page.locator('.appearance-panel');
  await panel.getByRole('button', { name: '横幅', exact: true }).click();
  await panel.getByRole('button', { name: '全页漫射', exact: true }).click();
  await panel.getByRole('combobox', { name: '底部衔接', exact: true }).selectOption('mist');
  await panel.getByRole('button', { name: '外观预设', exact: true }).click();
  for (const dark of [false, true]) {
    await page.evaluate((value) => document.documentElement.classList.toggle('dark', value), dark);
    for (const [name, id] of [
      ['原色日常', 'original'],
      ['花间手记', 'sakura'],
      ['纸上画廊', 'paper'],
      ['蓝调印刷', 'blueprint'],
    ]) {
      const choice = panel.getByRole('button', { name, exact: true });
      await choice.click();
      await expect(choice).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('html')).toHaveAttribute('data-appearance', id);
      await expect(page.locator('html')).toHaveAttribute('data-scene-ambient-light', 'wash');
      await expect(page.locator('#banner-ambient-light')).toHaveCSS('visibility', 'visible');
      await expect(page.locator('main .shadow-box.bg-gradient-start').first()).toHaveCSS(
        'background-color',
        'rgba(0, 0, 0, 0)',
      );
      const cover = await page.locator('.site-banner').boundingBox();
      if (!cover) throw new Error('No banner');
      // Check both sides of the actual cover/content seam, away from cards and the settings portal.
      const pixels = await page.screenshot({
        clip: { x: 20, y: Math.round(cover.y + cover.height) - 3, width: 1, height: 10 },
        scale: 'css',
        animations: 'disabled',
      });
      const { data, info } = await sharp(pixels).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let y = 1; y < 10; y++) {
        const deltas = [0, 1, 2].map((c) => Math.abs(data[y * info.channels + c] - data[(y - 1) * info.channels + c]));
        expect(Math.max(...deltas), `${id} ${dark} seam`).toBeLessThanOrEqual(5);
      }
    }
  }
});

test('landscape framing matches the visible cover instead of an overflowing image box', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 320 });
  await page.goto('/about', { waitUntil: 'domcontentloaded' });
  const cover = await page.locator('.site-banner').boundingBox();
  const image = await page.locator('.site-banner .banner-image').boundingBox();
  if (!cover || !image) throw new Error('Missing cover');
  expect(image.height).toBeCloseTo(cover.height, 0);
  await page.getByRole('button', { name: '主题与阅读', exact: true }).click();
  const panel = page.locator('.appearance-panel');
  await panel.getByRole('button', { name: '横幅', exact: true }).click();
  const preview = await panel.locator('.scenery-preview').boundingBox();
  if (!preview) throw new Error('Missing preview');
  expect(preview.width / preview.height).toBeCloseTo(cover.width / cover.height, 1);
});

test('maximum ambient strength keeps long-page text readable with black and white source images', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() =>
    localStorage.setItem('appearance-scenery', JSON.stringify({ ambientLight: 'wash', lightOpacity: 100, effect: 'none' })),
  );
  let fill = '#000';
  await page.route('**/*', (r) =>
    r.request().resourceType() === 'image'
      ? r.fulfill({
          contentType: 'image/svg+xml',
          body: `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="700"><rect width="1800" height="700" fill="${fill}"/></svg>`,
        })
      : r.fallback(),
  );
  const luminance = (rgb: number[]) =>
    rgb
      .map((v) => {
        const n = v / 255;
        return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
  for (const dark of [false, true]) {
    fill = dark ? '#fff' : '#000';
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: dark ? 'dark' : 'light' });
    await page.goto('/post/markdown-features', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#banner-ambient-light')).toHaveCSS('visibility', 'visible');
    await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important}' });
    for (const appearance of ['original', 'blueprint', 'paper']) {
      await page.evaluate((appearance) => {
        document.documentElement.dataset.appearance = appearance;
        window.scrollTo(0, 2400);
      }, appearance);
      const foreground = await page.locator('main .prose').evaluate((el) => {
        // Computed theme colors may be OKLCH; normalize to sRGB before WCAG luminance math.
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Color conversion canvas unavailable');
        context.fillStyle = getComputedStyle(el).color;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
      });
      expect(foreground).toHaveLength(3);
      // Contrast belongs to the reading surface, not the deliberately colorful outer gutter.
      const prose = await page.locator('main .prose').boundingBox();
      if (!prose) throw new Error('Missing reading surface');
      const screenshot = await page.screenshot({
        clip: { x: Math.round(prose.x) - 4, y: 300, width: 1, height: 1 },
        scale: 'css',
        animations: 'disabled',
      });
      const { data } = await sharp(screenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const a = luminance(foreground),
        b = luminance(Array.from(data));
      expect(
        (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        `${appearance} dark=${dark} fg=${foreground} bg=${data}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});
