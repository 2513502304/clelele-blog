import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import { readStyleGalleryImageDimensions, readWebpHeaderDimensions } from './style-gallery-image-dimensions';
import { getMasonryPositions } from './style-gallery-layout';

describe('gallery masonry geometry', () => {
  it('reads lossy, lossless and extended WebP prefixes and defers EXIF orientation', async () => {
    const input = { create: { width: 300, height: 170, channels: 3 as const, background: 'red' } };
    for (const image of [sharp(input).webp(), sharp(input).webp({ lossless: true }), sharp(input).ensureAlpha(0.5).webp()]) {
      const bytes = await image.toBuffer();
      assert.deepEqual(readWebpHeaderDimensions(bytes.subarray(0, 30)), { width: 300, height: 170 });
    }
    const oriented = await sharp(input).withMetadata({ orientation: 6 }).webp().toBuffer();
    assert.equal(readWebpHeaderDimensions(oriented.subarray(0, 30)), undefined);
    assert.deepEqual(await readStyleGalleryImageDimensions(oriented), { width: 170, height: 300 });
    assert.equal(readWebpHeaderDimensions(Buffer.alloc(12)), undefined);
    assert.equal(readWebpHeaderDimensions(Buffer.alloc(30)), undefined);
  });
  it('packs mixed aspect ratios into four columns without moving existing cards on append', () => {
    const heights = [400, 200, 300, 500, 250, 100];
    const first = getMasonryPositions(heights, 4, 16);
    assert.deepEqual(first.positions, [
      { column: 0, top: 0 },
      { column: 1, top: 0 },
      { column: 2, top: 0 },
      { column: 3, top: 0 },
      { column: 0, top: 416 },
      { column: 1, top: 216 },
    ]);
    assert.equal(first.height, 666);
    assert.deepEqual(getMasonryPositions([...heights, 700, 90], 4, 16).positions.slice(0, heights.length), first.positions);
    assert.deepEqual(getMasonryPositions([], 4, 16), { positions: [], height: 0 });
    assert.deepEqual(getMasonryPositions([100, 50], 1, 16).positions, [
      { column: 0, top: 0 },
      { column: 0, top: 116 },
    ]);
  });

  it('records oriented JPEG and landscape PNG dimensions without full image decoding', async () => {
    const jpeg = await sharp({ create: { width: 120, height: 80, channels: 3, background: 'red' } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    assert.deepEqual(await readStyleGalleryImageDimensions(jpeg), { width: 80, height: 120 });
    const png = await sharp({ create: { width: 300, height: 100, channels: 3, background: 'blue' } })
      .png()
      .toBuffer();
    assert.deepEqual(await readStyleGalleryImageDimensions(png), { width: 300, height: 100 });
    await assert.rejects(readStyleGalleryImageDimensions(Buffer.from('not an image')));
  });
});
