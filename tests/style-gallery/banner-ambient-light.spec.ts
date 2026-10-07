import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';

const gradient =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="700"><rect width="1800" height="700" fill="#dc5740"/></svg>';
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/*', (route) =>
    route.request().resourceType() === 'image'
      ? route.fulfill({ contentType: 'image/svg+xml', body: gradient })
      : route.continue(),
  );
  await page.route('**/api/live2d**', (route) => route.abort());
  await page.addInitScript(
    () =>
      !localStorage.getItem('appearance-scenery') &&
      localStorage.setItem(
        'appearance-scenery',
        JSON.stringify({
          ambientLight: 'wash',
          lightOpacity: 100,
          lightThemeBlend: 0,
          lightFeather: 0,
          effect: 'none',
        }),
      ),
  );
});

test('full-page light retains source chroma and stays fixed far below the banner', async ({ page }) => {
  await page.goto('/post/markdown-features', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#banner-ambient-light')).toHaveCSS('visibility', 'visible');
  // The outer gutter is deliberately colorful; text contrast is tested on its own reading veil.
  const pixel = async () => {
    const shot = await page.screenshot({ clip: { x: 1, y: 400, width: 1, height: 1 }, scale: 'css', animations: 'disabled' });
    return Array.from(await sharp(shot).removeAlpha().raw().toBuffer());
  };
  await page.evaluate(() => window.scrollTo(0, 800));
  const first = await pixel();
  expect(first[0] - first[1], `source color washed out: ${first}`).toBeGreaterThan(80);
  expect(first[1]).toBeLessThan(150);
  await page.evaluate(() => window.scrollTo(0, 3000));
  const second = await pixel();
  expect(Math.max(...first.map((v, i) => Math.abs(v - second[i])))).toBeLessThan(4);
});

test('projection controls drag, persist and remain independent of banner and theme', async ({ page }) => {
  await page.goto('/about', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '主题与阅读', exact: true }).click();
  const panel = page.locator('.appearance-panel');
  await panel.getByRole('button', { name: '横幅', exact: true }).click();
  await panel.getByRole('button', { name: '沉浸原色', exact: true }).click();
  await panel.locator('summary').filter({ hasText: '投影与边缘' }).click();
  const slider = panel.getByRole('slider', { name: '投影饱和度 slider', exact: true });
  await slider.scrollIntoViewIfNeeded();
  // Wait for smooth scrolling to settle before taking coordinates for a real drag.
  await slider.click({ trial: true });
  const box = await slider.boundingBox();
  if (!box) throw new Error('Missing saturation slider');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.76, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await panel.getByRole('spinbutton', { name: '投影饱和度', exact: true }).inputValue()))
    .toBeGreaterThan(140);
  await panel.getByRole('spinbutton', { name: '扩散范围', exact: true }).fill('150');
  await panel.getByRole('spinbutton', { name: '边缘羽化', exact: true }).fill('60');
  await panel.getByRole('combobox', { name: '投影方向', exact: true }).selectOption('bottom');
  await expect(page.locator('#banner-ambient-light')).toHaveCSS('mask-image', /linear-gradient/);
  await panel.locator('summary').filter({ hasText: '界面融合' }).click();
  await panel.getByRole('spinbutton', { name: '页面底衬', exact: true }).fill('10');
  const values = await page.evaluate(() => window.__sceneryPreferences);
  expect(values).toMatchObject({
    ambientLight: 'wash',
    lightSpread: 150,
    lightDirection: 'bottom',
    lightSurface: 10,
    mask: 30,
    saturation: 100,
    textOpacity: 70,
  });
  await page.reload();
  expect(await page.evaluate(() => window.__sceneryPreferences)).toEqual(values);
  await page.getByRole('button', { name: '主题与阅读', exact: true }).click();
  await panel.getByRole('button', { name: '阅读与界面', exact: true }).click();
  await panel.getByRole('combobox', { name: '控制面板', exact: true }).selectOption('solid');
  const background = await page
    .locator('.page-reading-layout > .grow')
    .evaluate((el) => getComputedStyle(el, '::before').backgroundColor);
  expect(background).not.toMatch(/rgba\(/);
  await panel.getByRole('button', { name: '横幅', exact: true }).click();
  await panel.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.locator('#banner-ambient-light')).toHaveCSS('visibility', 'hidden');
  expect(await page.locator('.page-reading-layout > .grow').evaluate((el) => getComputedStyle(el, '::before').content)).toBe(
    'none',
  );
});

