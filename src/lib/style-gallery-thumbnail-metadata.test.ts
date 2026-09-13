import assert from 'node:assert/strict';
import test from 'node:test';
import { getStyleGallerySourceThumbnail } from './style-gallery-image-key';
import { stripStyleGalleryThumbnailMetadata } from './style-gallery-thumbnail-metadata';

test('source thumbnails follow the first image filename rather than a composite item hash', () => {
  const sourceImage = '/api/style-gallery/image/source/012345abcdef.png';
  const thumbnailImage = '/api/style-gallery/image/thumb/012345abcdef.webp';
  const item = {
    imageHash: 'f'.repeat(64),
    sourceImage,
    thumbnailImage,
    images: [{ sourceImage, thumbnailImage }],
    examples: [{ id: 'one', likedBy: [1, 2] }],
  };
  assert.equal(getStyleGallerySourceThumbnail(sourceImage), thumbnailImage);
  const result = stripStyleGalleryThumbnailMetadata(item);
  assert.equal(result.removed, 2);
  assert.deepEqual(result.value, {
    imageHash: item.imageHash,
    sourceImage,
    images: [{ sourceImage }],
    examples: item.examples,
  });
  assert.equal(item.thumbnailImage, thumbnailImage, 'input snapshots must remain intact for backups');
  assert.equal(stripStyleGalleryThumbnailMetadata(result.value).removed, 0);
});

test('metadata migration refuses custom or malformed thumbnail paths', () => {
  assert.throws(() =>
    stripStyleGalleryThumbnailMetadata({
      sourceImage: '/api/style-gallery/image/source/012345abcdef.jpg',
      thumbnailImage: '/custom.webp',
    }),
  );
  assert.throws(() => getStyleGallerySourceThumbnail('/api/style-gallery/image/source/invalid.png'));
});
