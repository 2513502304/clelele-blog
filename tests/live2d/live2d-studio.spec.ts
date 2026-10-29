import { expect, type Page, test } from '@playwright/test';
import catalogData from '../../src/data/live2d/catalog.json' with { type: 'json' };
import { waitForLive2DReady } from './helpers';

const release = 'd5eadf497778106f46fa76ba5e4685f3d0a3fa7eeae0b2d20a22d18ec13c81e4';
const costumeId = 'our-notes-adv-live2d-anon-002-casual-spring-01-glasses';

test('native studio reuses one canvas and model, pauses GPU draws, and exports a local PNG', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const catalog = structuredClone(catalogData);
  catalog.characters[0].costumes = catalog.characters[0].costumes.filter((costume) => costume.id !== costumeId);
  catalog.characters[0].costumes.push({
    ...catalog.characters[0].costumes[0],
    id: costumeId,
    label: { zh: 'Our Notes 测试服装', en: 'Our Notes fixture', ja: 'Our Notes fixture' },
    releaseId: release,
    entryPath: `releases/${release}/model.native.json`,
    packageBytes: 5634079,
    scale: 1,
    position: [0, 0],
    interactions: [],
  });
  await page.route('**/api/live2d/catalog*', (route) => route.fulfill({ json: catalog }));
  // Unrelated navigation prefetch must not turn a gallery origin outage into a Vite error overlay.
  await page.route('**/image-style-prompt-gallery', (route) => route.fulfill({ status: 200, body: '' }));
  // Measure native WebGL draws without depending on private renderer state or a second animation loop.
  await page.addInitScript(() => {
    let draws = 0;
    let frames = 0;
    let lastDraw = -Infinity;
    Object.defineProperty(window, '__nativeDraws', { get: () => draws });
    Object.defineProperty(window, '__live2dFrames', { get: () => frames });
    for (const context of [WebGLRenderingContext, WebGL2RenderingContext]) {
      const original = context.prototype.drawElements;
      context.prototype.drawElements = function (...args) {
        if (this.canvas instanceof HTMLCanvasElement && this.canvas.classList.contains('live2d-canvas')) {
          draws++;
          const now = performance.now();
          if (now - lastDraw > 8) frames++;
          lastDraw = now;
        }
        return original.apply(this, args);
      };
    }
  });
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes(release)) requests.push(request.url());
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await waitForLive2DReady(page);
  expect(requests).toHaveLength(0);
  await verifyBackgroundDialogs(page, false);
  await page.getByRole('button', { name: 'Live2D 工作室', exact: true }).click();
  await expect(page.locator('.live2d-studio-fields select').first()).toHaveValue('bestdori');
  await expect(page.locator('.live2d-studio-costumes button[aria-pressed=true]')).toHaveCount(1);
  await page.locator('.live2d-studio-fields select').first().selectOption('our-notes');
  await page.getByRole('button', { name: 'Our Notes 测试服装', exact: false }).click();
  await waitForLive2DReady(page);
  await expect(page.locator('canvas.live2d-canvas')).toHaveCount(1);
  await measureFrameBudget(page, 'Our Notes');
  const canvas = await page.locator('canvas.live2d-canvas').elementHandle();
  await page.getByRole('button', { name: '表情与姿态', exact: true }).click();
  await expect(page.locator('.live2d-studio-parameter').first()).toBeVisible();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.waitForTimeout(250);
  const draws = () => page.evaluate(() => Reflect.get(window, '__nativeDraws') as number);
  const paused = await draws();
  await page.waitForTimeout(500);
  expect(await draws()).toBe(paused);
  await dragRange(page, 'ParamAngleX');
  await expect.poll(draws).toBeGreaterThan(paused);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PNG', exact: true }).click();
  expect((await download).suggestedFilename()).toBe(`${costumeId}.png`);
  const before = requests.length;
  await page.locator('.live2d-studio-close').click();
  expect(await canvas?.evaluate((element) => element.isConnected)).toBe(true);
  await page.getByRole('button', { name: 'Live2D 工作室', exact: true }).click();
  expect(await canvas?.evaluate((element) => element.isConnected)).toBe(true);
  await page.waitForTimeout(250);
  expect(requests).toHaveLength(before);
  await expect(page.locator('.live2d-studio-fields select').first()).toHaveValue('our-notes');
  await expect(page.locator('.live2d-studio-costumes button[aria-pressed=true]')).toHaveCount(1);
  await page.getByRole('button', { name: '继续', exact: true }).click();
  const resumed = await draws();
  await expect.poll(draws).toBeGreaterThan(resumed);
  await page.getByRole('button', { name: '画面', exact: true }).click();
  for (const name of ['人物缩放', '左右位置', '上下位置']) await dragRange(page, name);
  await expect(page.locator('.live2d-studio')).toHaveCSS('backdrop-filter', 'none');
  await expect(page.locator('canvas[data-running]')).toHaveAttribute('data-running', 'false');
  const backing = await page
    .locator('canvas.live2d-canvas')
    .evaluate((c: HTMLCanvasElement) => ({ w: c.width, h: c.height, css: c.clientWidth }));
  expect(backing.w * backing.h).toBeLessThanOrEqual(1_500_000);
  expect(backing.w / backing.css).toBeLessThanOrEqual(1.5);
  await page.getByRole('button', { name: '重置画面', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('studio-desktop.png') });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await page.locator('.live2d-studio').boundingBox())?.width).toBeLessThanOrEqual(390);
  const box = await page.locator('.live2d-studio').boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('Studio has no visible bounds');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(391);
  await expect(page.getByRole('button', { name: '导出 PNG', exact: true })).toBeVisible();
  await expect(page.locator('.live2d-studio')).toHaveCSS('color', 'rgb(242, 242, 242)');
  await page.screenshot({ path: testInfo.outputPath('studio-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '角色', exact: true }).click();
  await page.locator('.live2d-studio-fields select').first().selectOption('bestdori');
  await page.locator('.live2d-studio-costumes button').first().click();
  await waitForLive2DReady(page);
  expect(await canvas?.evaluate((element) => element.isConnected)).toBe(false);
  await expect(page.locator('canvas.live2d-canvas')).toHaveCount(1);
  await measureFrameBudget(page, 'Cubism 2');
  // Legacy paused edits must redraw once too; they used to remain visually frozen until Resume.
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '表情与姿态', exact: true }).click();
  await page.waitForTimeout(250);
  const legacyCanvas = page.locator('canvas.live2d-canvas');
  const beforePose = await legacyCanvas.screenshot();
  await dragRange(page, 'PARAM_ANGLE_X');
  const afterPose = await legacyCanvas.screenshot();
  expect(beforePose.equals(afterPose)).toBe(false);
  // Resizing a paused canvas clears its backing store; it must receive one replacement frame.
  const beforeResize = await draws();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(draws).toBeGreaterThan(beforeResize);
  await page.waitForTimeout(250);
  const still = await draws();
  const poseData = () => legacyCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  const stablePose = await poseData();
  const legacyDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PNG', exact: true }).click();
  await legacyDownload;
  expect(await draws()).toBe(still);
  expect(await poseData()).toBe(stablePose);

  await page.locator('.live2d-studio-close').click();
  await expect(page.locator('canvas[data-running]')).toHaveAttribute('data-running', 'true');
  await verifyBackgroundDialogs(page, true);
  expect(errors).toEqual([]);
});

