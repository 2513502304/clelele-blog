import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { computeStyleGalleryVisualFeatureFromBytes } from '../src/lib/style-gallery-visual-feature-node';
import { STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION } from '../src/lib/style-gallery-visual-types';

// Synthetic pixels only: no user images, storage writes, or provider API calls.
const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#4060a0' } })
  .png()
  .toBuffer();
const feature = await computeStyleGalleryVisualFeatureFromBytes(bytes, createHash('sha256').update(bytes).digest('hex'));
assert.ok(feature);
assert.equal(Buffer.from(feature.embedding, 'base64').length, STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION);
console.log(JSON.stringify({ nativeSharp: true, nativeVisualEmbedding: true }));
