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
  const secondRelease = '57c68c1f193973ae296e989493384291b7d3a35df8aec66718465382b9934a2f';
  catalog.characters[0].costumes.push({
    ...catalog.characters[0].costumes[catalog.characters[0].costumes.length - 1],
    id: 'our-notes-cache-fixture',
    label: { zh: 'Our Notes 缓存测试', en: 'Cache fixture', ja: 'Cache fixture' },
    releaseId: secondRelease,
    entryPath: `releases/${secondRelease}/model.native.json`,
  });
  let shaderAttempts = 0;
  let failedShader = '';
  await page.route('**/api/live2d-assets/**/assets/*.glsl*', (route) => {
    failedShader ||= route.request().url();
    if (route.request().url() === failedShader && ++shaderAttempts <= 2)
      return route.fulfill({ status: 502, body: 'Transient upstream failure' });
    return route.continue();
  });
  let catalogRequests = 0;
  await page.route('**/api/live2d/catalog*', (route) => {
    catalogRequests++;
    // A transient catalog failure must stay distinct from "no matching models" and allow recovery.
    return catalogRequests <= 2
      ? route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } })
      : route.fulfill({ json: catalog });
  });
  // Unrelated navigation prefetch must not turn a gallery origin outage into a Vite error overlay.
  await page.route('**/image-style-prompt-gallery', (route) => route.fulfill({ status: 200, body: '' }));
  // Measure native WebGL draws without depending on private renderer state or a second animation loop.
  await page.addInitScript(() => {
    const textures = new Set<WebGLTexture>();
    let mipmaps = 0;
    Object.defineProperty(window, '__nativeTextures', { get: () => textures.size });
    Object.defineProperty(window, '__nativeMipmaps', { get: () => mipmaps });
    const gl = WebGL2RenderingContext.prototype;
    const createTexture = gl.createTexture;
    const deleteTexture = gl.deleteTexture;
    const generateMipmap = gl.generateMipmap;
    gl.createTexture = function () {
      const texture = createTexture.call(this);
      if (texture && this.canvas instanceof HTMLCanvasElement && this.canvas.classList.contains('live2d-canvas'))
        textures.add(texture);
      return texture;
    };
    gl.deleteTexture = function (texture) {
      if (texture) textures.delete(texture);
      return deleteTexture.call(this, texture);
    };
    gl.generateMipmap = function (target) {
      mipmaps++;
      return generateMipmap.call(this, target);
    };
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
  await expect(page.locator('.live2d-catalog-notice')).toContainText('完整角色目录加载失败');
  await expect(page.getByText('没有找到匹配的角色或服装。', { exact: true })).toHaveCount(0);
  await page.locator('.live2d-catalog-notice button').click();
  await expect.poll(() => catalogRequests).toBe(2);
  await expect(page.locator('.live2d-catalog-notice')).toContainText('完整角色目录加载失败');
  await page.locator('.live2d-catalog-notice button').click();
  await expect(page.locator('.live2d-catalog-notice')).toHaveCount(0);
  expect(catalogRequests).toBe(3);
  await page.getByRole('button', { name: 'Our Notes 测试服装', exact: false }).click();
  await expect(page.locator('.live2d-studio-loading progress')).toBeVisible();
  await waitForLive2DReady(page);
  expect(shaderAttempts).toBe(3);
  const textureCount = await page.evaluate(() => Reflect.get(window, '__nativeTextures'));
  expect(textureCount).toBeGreaterThan(0);
  expect(await page.evaluate(() => Reflect.get(window, '__nativeMipmaps'))).toBeGreaterThan(0);
  // Same content under another release reuses disk bytes; switching back downloads no asset again.
  await page.getByRole('button', { name: 'Our Notes 缓存测试', exact: false }).click();
  await waitForLive2DReady(page);
  const beforeReturn = requests.length;
  await page.getByRole('button', { name: 'Our Notes 测试服装', exact: false }).click();
  await waitForLive2DReady(page);
  expect(requests.slice(beforeReturn).filter((url) => url.includes('/assets/'))).toEqual([]);
  expect(await page.evaluate(() => Reflect.get(window, '__nativeTextures'))).toBe(textureCount);
  expect(shaderAttempts).toBe(3);
  await expect(page.locator('canvas.live2d-canvas')).toHaveCount(1);
  await measureFrameBudget(page, 'Our Notes');
  const canvas = await page.locator('canvas.live2d-canvas').elementHandle();
  await page.getByRole('button', { name: '表情与姿态', exact: true }).click();
  await expect(page.locator('.live2d-studio-parameter').first()).toBeVisible();
  await page.getByRole('searchbox', { name: '搜索动作 / 表情译名或编号' }).fill('心动');
  await expect(page.getByRole('combobox', { name: '表情', exact: true }).locator('option[value=exp_heart01]')).toContainText(
    '心动',
  );
  await page.getByRole('combobox', { name: '表情', exact: true }).selectOption('exp_heart01');
  await page.getByRole('searchbox', { name: '搜索动作 / 表情译名或编号' }).fill('angry');
  // Filtering cannot remove the selected value from a controlled select.
  await expect(page.getByRole('combobox', { name: '表情', exact: true })).toHaveValue('exp_heart01');
  await page.getByRole('searchbox', { name: '搜索动作 / 表情译名或编号' }).fill('');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.waitForTimeout(250);
  const draws = () => page.evaluate(() => Reflect.get(window, '__nativeDraws') as number);
  const paused = await draws();
  await page.waitForTimeout(500);
  expect(await draws()).toBe(paused);
  await dragRange(page, 'ParamAngleX');
  await expect.poll(draws).toBeGreaterThan(paused);
  await verifyStageGestures(page);
  await verifySceneTools(page);
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
  expect(catalogRequests).toBe(3);
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
  await verifyStageGestures(page);
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

/** Color and background changes stay local and share the PNG composition without extra model draws. */
async function verifySceneTools(page: Page) {
  const stage = page.locator('.live2d-studio-stage');
  const model = page.locator('.live2d-studio-model');
  const draws = await page.evaluate(() => Reflect.get(window, '__nativeDraws'));
  await page.getByRole('button', { name: '胶片', exact: true }).click();
  await expect(model).toHaveCSS('filter', 'sepia(0.25) saturate(0.85) contrast(1.08)');
  await page.getByRole('button', { name: '对比原色', exact: true }).click();
  await expect(model).toHaveCSS('filter', 'none');
  await page.getByRole('button', { name: '恢复滤镜', exact: true }).click();
  await dragRange(page, '滤镜强度');
  await expect(model).not.toHaveCSS('filter', 'none');
  await page.getByRole('slider', { name: '滤镜强度', exact: true }).press('Home');
  await expect(model).toHaveCSS('filter', 'none');
  const background = page.locator('input[type=file][accept="image/png,image/jpeg,image/webp"]');
  const bytes = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 24;
    c.height = 24;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('Missing 2D context');
    ctx.fillStyle = '#247392';
    ctx.fillRect(0, 0, 24, 24);
    return c.toDataURL().split(',')[1];
  });
  await background.setInputFiles({ name: 'local-background.png', mimeType: 'image/png', buffer: Buffer.from(bytes, 'base64') });
  await expect(stage.locator('img')).toHaveAttribute('src', /^blob:/);
  await expect(page.locator('.live2d-studio-notice')).toContainText('不会上传');
  const blobUrl = await stage.locator('img').getAttribute('src');
  if (!blobUrl) throw new Error('Missing local background URL');
  expect(await page.evaluate(() => Reflect.get(window, '__nativeDraws'))).toBe(draws);
  const exportDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PNG', exact: true }).click();
  const download = await exportDownload;
  // Native capture renders one explicit frame because its drawing buffer is not preserved.
  const afterCapture = await page.evaluate(() => Reflect.get(window, '__nativeDraws'));
  const path = await download.path();
  if (!path) throw new Error('Export not downloaded');
  // A corner outside the centered character must contain the uploaded background in the PNG too.
  const { default: sharp } = await import('sharp');
  const { data } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(Math.abs(data[0] - 36)).toBeLessThan(8);
  expect(Math.abs(data[1] - 115)).toBeLessThan(8);
  expect(Math.abs(data[2] - 146)).toBeLessThan(8);
  await page.getByRole('button', { name: '重置画面', exact: true }).click();
  await expect(stage.locator('img')).toHaveCount(0);
  expect(
    await page.evaluate(async (url) => {
      try {
        await fetch(url);
        return false;
      } catch {
        return true;
      }
    }, blobUrl),
  ).toBe(true);
  await background.setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(page.locator('.live2d-studio-notice')).toContainText('请选择');
  await expect(stage.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, '__nativeDraws'))).toBe(afterCapture);
}

