import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeDifferenceHash,
  computeDominantPalette,
  decodePalette,
  decodeQuantizedEmbedding,
  encodePalette,
  encodeQuantizedEmbedding,
  hammingDistance,
} from './style-gallery-visual-feature';
import { STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION } from './style-gallery-visual-types';

describe('style gallery visual feature encoding', () => {
  it('keeps hashes, palettes, and embeddings fixed-width and deterministic', () => {
    const gradient = Uint8Array.from({ length: 9 * 8 }, (_, index) => index % 9);
    assert.equal(computeDifferenceHash(gradient), '0000000000000000');
    assert.equal(hammingDistance('0000000000000000', 'ffffffffffffffff'), 64);

    const rgb = new Uint8Array(64 * 64 * 3);
    for (let index = 0; index < rgb.length; index += 3) {
      rgb[index] = 240;
      rgb[index + 1] = 32;
      rgb[index + 2] = 64;
    }
    const palette = computeDominantPalette(rgb);
    const encodedPalette = encodePalette(palette);
    assert.equal(encodedPalette.length, 32);
    assert.deepEqual(decodePalette(encodedPalette)[0], [240, 32, 64, 255]);

    const embedding = new Float32Array(STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION);
    embedding[0] = 3;
    embedding[1] = 4;
    const encodedEmbedding = encodeQuantizedEmbedding(embedding);
    assert.equal(encodedEmbedding.length, 512);
    assert.deepEqual([...decodeQuantizedEmbedding(encodedEmbedding).slice(0, 3)], [76, 102, 0]);
  });

  it('rejects malformed fixed-width payloads before they reach the HF index', () => {
    assert.throws(() => decodePalette('AAAA'), /invalid encoding/);
    assert.throws(() => decodeQuantizedEmbedding('AAAA'), /invalid encoding/);
    assert.throws(
      () => encodeQuantizedEmbedding(new Float32Array(STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION)),
      /non-zero finite vector/,
    );
  });
});
