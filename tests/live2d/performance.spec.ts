import { expect, test } from '@playwright/test';
import { isLive2DCoreModelRequest, live2dRequests, waitForLive2DReady } from './helpers';

test('Astro navigation preserves one widget and reuses browser-cached immutable assets', async ({ page }) => {
  const requests = live2dRequests(page);
  await page.goto('/');
  await waitForLive2DReady(page);
  const initialCoreRequests = requests.filter(isLive2DCoreModelRequest).length;
  await page.locator('#site-header').getByRole('link', { name: '关于', exact: true }).click();
  await expect(page).toHaveURL(/\/about$/);
  await waitForLive2DReady(page);
  await page.locator('#site-header').getByRole('link', { name: '首页', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await waitForLive2DReady(page);
  await expect(page.locator('.live2d-root')).toHaveCount(1);
  expect(requests.filter(isLive2DCoreModelRequest)).toHaveLength(initialCoreRequests);
});