test('ambient materials preserve palette and selected controls on gallery and nested detail pages', async ({ page }) => {
  const art = await readFile('public/img/cover/6.webp');
  await page.route('**/*', (route) =>
    route.request().resourceType() === 'image' ? route.fulfill({ contentType: 'image/webp', body: art }) : route.fallback(),
  );
  const themes = [
    'original',
    'sakura',
    'paper',
    'sage',
    'ocean',
    'lavender',
    'amber',
    'rosewood',
    'graphite',
    'blueprint',
    'mint',
    'lemon',
    'peach',
    'ice',
    'mulberry',
    'sand',
    'pistachio',
    'moonlight',
  ];
  for (const path of [
    '/image-style-prompt-gallery',
    '/image-style-prompt-gallery/2026-09-23-35dc5191ccad',
    '/post/markdown-features',
  ]) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#banner-ambient-light')).toHaveCSS('visibility', 'visible');
    await page.evaluate(() => window.scrollTo(0, 520));
    for (const dark of [false, true]) {
      for (const theme of themes) {
        await page.evaluate(
          ({ theme, dark }) => {
            document.documentElement.dataset.appearance = theme;
            document.documentElement.classList.toggle('dark', dark);
          },
          { theme, dark },
        );
        await expect(page.locator('html')).toHaveAttribute('data-appearance', theme);
        const selected = page.locator('[aria-pressed="true"].gallery-view-toggle').first();
        if (path.includes('image-style-prompt-gallery')) {
          await expect(selected).toHaveCount(1);
          const colors = await selected.evaluate((el) => ({
            color: getComputedStyle(el).color,
            fill: getComputedStyle(el).backgroundColor,
          }));
          expect(colors.color).not.toBe(colors.fill);
          expect(colors.fill).not.toBe('rgba(0, 0, 0, 0)');
        }
        await expect(page.locator('#banner-ambient-light canvas')).toHaveCSS('filter', /saturate\(1\)/);
      }
    }
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
      document.documentElement.dataset.appearance = 'paper';
    });
    await page.screenshot({ path: `/tmp/ambient-${path.split('/').pop()}.png`, scale: 'css', animations: 'disabled' });
  }
});

test('mobile reading veils stay within the viewport and settings remain independently scrollable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/post/markdown-features', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#banner-ambient-light')).toHaveCSS('visibility', 'visible');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: '主题与阅读', exact: true }).click();
  const panel = page.locator('.appearance-panel');
  await panel.getByRole('button', { name: '横幅', exact: true }).click();
  await panel.getByRole('button', { name: '沉浸原色', exact: true }).click();
  await panel.locator('summary').filter({ hasText: '投影与边缘' }).click();
  const control = panel.getByRole('combobox', { name: '投影方向', exact: true });
  await control.scrollIntoViewIfNeeded();
  await control.selectOption('sides');
  await expect(page.locator('html')).toHaveAttribute('data-scene-light-direction', 'sides');
  const mask = await page.locator('#banner-ambient-light').evaluate((el) => getComputedStyle(el).maskImage);
  expect(mask.match(/gradient\(/g)).toHaveLength(3);
  const bounds = await panel.boundingBox();
  if (!bounds) throw new Error('Missing settings');
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '/tmp/ambient-mobile-settings.png', scale: 'css', animations: 'disabled' });
});
