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
  await page.getByRole('radio', { name: '始终显示' }).check();
  await page.getByRole('button', { name: 'Live2D 设置' }).click();
  for (const modal of immersiveModals) {
    await openImmersiveModal(page, modal);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Live2D 设置' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.live2d-root')).toHaveCount(1);
  }
});
