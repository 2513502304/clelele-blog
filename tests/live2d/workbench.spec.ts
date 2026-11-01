import { expect, type Page, test } from '@playwright/test';

type WorkbenchDocument = { poster: { layers: Array<{ id: string } & Record<string, unknown>> } };
// The standalone ES-module entry is outside Astro's global Window declarations.
// Keep its browser-test contract local instead of widening every page's Window.
type WorkbenchWindow = Window & {
  studioPrototype: {
    state: { ready: boolean };
    engine: { pause(): void };
    actionControls: { refresh(force: boolean): void };
    captureDocument(): WorkbenchDocument;
    restoreDocument(document: WorkbenchDocument): Promise<void>;
    posterEditor: { selectLayer(id: string, showEditor: boolean): void };
  };
  rangeBeforeDrag?: Element;
};

// Inspect every control, including collapsed panels: a stale fill often only becomes
// visible after switching text layers, recipes or restoring a document.
async function expectSynchronizedRanges(page: Page) {
  const mismatches = await page.locator('input[type="range"]').evaluateAll((elements) =>
    elements.flatMap((element) => {
      const input = element as HTMLInputElement;
      const min = input.min === '' ? 0 : Number(input.min);
      const max = input.max === '' ? 100 : Number(input.max);
      const expected = max > min ? Math.max(0, Math.min(100, ((input.valueAsNumber - min) / (max - min)) * 100)) : 0;
      const fill = parseFloat(input.style.getPropertyValue('--range-progress'));
      return Number.isFinite(fill) && Math.abs(fill - expected) < 0.011
        ? []
        : [{ id: input.id || input.dataset.look, value: input.value, fill, expected }];
    }),
  );
  expect(mismatches).toEqual([]);
}

test('range fills follow native sanitization without synthetic input events', async ({ page }) => {
  await page.route('**/range-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<main></main>' }));
  await page.goto('/range-fixture');
  const result = await page.evaluate(async () => {
    const moduleUrl = '/live2d-studio/range-controls.js';
    const { setControlValue } = await import(/* @vite-ignore */ moduleUrl);
    let events = 0;
    for (const [min, max, step, value] of [
      ['', '', '1', '25'],
      ['-180', '180', '1', '-90'],
      ['1', '30', '.1', '1.7'],
      ['0', '3', '.01', '9'],
      ['0', '0', '1', '1'],
    ]) {
      const input = document.createElement('input');
      input.type = 'range';
      input.min = min;
      input.max = max;
      input.step = step;
      input.addEventListener('input', () => events++);
      document.querySelector('main')?.append(input);
      setControlValue(input, value);
    }
    return events;
  });
  expect(result).toBe(0);
  await expectSynchronizedRanges(page);
});

test('workbench restores all slider fills, indents children and keeps one undo per drag', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1720, height: 1100 });
  await page.goto('/live2d-studio/index.html');
  await page.waitForFunction(() => (window as unknown as WorkbenchWindow).studioPrototype?.state.ready, null, {
    timeout: 120_000,
  });
  await page.evaluate(() => (window as unknown as WorkbenchWindow).studioPrototype.engine.pause());
  await expectSynchronizedRanges(page);
  // Rebuilding paused posture controls in a background tab must initialize them
  // immediately, without waiting for a render tick or a visibilitychange event.
  await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    try {
      (window as unknown as WorkbenchWindow).studioPrototype.actionControls.refresh(true);
    } finally {
      if (descriptor) Object.defineProperty(document, 'hidden', descriptor);
      else Reflect.deleteProperty(document, 'hidden');
    }
  });
  await expectSynchronizedRanges(page);
  await page.locator('[data-tab=poster]').click();
  await page.locator('#text-add').click();
  // Restore deliberately non-default values, the exact path behind the reported bug.
  await page.evaluate(async () => {
    const s = (window as unknown as WorkbenchWindow).studioPrototype,
      document = s.captureDocument();
    Object.assign(document.poster.layers[0], {
      size: 0.017,
      tracking: 0.11,
      lineHeight: 1.05,
      opacity: 0.63,
      shadowAngle: -30,
    });
    await s.restoreDocument(document);
    s.posterEditor.selectLayer(document.poster.layers[0].id, true);
  });
  for (const tab of ['font', 'color', 'effects', 'background', 'position']) {
    await page.locator(`[data-text-page=${tab}]`).click();
    await expectSynchronizedRanges(page);
  }
  await page.locator('[data-text-page=font]').click();
  const range = page.locator('#poster-size');
  await range.scrollIntoViewIfNeeded();
  const before = await range.inputValue(),
    bounds = await range.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) throw new Error('Font size slider has no layout box.');
  await range.evaluate((input) => {
    (window as unknown as WorkbenchWindow).rangeBeforeDrag = input;
  });
  await page.mouse.move(bounds.x + 10, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.3, bounds.y + bounds.height / 2);
  await page.waitForTimeout(650);
  await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height / 2, { steps: 12 });
  await page.mouse.up();
  expect(await range.inputValue()).not.toBe(before);
  expect(await range.evaluate((input) => input === (window as unknown as WorkbenchWindow).rangeBeforeDrag)).toBe(true);
  await expectSynchronizedRanges(page);
  await page.keyboard.press('Control+z');
  await expect(range).toHaveValue(before);
  await expectSynchronizedRanges(page);
  await page.locator('[data-tab=filters]').click();
  await page.locator('[data-look-recipe=arcade]').click();
  await page.locator('#adjust-filter').click();
  await expectSynchronizedRanges(page);
  const indentation = await page
    .locator('.look-group')
    .filter({ has: page.locator('[data-look=contrast]') })
    .evaluate((group) => {
      const title = group.querySelector('summary')?.getBoundingClientRect();
      const child = group.querySelector('.look-range')?.getBoundingClientRect();
      if (!title || !child) throw new Error('Filter group is missing its title or child.');
      return child.left - title.left;
    });
  expect(indentation).toBeGreaterThanOrEqual(10);
  await page.setViewportSize({ width: 740, height: 960 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
