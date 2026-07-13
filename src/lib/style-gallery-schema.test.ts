import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import type { StoredStyleGalleryItem } from '@/types/style-gallery';
import { assertStyleGalleryItemConsistency, getStyleGalleryItemAssetKeys } from './style-gallery-assets';
import { isAuthorizedStyleGalleryRequest } from './style-gallery-auth';
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
    assert.deepEqual(mergeStyleGalleryExamples([gptImage, pixaiImage]), [gptImage, pixaiImage]);
    assert.deepEqual(removeStyleGalleryExamples([pixaiImage], new Set([pixaiImage.id])), []);
    const platform = getStyleGalleryPlatform('pixai');
    assert.ok(platform);
    assert.equal(getStyleGalleryExampleKey(firstHash, 'png'), `examples/images/${firstHash}.png`);
    assert.equal(getStyleGalleryExampleObjectKey(gptImage), `examples/images/${firstHash}.png`);
    assert.throws(() => getStyleGalleryExampleObjectKey({ ...gptImage, imageHash: secondHash }), /does not match/);
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
    } finally {
      if (previous === undefined) delete process.env.STYLE_GALLERY_UPLOAD_TOKEN;
      else process.env.STYLE_GALLERY_UPLOAD_TOKEN = previous;
    }
  });
});
