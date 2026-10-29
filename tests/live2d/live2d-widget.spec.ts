import { expect, test } from '@playwright/test';
import bootstrapCatalog from '../../src/data/live2d/catalog.json' with { type: 'json' };
import { expectNonBlankCanvas, fixtureCostume, live2dRequests, releaseIds, waitForLive2DReady } from './helpers';

// Exercise real HF packages with a stable small picker. The production catalog grows independently.
test.beforeEach(async ({ page }) => {
  const catalog = structuredClone(bootstrapCatalog);
  for (const character of catalog.characters)
    character.costumes = character.costumes.filter((c) => !c.entryPath.endsWith('.native.json'));
  await page.route('**/api/live2d/catalog*', (route) => route.fulfill({ json: catalog }));
  await page.route('**/image-style-prompt-gallery', (route) => route.fulfill({ status: 200, body: '' }));
});

test('desktop defers the real model, renders nonblank pixels, and switches all four releases', async ({ page }) => {
  // This release gate intentionally cold-loads four remote packages in sequence; each individual
  // generation keeps its normal 90-second readiness assertion, while the aggregate gets headroom.
  test.setTimeout(300_000);
  const requests = live2dRequests(page);
  await page.goto('/');
  await expect(page.locator('main')).toBeVisible();
  await waitForLive2DReady(page);
  await expectNonBlankCanvas(page);
  expect(requests.some((url) => url.includes(releaseIds.anonDefault))).toBe(true);

  await page.getByRole('button', { name: '角色与服装' }).click();
  const groups = page.locator('.live2d-picker-group');
  await expect(groups).toHaveCount(2);
  const targets = [
    { group: 0, button: fixtureCostume('chihaya-anon', 'live-sr-01').label.zh, releaseId: releaseIds.anonSr },
    { group: 1, button: fixtureCostume('takamatsu-tomori', 'default').label.zh, releaseId: releaseIds.tomoriDefault },
    { group: 1, button: fixtureCostume('takamatsu-tomori', 'live-sr-01').label.zh, releaseId: releaseIds.tomoriSr },
  ];
  for (const target of targets) {
    const character = groups.nth(target.group).locator('.live2d-character-row');
    if ((await character.getAttribute('aria-expanded')) !== 'true') await character.click();
    const entryResponse = page.waitForResponse(
      (response) => response.url().includes(`${target.releaseId}/model.json`) && response.status() === 200,
      { timeout: 90_000 },
    );
    await groups.nth(target.group).getByRole('button', { name: target.button, exact: true }).click();
    await entryResponse;
    await waitForLive2DReady(page);
    await expectNonBlankCanvas(page);
  }

  await page.locator('.live2d-interaction-surface').click({ position: { x: 140, y: 80 } });
  await expect(page.locator('.live2d-dialogue')).toBeVisible();
  await expect(page.locator('[data-live2d-policy]')).toHaveCount(1);
});

test('mobile transfers no model bytes until the visitor wakes the widget', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = live2dRequests(page);
  await page.goto('/');
  await page.waitForTimeout(2_500);
  expect(requests).toHaveLength(0);
  await expect(page.getByRole('button', { name: '显示 Live2D 角色' })).toBeVisible();
  await page.getByRole('button', { name: '显示 Live2D 角色' }).click();
  await waitForLive2DReady(page);
  await expectNonBlankCanvas(page);
  expect(requests.length).toBeGreaterThan(0);
});

test('manual motion selection interrupts immediately and pause preserves the current model state', async ({ page }) => {
  const warmedMotion = page.waitForResponse(
    (response) => response.url().includes(`${releaseIds.anonDefault}/data/motions/angry04.mtn`) && response.status() === 200,
    { timeout: 90_000 },
  );
  await page.goto('/');
  await waitForLive2DReady(page);
  await warmedMotion;
  await page.getByRole('button', { name: '动作与表情' }).click();

  const motion = page.locator('.live2d-select-field select').first();
  const selectedMotionStarted = page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const handleMotion = (event: Event) => {
          const group = (event as CustomEvent<{ group: string }>).detail.group;
          if (group !== 'angry04') return;
          window.removeEventListener('live2d:motionstart', handleMotion);
          resolve(group);
        };
        window.addEventListener('live2d:motionstart', handleMotion);
      }),
  );
  await expect(motion.locator('option').filter({ hasText: 'angry04' })).toContainText('生气');
  await motion.selectOption('angry04\u00000');
  await expect(motion).toHaveValue('angry04\u00000');
  expect(await selectedMotionStarted).toBe('angry04');

  const interactionMotion = page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const handleMotion = (event: Event) => {
          const group = (event as CustomEvent<{ group: string }>).detail.group;
          if (group !== 'smile01') return;
          window.removeEventListener('live2d:motionstart', handleMotion);
          resolve(group);
        };
        window.addEventListener('live2d:motionstart', handleMotion);
      }),
  );
  await page.locator('.live2d-interaction-surface').click({ position: { x: 140, y: 80 } });
  await expect(page.locator('.live2d-dialogue')).toContainText('ねえねえ、今日は何を見に来たの？');
  await expect(motion).toHaveValue('smile01\u00000');
  expect(await interactionMotion).toBe('smile01');

  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(page.locator('.live2d-root')).toHaveAttribute('data-phase', 'ready');
  const frozenFrame = await page
    .locator('.live2d-canvas')
    .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL('image/png'));
  await page.waitForTimeout(350);
  const laterFrozenFrame = await page
    .locator('.live2d-canvas')
    .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL('image/png'));
  expect(laterFrozenFrame).toBe(frozenFrame);
  await expect(motion).toHaveValue('smile01\u00000');

  await page.getByRole('button', { name: '继续', exact: true }).click();
  await page.waitForTimeout(200);
  const resumedFrame = await page
    .locator('.live2d-canvas')
    .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL('image/png'));
  expect(resumedFrame).not.toBe(frozenFrame);
  await expect(motion).toHaveValue('smile01\u00000');
});

