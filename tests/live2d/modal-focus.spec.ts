import { expect, test } from '@playwright/test';
import { waitForLive2DReady } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForLive2DReady(page);
});

test('smart policy hides for an immersive modal and restores without a duplicate island', async ({ page }) => {
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent('open-code-fullscreen', {
        detail: {
          code: 'const value = 1;',
          codeHTML: '<span>const value = 1;</span>',
          language: 'ts',
          preClassName: '',
          preStyle: '',
          codeClassName: '',
        },
      }),
    );
  });
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.live2d-root')).not.toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await waitForLive2DReady(page);
  await expect(page.locator('.live2d-root')).toHaveCount(1);
});

test('always-visible policy keeps Live2D focus inside the modal scope and scopes Escape', async ({ page }) => {
  await page.getByRole('button', { name: 'Live2D 设置' }).click();
  await page.getByRole('radio', { name: '始终显示' }).check();
  await page.getByRole('button', { name: 'Live2D 设置' }).click();
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent('open-code-fullscreen', {
        detail: {
          code: 'const value = 1;',
          codeHTML: '<span>const value = 1;</span>',
          language: 'ts',
          preClassName: '',
          preStyle: '',
          codeClassName: '',
        },
      }),
    );
  });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Live2D 设置' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.live2d-root')).toHaveCount(1);
});
