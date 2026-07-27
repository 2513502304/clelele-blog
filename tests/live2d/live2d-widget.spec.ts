import { expect, test } from '@playwright/test';
import { expectNonBlankCanvas, live2dRequests, releaseIds, waitForLive2DReady } from './helpers';

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
    { group: 0, button: 'SR 服装', releaseId: releaseIds.anonSr },
    { group: 1, button: '默认', releaseId: releaseIds.tomoriDefault },
    { group: 1, button: 'SR 服装', releaseId: releaseIds.tomoriSr },
  ];
  for (const target of targets) {
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
