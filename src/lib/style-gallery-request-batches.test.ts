import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chunkStyleGalleryRequestItems } from './style-gallery-request-batches';

describe('chunkStyleGalleryRequestItems', () => {
  it('keeps every item in order while removing the user-facing total limit', () => {
    const input = Array.from({ length: 70 }, (_, index) => index);
    const chunks = chunkStyleGalleryRequestItems(input, 32);

    assert.deepEqual(
      chunks.map((chunk) => chunk.length),
      [32, 32, 6],
    );
    assert.deepEqual(chunks.flat(), input);
  });

  it('rejects invalid batch sizes instead of entering an infinite loop', () => {
    assert.throws(() => chunkStyleGalleryRequestItems([1], 0), RangeError);
  });
});
