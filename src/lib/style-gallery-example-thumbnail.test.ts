import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { encodeStyleGalleryExampleThumbnail } from './style-gallery-example-thumbnail';
import { getUnreferencedStyleGalleryExampleAssetKeys } from './style-gallery-example-upload';
import {
  getStyleGalleryExampleThumbnailKey,
  getStyleGalleryExampleThumbnailSource,
  isAllowedStyleGalleryImageKey,
} from './style-gallery-image-key';

const hash = 'a'.repeat(64);
test('derived thumbnail keys do not widen public signing to arbitrary bucket objects', () => {
  const source = `/api/style-gallery/image/examples/images/${hash}.png`;
  assert.equal(getStyleGalleryExampleThumbnailKey(source), `examples/thumbs/${hash}.webp`);
  assert.equal(getStyleGalleryExampleThumbnailSource(source), `/api/style-gallery/image/examples/thumbs/${hash}.webp`);
  assert.ok(isAllowedStyleGalleryImageKey(`examples/thumbs/${hash}.webp`));
  for (const key of ['examples/thumbs/index.json', `examples/thumbs/${hash}.png`, `examples/thumbs/../${hash}.webp`]) {
    assert.equal(isAllowedStyleGalleryImageKey(key), false);
  }
  assert.throws(() => getStyleGalleryExampleThumbnailKey('/api/style-gallery/image/thumb/aaaaaaaaaaaa.webp'));
});

test('thumbnails preserve rotated aspect ratio, cap width, and do not enlarge small sources', async () => {
  const source = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: 'pink' } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const preview = await sharp(await encodeStyleGalleryExampleThumbnail(source)).metadata();
  assert.equal(preview.format, 'webp');
  assert.equal(preview.width, 640);
  assert.equal(preview.height, 1024);
  assert.equal(preview.orientation, undefined);
  const small = await sharp({ create: { width: 100, height: 80, channels: 4, background: '#0000' } })
    .png()
    .toBuffer();
  const tiny = await sharp(await encodeStyleGalleryExampleThumbnail(small)).metadata();
  assert.equal(tiny.width, 100);
  assert.equal(tiny.height, 80);
  assert.ok(tiny.hasAlpha);
});

test('deleting one original retains a thumbnail referenced through another extension', () => {
  const src = `/api/style-gallery/image/examples/images/${hash}.jpg`;
  const example = {
    id: 'test',
    src,
    imageHash: hash,
    model: 'PixAI' as const,
    alt: 'test',
    uploadedAt: '2026-09-13T00:00:00Z',
  };
  const refs = new Set([`/api/style-gallery/image/examples/images/${hash}.jpeg`]);
  assert.deepEqual(getUnreferencedStyleGalleryExampleAssetKeys([example], refs), [`examples/images/${hash}.jpg`]);
  assert.deepEqual(getUnreferencedStyleGalleryExampleAssetKeys([example], new Set()), [
    `examples/images/${hash}.jpg`,
    `examples/thumbs/${hash}.webp`,
  ]);
});