/** Pan/zoom are composition-only: no reload, no animation restart, and no lost capture outside the stage. */
async function verifyStageGestures(page: Page) {
  await page.getByRole('button', { name: '画面', exact: true }).click();
  const stage = page.getByRole('application', { name: '预览画布', exact: true });
  const zoom = page.getByRole('slider', { name: '人物缩放', exact: true });
  const x = page.getByRole('slider', { name: '左右位置', exact: true });
  const y = page.getByRole('slider', { name: '上下位置', exact: true });
  const dialogue = page.getByRole('textbox', { name: '台词', exact: true });
  await dialogue.fill('保留这句台词');
  await stage.press('0');
  const box = await stage.boundingBox();
  if (!box) throw new Error('Missing preview stage');
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  await page.waitForTimeout(200);
  const drawsBefore = await page.evaluate(() => Reflect.get(window, '__nativeDraws'));
  const canvas = await stage.locator('canvas').elementHandle();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + box.width * 0.1, cy + box.height * 0.07, { steps: 6 });
  expect(Number(await x.inputValue())).toBeCloseTo(10, 0);
  expect(Number(await y.inputValue())).toBeCloseTo(7, 0);
  await page.mouse.move(cx - box.width * 0.1, cy - box.height * 0.07, { steps: 6 });
  expect(Number(await x.inputValue())).toBeCloseTo(-10, 0);
  await page.mouse.move(box.x - 10, cy);
  await page.mouse.up();
  expect(await x.inputValue()).toBe('-40');
  await expect(stage).not.toHaveAttribute('data-dragging');
  await page.mouse.move(cx, cy);
  expect(await x.inputValue()).toBe('-40');
  await stage.press('Home');
  await page.mouse.move(cx + box.width * 0.25, cy);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, -80);
  await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThan(100);
  expect(Number(await x.inputValue())).toBeLessThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  await stage.dblclick({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(zoom).toHaveValue('100');
  await expect(x).toHaveValue('0');
  await expect(y).toHaveValue('0');
  await expect(dialogue).toHaveValue('保留这句台词');
  await stage.press('Shift+ArrowRight');
  await expect(x).toHaveValue('5');
  await stage.press('+');
  await expect(zoom).toHaveValue('105');
  // A textarea owns its own shortcuts; composition shortcuts only apply to the focused stage.
  await dialogue.press('Home');
  await dialogue.press('ArrowRight');
  await expect(zoom).toHaveValue('105');
  expect(await canvas?.evaluate((element) => element.isConnected)).toBe(true);
  expect(await page.evaluate(() => Reflect.get(window, '__nativeDraws'))).toBe(drawsBefore);
  await page.getByRole('button', { name: '重置画面', exact: true }).click();
}

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
