import { expect, type Page, test } from '@playwright/test';
import { isLive2DCoreModelRequest, live2dRequests, waitForLive2DReady } from './helpers';

type ImmersiveModal = 'code' | 'image' | 'diagram';

const immersiveModals: ImmersiveModal[] = ['code', 'image', 'diagram'];

async function openImmersiveModal(page: Page, modal: ImmersiveModal): Promise<void> {
  if (modal === 'image') {
    const image = page.locator('.custom-content img.markdown-image[alt="示例图片"]');
    await image.scrollIntoViewIfNeeded();
    await expect(image).toHaveClass(/loaded/);
    await image.click();
    return;
  }

  const wrapper = page.locator(modal === 'code' ? '.code-block-wrapper' : '.mermaid-wrapper').first();
  await wrapper.getByRole('button', { name: '全屏查看' }).last().click();
}

test.beforeEach(async ({ page }) => {
  // Navigation prefetch is unrelated to modal lifecycle and must not depend on the remote gallery catalog.
  await page.route('**/image-style-prompt-gallery', (route) => route.fulfill({ status: 200, body: '' }));
  await page.goto('/post/markdown-features');
  await waitForLive2DReady(page);
});

test('smart policy hides for each immersive modal and restores without a duplicate island', async ({ page }) => {
  const requests = live2dRequests(page);
  await page.reload();
  await waitForLive2DReady(page);
  const coreRequestCount = () => requests.filter(isLive2DCoreModelRequest).length;
  for (const modal of immersiveModals) {
    const requestsBeforeModal = coreRequestCount();
    await openImmersiveModal(page, modal);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('.live2d-root')).not.toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await waitForLive2DReady(page);
    await expect(page.locator('.live2d-root')).toHaveCount(1);
    expect(coreRequestCount()).toBe(requestsBeforeModal);
  }
});

test('always-visible policy keeps Live2D focus inside the modal scope and scopes Escape', async ({ page }) => {
  await page.getByRole('button', { name: 'Live2D 设置' }).click();
  await page.getByRole('button', { name: '始终显示', exact: true }).click();
  await page.getByRole('button', { name: 'Live2D 设置' }).click();
  for (const modal of immersiveModals) {
    await openImmersiveModal(page, modal);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Live2D 设置' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeVisible();
    let deferredMotion = '';
    if (modal === 'code') {
      await page.getByRole('button', { name: '动作与表情' }).click();
      const motion = page.locator('.live2d-select-field select').first();
      deferredMotion = await motion
        .locator('option')
        .evaluateAll(
          (options) => (options as HTMLOptionElement[]).find((option) => option.value.includes('\u0000'))?.value ?? '',
        );
      expect(deferredMotion).not.toBe('');
      await page.evaluate(() => {
        const events: string[] = [];
        Object.assign(window, { deferredMotionEvents: events });
        window.addEventListener('live2d:motionstart', (event) => events.push((event as CustomEvent).detail.group));
      });
      await motion.selectOption(deferredMotion);
      const frozen = await page.locator('.live2d-canvas').evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
      await page.waitForTimeout(200);
      expect(await page.locator('.live2d-canvas').evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL())).toBe(frozen);
      expect(await page.evaluate(() => (window as unknown as { deferredMotionEvents: string[] }).deferredMotionEvents)).toEqual(
        [],
      );
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    if (deferredMotion) {
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { deferredMotionEvents: string[] }).deferredMotionEvents))
        .toContain(deferredMotion.split('\u0000')[0]);
    }
    await expect(page.locator('.live2d-root')).toHaveCount(1);
  }
});
