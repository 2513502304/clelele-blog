import { expect, test } from '@playwright/test';
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
    const original = WebGL2RenderingContext.prototype.drawElements;
    let draws = 0;
    Object.defineProperty(window, '__nativeDraws', { get: () => draws });
    WebGL2RenderingContext.prototype.drawElements = function (...args) {
      draws++;
      return original.apply(this, args);
    };
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
  await page.getByRole('button', { name: 'Live2D 工作室', exact: true }).click();
  await page.getByRole('button', { name: 'Our Notes 测试服装', exact: false }).click();
  await waitForLive2DReady(page);
  await expect(page.locator('canvas.live2d-canvas')).toHaveCount(1);
  const canvas = await page.locator('canvas.live2d-canvas').elementHandle();
  await page.getByRole('button', { name: '表情与姿态', exact: true }).click();
  await expect(page.locator('.live2d-studio-parameter').first()).toBeVisible();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.waitForTimeout(250);
  const draws = () => page.evaluate(() => Reflect.get(window, '__nativeDraws') as number);
  const paused = await draws();
  await page.waitForTimeout(500);
  expect(await draws()).toBe(paused);
  await page.getByRole('slider', { name: 'ParamAngleX', exact: true }).fill('20.1');
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
  await page.getByRole('button', { name: '继续', exact: true }).click();
  const resumed = await draws();
  await expect.poll(draws).toBeGreaterThan(resumed);
  await page.getByRole('button', { name: '画面', exact: true }).click();
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
  expect(errors).toEqual([]);
});
