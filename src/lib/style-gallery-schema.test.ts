import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import type { StoredStyleGalleryItem } from '@/types/style-gallery';
import { mapWithConcurrency } from './map-with-concurrency';
import { assertStyleGalleryItemConsistency, getStyleGalleryItemAssetKeys } from './style-gallery-assets';
import { isAuthorizedStyleGalleryRequest } from './style-gallery-auth';
import {
  getStyleGalleryUploadPartCount,
  getStyleGalleryUploadPartKey,
  isStyleGalleryUploadId,
  MAX_STYLE_GALLERY_UPLOAD_PARTS,
  STYLE_GALLERY_UPLOAD_CHUNK_SIZE,
} from './style-gallery-chunk-upload';
import { getStyleGalleryClientErrorResponse, StyleGalleryClientError } from './style-gallery-errors';
import { getStyleGalleryExampleKey, getStyleGalleryExampleObjectKey } from './style-gallery-example-upload';
import { mergeStyleGalleryExamples, removeStyleGalleryExamples } from './style-gallery-examples';
import { getStyleGalleryPlatform } from './style-gallery-platforms';
import { styleGalleryCatalogSchema, styleGalleryItemSchema, toStyleGalleryCatalogItem } from './style-gallery-schema';

const firstHash = 'a'.repeat(64);
const secondHash = 'b'.repeat(64);

function createItem(): StoredStyleGalleryItem {
  return {
    version: 3,
    slug: '2026-07-13-aaaaaaaaaaaa',
    title: 'Style Prompt aaaaaaaaaaaa',
    date: '2026-07-13T00:00:00.000Z',
    sourceImage: '/api/style-gallery/image/source/aaaaaaaaaaaa.jpg',
    thumbnailImage: '/api/style-gallery/image/thumb/aaaaaaaaaaaa.webp',
    sourceImageAlt: 'Reference image 1',
    prompt: 'Reusable style prompt',
    imageHash: firstHash,
    images: [
      {
        sourceImage: '/api/style-gallery/image/source/aaaaaaaaaaaa.jpg',
        thumbnailImage: '/api/style-gallery/image/thumb/aaaaaaaaaaaa.webp',
        sourceImageAlt: 'Reference image 1',
        imageHash: firstHash,
      },
    ],
    examples: [],
  };
}

describe('style gallery metadata', () => {
  it('validates items and creates searchable catalog entries', () => {
    const item = styleGalleryItemSchema.parse(createItem());
    assertStyleGalleryItemConsistency(item);
    assert.deepEqual(getStyleGalleryItemAssetKeys(item), ['source/aaaaaaaaaaaa.jpg', 'thumb/aaaaaaaaaaaa.webp']);

    const catalogItem = toStyleGalleryCatalogItem(item, 3);
    const catalog = styleGalleryCatalogSchema.parse({
      version: 3,
      updatedAt: '2026-07-13T00:01:00.000Z',
      tags: ['codex-session', 'style-prompt'],
      modelTargets: ['GPT-Image2', 'Nano Banana', 'PixAI', 'Midjourney', 'Flux'],
      items: [catalogItem],
    });
    assert.equal(catalog.items[0].prompt, item.prompt);
    assert.equal(catalog.items[0].exampleCount, 3);
    assert.equal('tags' in catalog.items[0], false);
    assert.deepEqual(catalog.modelTargets, ['GPT-Image2', 'Nano Banana', 'PixAI', 'Midjourney', 'Flux']);
  });

  it('validates multi-image group hashes', () => {
    const item = createItem();
    item.images.push({
      sourceImage: '/api/style-gallery/image/source/bbbbbbbbbbbb.png',
      thumbnailImage: '/api/style-gallery/image/thumb/bbbbbbbbbbbb.webp',
      sourceImageAlt: 'Reference image 2',
      imageHash: secondHash,
    });
    item.imageHash = createHash('sha256').update(`${firstHash}\n${secondHash}`).digest('hex');
    assert.doesNotThrow(() => assertStyleGalleryItemConsistency(item));
  });

  it('rejects mismatched top-level images and hashes', () => {
    const wrongTopLevel = createItem();
    wrongTopLevel.sourceImage = '/api/style-gallery/image/source/bbbbbbbbbbbb.jpg';
    assert.throws(() => assertStyleGalleryItemConsistency(wrongTopLevel), /Top-level image fields/);

    const wrongGroupHash = createItem();
    wrongGroupHash.imageHash = secondHash;
    assert.throws(() => assertStyleGalleryItemConsistency(wrongGroupHash), /Item hash/);
  });

  it('updates and removes generated examples without leaving duplicate identities', () => {
    const gptImage = {
      id: 'example-gpt',
      src: `/api/style-gallery/image/examples/images/${firstHash}.png`,
      alt: 'GPT-Image2 generated example',
      model: 'GPT-Image2',
      uploadedAt: '2026-07-13T00:02:00.000Z',
      imageHash: firstHash,
    };
    const pixaiImage = {
      ...gptImage,
      id: 'example-pixai',
      model: 'PixAI',
    };
    const updatedGptImage = { ...gptImage, note: 'updated metadata' };
    const merged = mergeStyleGalleryExamples([gptImage, pixaiImage, updatedGptImage]);
    assert.deepEqual(merged, [updatedGptImage, pixaiImage]);
    assert.deepEqual(removeStyleGalleryExamples(merged, new Set([pixaiImage.id, 'missing-example'])), [updatedGptImage]);
    const platform = getStyleGalleryPlatform('pixai');
    assert.ok(platform);
    assert.equal(getStyleGalleryExampleKey(firstHash, 'png'), `examples/images/${firstHash}.png`);
    assert.equal(getStyleGalleryExampleKey(firstHash, 'PNG'), `examples/images/${firstHash}.png`);
    assert.equal(getStyleGalleryExampleObjectKey(gptImage), `examples/images/${firstHash}.png`);
    assert.throws(() => getStyleGalleryExampleObjectKey({ ...gptImage, imageHash: secondHash }), /does not match/);
  });

  it('maps concurrent work in input order without exceeding the configured limit', async () => {
    let active = 0;
    let maxActive = 0;
    const results = await mapWithConcurrency([3, 1, 2], 2, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, value));
      active -= 1;
      return value * 2;
    });

    assert.deepEqual(results, [6, 2, 4]);
    assert.equal(maxActive, 2);
    await assert.rejects(() => mapWithConcurrency([], 0, async () => undefined), /positive integer/);
  });
});