test('enabled character voice requests the audio paired with the visible dialogue', async ({ page }) => {
  // Voice lives in a separate immutable package; the offline bootstrap deliberately has no voice index.
  const voiceRelease = '8bd9cc3f540fdd018c3313199722827d1895c856f614ef204519d46d8fca6fbd';
  const catalog = structuredClone(bootstrapCatalog);
  Object.assign(catalog.characters[0], {
    voice: {
      releaseId: voiceRelease,
      entryPath: `releases/${voiceRelease}/dialogues.json`,
      packageBytes: 310581,
      dialogueCount: 18,
      provenancePath: `provenance/${voiceRelease}.json`,
    },
  });
  await page.route('**/api/live2d/catalog*', (route) => route.fulfill({ json: catalog }));
  const voiceIndex = page.waitForResponse(
    (response) => response.url().includes(`${voiceRelease}/dialogues.json`) && response.ok(),
  );
  await page.goto('/');
  await waitForLive2DReady(page);
  await voiceIndex;
  await page.getByRole('button', { name: 'Live2D 设置' }).click();
  const audioSwitch = page.getByRole('switch', { name: '角色语音' });
  if ((await audioSwitch.getAttribute('aria-checked')) !== 'true') await audioSwitch.click();
  await expect(audioSwitch).toHaveAttribute('aria-checked', 'true');

  const audioResponse = page.waitForResponse((response) => response.url().includes(`${voiceRelease}/audio/`) && response.ok(), {
    timeout: 30_000,
  });
  await page.locator('.live2d-interaction-surface').click({ position: { x: 140, y: 80 } });
  const response = await audioResponse;

  await expect(page.locator('.live2d-dialogue')).toBeVisible();
  expect(response.headers()['content-type']).toBe('audio/mpeg');
});

test('automatic effect preferences persist without reloading the model', async ({ page }) => {
  const requests = live2dRequests(page);
  await page.goto('/');
  await waitForLive2DReady(page);
  const nonMotionRequestCount = () => requests.filter((url) => !url.includes('/data/motions/')).length;
  const requestsBeforeToggle = nonMotionRequestCount();
  const animationButton = page.getByRole('button', { name: '动作与表情' });
  await animationButton.hover();
  const tooltip = page.locator('.live2d-controls-tooltip');
  await expect(tooltip).toHaveAttribute('data-visible', 'true');
  const [tooltipBox, toolbarBox] = await Promise.all([tooltip.boundingBox(), page.locator('.live2d-controls').boundingBox()]);
  expect(tooltipBox).not.toBeNull();
  expect(toolbarBox).not.toBeNull();
  expect((tooltipBox?.y ?? 0) + (tooltipBox?.height ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(
    toolbarBox?.y ?? Number.NEGATIVE_INFINITY,
  );

  await animationButton.click();
  await expect(tooltip).not.toHaveAttribute('data-visible', 'true');

  const sway = page.getByRole('switch', { name: '摇摆' });
  await expect(sway).toHaveAttribute('aria-checked', 'true');
  await sway.click();
  await expect(sway).toHaveAttribute('aria-checked', 'false');
  expect(nonMotionRequestCount()).toBe(requestsBeforeToggle);
  const storedEffects = await page.evaluate(() => JSON.parse(localStorage.getItem('live2d-preferences') ?? '{}').effects);
  expect(storedEffects).toEqual({ sway: false, breathe: true, blink: true });

  await page.reload();
  await waitForLive2DReady(page);
  await page.getByRole('button', { name: '动作与表情' }).click();
  await expect(page.getByRole('switch', { name: '摇摆' })).toHaveAttribute('aria-checked', 'false');
});
