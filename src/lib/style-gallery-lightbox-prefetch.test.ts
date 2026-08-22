import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStyleGalleryImageApiPath } from './style-gallery-image-key';
import { createLightboxPrefetchPlan } from './style-gallery-lightbox-prefetch';

test('parses only canonical Style Gallery image API paths', () => {
  assert.equal(parseStyleGalleryImageApiPath('/api/style-gallery/image/source/012345abcdef.jpg'), 'source/012345abcdef.jpg');
  assert.equal(
    parseStyleGalleryImageApiPath(
      '/api/style-gallery/image/examples/images/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.webp',
    ),
    'examples/images/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.webp',
  );
  assert.equal(parseStyleGalleryImageApiPath('/api/style-gallery/image/metadata/catalog.json'), null);
  assert.equal(parseStyleGalleryImageApiPath('https://example.com/image.webp'), null);
  assert.equal(parseStyleGalleryImageApiPath('/api/style-gallery/image/source/../../secret.webp'), null);
});

test('signs the current page and begins the next page before navigation reaches the boundary', () => {
  const initial = createLightboxPrefetchPlan(70, 0);
  assert.deepEqual(
    initial.signIndexes,
    Array.from({ length: 24 }, (_, index) => index),
  );
  assert.deepEqual(initial.preloadIndexes, [1, 2, 3, 4, 5, 6]);

  const nearBoundary = createLightboxPrefetchPlan(70, 16);
  assert.equal(nearBoundary.signIndexes.at(0), 0);
  assert.equal(nearBoundary.signIndexes.at(-1), 47);
  assert.deepEqual(nearBoundary.preloadIndexes, [17, 18, 19, 20, 21, 22]);
});

test('clamps signing and preloading at the final image', () => {
  const plan = createLightboxPrefetchPlan(27, 25);
  assert.deepEqual(plan.signIndexes, [24, 25, 26]);
  assert.deepEqual(plan.preloadIndexes, [26]);
  assert.deepEqual(createLightboxPrefetchPlan(0, 0), { signIndexes: [], preloadIndexes: [] });
});
