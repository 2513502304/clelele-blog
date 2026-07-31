import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadStyleGalleryImages } from './style-gallery-batch-download';

test('batch downloads isolate failed files and keep concurrency bounded', async () => {
  const items = Array.from({ length: 7 }, (_, index) => ({ id: `image-${index}`, src: `/image-${index}.webp` }));
  let active = 0;
  let maxActive = 0;
  const attempts = new Map<string, number>();
  const saved: string[] = [];

  const result = await downloadStyleGalleryImages(items, {
    concurrency: 2,
    attempts: 2,
    fetchImage: async (input) => {
      const src = String(input);
      attempts.set(src, (attempts.get(src) ?? 0) + 1);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return new Response(src.includes('image-3') ? 'failed' : new Blob(['image']), {
        status: src.includes('image-3') ? 503 : 200,
      });
    },
    saveBlob: (_blob, filename) => saved.push(filename),
  });

  assert.equal(maxActive, 2);
  assert.equal(result.downloaded, 6);
  assert.deepEqual(
    result.failed.map((item) => item.id),
    ['image-3'],
  );
  assert.equal(attempts.get('/image-3.webp'), 2);
  assert.deepEqual(
    saved,
    items.filter((item) => item.id !== 'image-3').map((item) => `${item.id}.webp`),
  );
});

test('non-finite worker options fall back to bounded defaults', async () => {
  const items = Array.from({ length: 4 }, (_, index) => ({ id: `image-${index}`, src: `/image-${index}.webp` }));
  let active = 0;
  let maxActive = 0;
  let calls = 0;

  const result = await downloadStyleGalleryImages(items, {
    concurrency: Number.POSITIVE_INFINITY,
    attempts: Number.NaN,
    fetchImage: async () => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return new Response('failed', { status: 503 });
    },
    saveBlob: () => undefined,
  });

  assert.equal(maxActive, 3);
  assert.equal(calls, items.length * 2);
  assert.equal(result.downloaded, 0);
  assert.equal(result.failed.length, items.length);
});