/** Exercise both Radix search and the independent Floating UI lightbox, preserving the user's pause. */
async function verifyBackgroundDialogs(page: Page, userPaused: boolean) {
  const canvas = await page.locator('canvas.live2d-canvas').elementHandle();
  const draws = () => page.evaluate(() => Reflect.get(window, '__nativeDraws') as number);
  for (const type of ['search', 'image'] as const) {
    if (type === 'search') {
      const modifier = await page.evaluate(() => (/Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? 'Meta' : 'Control'));
      await page.keyboard.press(`${modifier}+k`);
    } else {
      await page.evaluate(() => {
        const src = document.querySelector<HTMLImageElement>('main img')?.src;
        if (!src) throw new Error('Missing article thumbnail');
        window.dispatchEvent(
          new CustomEvent('open-image-lightbox', {
            detail: { images: [{ src, alt: 'Background pause test' }], currentIndex: 0 },
          }),
        );
      });
    }
    await expect(page.locator('html')).toHaveAttribute('data-background-paused', 'true');
    await expect(page.locator('canvas[data-running]')).toHaveAttribute('data-running', 'false');
    await page.waitForTimeout(300);
    const frozen = await draws();
    await page.waitForTimeout(350);
    expect(await draws()).toBe(frozen);
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-background-paused', 'false');
    await expect(page.locator('canvas[data-running]')).toHaveAttribute('data-running', 'true');
    expect(await canvas?.evaluate((element) => element.isConnected)).toBe(true);
    if (userPaused) {
      await page.waitForTimeout(350);
      expect(await draws()).toBe(frozen);
    } else await expect.poll(draws).toBeGreaterThan(frozen);
  }
}

/** A held gesture must update repeatedly, survive reversal/outside release, then leave keyboard input usable. */
async function dragRange(page: Page, name: string) {
  const rail = page.getByRole('slider', { name, exact: true });
  await rail.scrollIntoViewIfNeeded();
  const box = await rail.boundingBox();
  if (!box) throw new Error(`Missing slider ${name}`);
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.25, y);
  await page.mouse.down();
  const first = Number(await rail.inputValue());
  await page.mouse.move(box.x + box.width * 0.75, y, { steps: 6 });
  const second = Number(await rail.inputValue());
  expect(second).toBeGreaterThan(first);
  await page.mouse.move(box.x + box.width * 0.4, y, { steps: 6 });
  expect(Number(await rail.inputValue())).toBeLessThan(second);
  await page.mouse.move(box.x + box.width + 20, y);
  await page.mouse.up();
  expect(Number(await rail.inputValue())).toBe(Number(await rail.getAttribute('max')));
  await rail.press('Home');
  expect(Number(await rail.inputValue())).toBe(Number(await rail.getAttribute('min')));
  await rail.press('ArrowRight');
  expect(Number(await rail.inputValue())).toBeGreaterThan(Number(await rail.getAttribute('min')));
}

/** Count actual WebGL frames, not RAF callbacks, which still run at the display refresh rate. */
async function measureFrameBudget(page: Page, engine: string) {
  const sample = () =>
    page.evaluate(() => ({ frames: Reflect.get(window, '__live2dFrames') as number, time: performance.now() }));
  const before = await sample();
  await page.waitForTimeout(2000);
  const after = await sample();
  const fps = ((after.frames - before.frames) * 1000) / (after.time - before.time);
  console.log(`${engine} measured ${fps.toFixed(1)} rendered frames/second`);
  expect(fps).toBeGreaterThan(5);
  expect(fps).toBeLessThanOrEqual(33);
}