describe('style gallery write authorization', () => {
  it('uses the same bearer token check for every protected mutation', () => {
    const previous = process.env.STYLE_GALLERY_UPLOAD_TOKEN;
    process.env.STYLE_GALLERY_UPLOAD_TOKEN = 'test-gallery-token';
    try {
      const authorized = new Request('https://example.test', {
        headers: { authorization: 'Bearer test-gallery-token' },
      });
      const unauthorized = new Request('https://example.test', {
        headers: { authorization: 'Bearer wrong-token' },
      });
      assert.equal(isAuthorizedStyleGalleryRequest(authorized), true);
      assert.equal(isAuthorizedStyleGalleryRequest(unauthorized), false);
      assert.equal(isAuthorizedStyleGalleryRequest(new Request('https://example.test'), 'test-gallery-token'), true);
      assert.equal(isAuthorizedStyleGalleryRequest(new Request('https://example.test'), 123), false);
      assert.equal(getStyleGalleryClientErrorResponse(new StyleGalleryClientError('Missing item', 404))?.status, 404);
      assert.equal(getStyleGalleryClientErrorResponse(new Error('Storage failure')), null);
    } finally {
      if (previous === undefined) delete process.env.STYLE_GALLERY_UPLOAD_TOKEN;
      else process.env.STYLE_GALLERY_UPLOAD_TOKEN = previous;
    }
  });
});

describe('style gallery chunk uploads', () => {
  it('keeps every upload request below the Vercel Function payload limit', () => {
    assert.equal(STYLE_GALLERY_UPLOAD_CHUNK_SIZE, 4 * 1024 * 1024);
    assert.equal(getStyleGalleryUploadPartCount(STYLE_GALLERY_UPLOAD_CHUNK_SIZE), 1);
    assert.equal(getStyleGalleryUploadPartCount(STYLE_GALLERY_UPLOAD_CHUNK_SIZE + 1), 2);
    assert.equal(getStyleGalleryUploadPartCount(12 * 1024 * 1024), MAX_STYLE_GALLERY_UPLOAD_PARTS);
    assert.throws(() => getStyleGalleryUploadPartCount(0), /Invalid style gallery upload size/);
    assert.throws(() => getStyleGalleryUploadPartCount(12 * 1024 * 1024 + 1), /Invalid style gallery upload size/);
  });

  it('uses traversal-safe temporary object keys', () => {
    const uploadId = '019f4f58-103a-7ac1-9f5e-6e27c9712154';
    assert.equal(isStyleGalleryUploadId(uploadId), true);
    assert.equal(getStyleGalleryUploadPartKey(uploadId, 2), 'examples/uploads/019f4f58103a7ac19f5e6e27c9712154/02.part');
    assert.equal(isStyleGalleryUploadId('../metadata/catalog.json'), false);
    assert.throws(() => getStyleGalleryUploadPartKey('../metadata/catalog.json', 0), /Invalid style gallery upload ID/);
    assert.throws(() => getStyleGalleryUploadPartKey(uploadId, MAX_STYLE_GALLERY_UPLOAD_PARTS), /part index/);
  });
});
