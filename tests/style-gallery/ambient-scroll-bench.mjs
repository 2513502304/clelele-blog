import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

/** Manual rendering comparison against a Git CSS baseline, without checking out or editing either tree.
 * Run the generation-fixture dev server on 4340 first, then:
 * node tests/style-gallery/ambient-scroll-bench.mjs 27f5b8d
 * Results describe a synthetic 240-card scene, not production throughput or network performance.
 */
const revision = process.argv[2];
if (!revision || !/^[\w./-]+$/.test(revision) || revision.startsWith('-')) throw new Error('Provide a Git baseline revision');
const baseline = execFileSync('git', ['show', `${revision}:src/styles/components/banner-ambient-light.css`], {
  encoding: 'utf8',
});
const art = await readFile(new URL('../../public/img/cover/6.webp', import.meta.url));
const browser = await chromium.launch();
const results = [];
try {
  for (let round = 1; round <= 3; round++) {
    // Alternate order to reduce warm-up and machine-load bias.
    for (const version of round % 2 ? ['baseline', 'current'] : ['current', 'baseline']) {
      const context = await browser.newContext({
        viewport: { width: 1512, height: 870 },
        deviceScaleFactor: 2,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      await page.route('**/*', (route) =>
        route.request().resourceType() === 'image' ? route.fulfill({ contentType: 'image/webp', body: art }) : route.continue(),
      );
      await page.route('**/api/live2d**', (route) => route.abort());
      await page.addInitScript(() => localStorage.setItem('appearance-scenery', JSON.stringify({ effect: 'none' })));
      await page.goto('http://127.0.0.1:4340/image-style-prompt-gallery', { waitUntil: 'networkidle' });
      await page.locator('[data-gallery-layout] article').first().waitFor();
      await page.evaluate(() => {
        const grid = document.querySelector('[data-gallery-layout]');
        const card = grid.firstElementChild;
        const height = card.offsetHeight + 16,
          width = card.offsetWidth + 16;
        for (let i = 1; i < 240; i++) {
          const clone = card.cloneNode(true);
          clone.removeAttribute('id');
          clone.style.left = `${(i % 4) * width}px`;
          clone.style.top = `${Math.floor(i / 4) * height}px`;
          grid.append(clone);
        }
        grid.style.height = `${height * 60}px`;
      });
      if (version === 'baseline') await page.addStyleTag({ content: baseline });
      const session = await context.newCDPSession(page);
      await session.send('Performance.enable');
      await page.mouse.move(800, 600);
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(500);
      const geometry = await page.locator('.page-reading-stage').evaluate((el) => ({
        stageHeight: el.offsetHeight,
        veilHeight: getComputedStyle(el, '::before').height,
        veilContent: getComputedStyle(el, '::before').content,
      }));
      const before = (await session.send('Performance.getMetrics')).metrics;
      const events = [];
      session.on('Tracing.dataCollected', (event) => events.push(...event.value));
      await session.send('Tracing.start', {
        categories: 'devtools.timeline,disabled-by-default-devtools.timeline,cc',
        transferMode: 'ReportEvents',
      });
      for (let i = 0; i < 35; i++) {
        await page.mouse.wheel(0, 650);
        await page.waitForTimeout(24);
      }
      await page.waitForTimeout(250);
      const after = (await session.send('Performance.getMetrics')).metrics;
      const stopped = new Promise((resolve) => session.once('Tracing.tracingComplete', resolve));
      await session.send('Tracing.end');
      await stopped;
      const duration = (name) =>
        events.filter((e) => e.name === name && e.ph === 'X').reduce((sum, e) => sum + e.dur, 0) / 1000;
      const result = {
        round,
        version,
        ...geometry,
        paintMs: duration('Paint'),
        rasterMs: duration('RasterTask'),
        ...Object.fromEntries(
          ['TaskDuration', 'LayoutDuration', 'RecalcStyleDuration'].map((name) => [
            name,
            after.find((m) => m.name === name).value - before.find((m) => m.name === name).value,
          ]),
        ),
      };
      results.push(result);
      console.log(JSON.stringify(result));
      await context.close();
    }
  }
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  for (const version of ['baseline', 'current']) {
    const runs = results.filter((r) => r.version === version);
    console.log(
      JSON.stringify({
        median: version,
        ...Object.fromEntries(
          ['paintMs', 'rasterMs', 'TaskDuration', 'LayoutDuration', 'RecalcStyleDuration'].map((key) => [
            key,
            median(runs.map((r) => r[key])),
          ]),
        ),
      }),
    );
  }
} finally {
  await browser.close();
}
