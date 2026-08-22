import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeDifferenceHash,
  computeDominantPalette,
  computePerceptualHash,
  convertInterleavedRgbToGrayscale,
  createStyleGalleryVisualFeature,
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

  it('uses one grayscale formula across browser RGBA and Node RGB samples', () => {
    const rgb = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255]);
    const rgba = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0]);
    assert.deepEqual([...convertInterleavedRgbToGrayscale(rgb, 3)], [76, 150, 29]);
    assert.deepEqual([...convertInterleavedRgbToGrayscale(rgba, 4)], [...convertInterleavedRgbToGrayscale(rgb, 3)]);
    assert.throws(() => convertInterleavedRgbToGrayscale(Uint8Array.of(1, 2), 2), /invalid channel layout/);
  });

  it('keeps the pHash fixture stable and reports small changes through Hamming distance', () => {
    assert.equal(computePerceptualHash(new Uint8Array(32 * 32)), 'ffffffffffffffff');
    const gradient = Uint8Array.from({ length: 32 * 32 }, (_, index) => (index * 17 + Math.floor(index / 32) * 11) % 256);
    const altered = gradient.slice();
    altered[200] = 255 - altered[200];
    const hash = computePerceptualHash(gradient);
    const alteredHash = computePerceptualHash(altered);
    assert.equal(hash, '9755755500aa2ffa');
    assert.ok(hammingDistance(hash, alteredHash) <= 8);
  });

  it('rejects invalid feature identities and raster dimensions before persistence', () => {
    const samples = {
      gray32: new Uint8Array(32 * 32),
      gray9x8: new Uint8Array(9 * 8),
      rgb64: new Uint8Array(64 * 64 * 3),
    };
    const embedding = new Float32Array(STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION);
    embedding[0] = 1;
    assert.throws(() => createStyleGalleryVisualFeature('not-a-sha', samples, embedding), /SHA-256/);
    assert.throws(
      () => createStyleGalleryVisualFeature('a'.repeat(64), { ...samples, gray32: new Uint8Array(1) }, embedding),
      /32x32/,
    );
  });
});
