import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import type { StoredStyleGalleryItem } from '@/types/style-gallery';
import { mapWithConcurrency } from './map-with-concurrency';
import { toStyleGalleryCardDataList } from './style-gallery';
import { assertStyleGalleryItemConsistency, getStyleGalleryItemAssetKeys } from './style-gallery-assets';
import { isAuthorizedStyleGalleryRequest } from './style-gallery-auth';
import {
  getStyleGalleryUploadPartCount,
  getStyleGalleryUploadPartKey,
  isStyleGalleryUploadId,
  MAX_STYLE_GALLERY_UPLOAD_PARTS,
  STYLE_GALLERY_DIRECT_UPLOAD_MAX_SIZE,
  STYLE_GALLERY_UPLOAD_CHUNK_SIZE,
} from './style-gallery-chunk-upload';
import { getStyleGalleryClientErrorResponse, StyleGalleryClientError } from './style-gallery-errors';
import { getStyleGalleryExampleKey, getStyleGalleryExampleObjectKey } from './style-gallery-example-upload';
import {
  appendUniqueStyleGalleryExamples,
  mergeStyleGalleryExamples,
  removeStyleGalleryExamples,
  toStyleGalleryExampleIndexGroup,
} from './style-gallery-examples';
import { getStyleGalleryExampleContentType, getStyleGalleryExampleExtension } from './style-gallery-image-type';
import { getStyleGalleryPlatform } from './style-gallery-platforms';
import {
  getStyleGalleryPromptId,
  getStyleGalleryPromptRevision,
  mergeStyleGalleryPromptVariants,
} from './style-gallery-prompts';
import {
  styleGalleryCatalogSchema,
  styleGalleryExampleIndexSchema,
  styleGalleryItemSchema,
  toStyleGalleryCatalogItem,
} from './style-gallery-schema';

const firstHash = 'a'.repeat(64);
const secondHash = 'b'.repeat(64);

function createItem(): StoredStyleGalleryItem {
  const prompt = 'Reusable style prompt';
  return {
    version: 4,
    slug: '2026-07-13-aaaaaaaaaaaa',
    title: 'Style Prompt aaaaaaaaaaaa',
    date: '2026-07-13T00:00:00.000Z',
    sourceImage: '/api/style-gallery/image/source/aaaaaaaaaaaa.jpg',
    thumbnailImage: '/api/style-gallery/image/thumb/aaaaaaaaaaaa.webp',
    sourceImageAlt: 'Reference image 1',
    prompts: [
      {
        id: getStyleGalleryPromptId(prompt),
        prompt,
        model: 'gpt-5.6-sol',
        importedAt: '2026-07-13T00:00:00.000Z',
      },
    ],
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
      modelTargets: ['GPT-Image', 'Nano Banana', 'PixAI', 'Midjourney', 'NovelAI', 'Flux'],
      items: [catalogItem],
    });
    assert.equal(catalog.items[0].prompt, item.prompts[0].prompt);
    assert.deepEqual(catalog.items[0].additionalPrompts, []);
    assert.equal(catalog.items[0].promptCount, 1);
    assert.equal(catalog.items[0].promptRevision, getStyleGalleryPromptRevision(item.prompts));
    assert.equal(catalog.version, 4);
    assert.equal(catalog.items[0].exampleCount, 3);
    assert.equal('tags' in catalog.items[0], false);
    assert.deepEqual(catalog.modelTargets, ['GPT-Image', 'Nano Banana', 'PixAI', 'Midjourney', 'NovelAI', 'Flux']);

    const [card] = toStyleGalleryCardDataList({ ...catalog, parentLikeCounts: { [item.slug]: 4 } });
    assert.equal(card.likeCount, 4);
    assert.equal('tags' in card, false);
    assert.equal('modelTargets' in card, false);
  });

  it('keeps secondary prompt text in catalog search data without duplicating detail metadata', () => {
    const item = createItem();
    const secondPrompt = 'Second prompt from the same model';
    item.prompts.push({
      id: getStyleGalleryPromptId(secondPrompt),
      prompt: secondPrompt,
      model: 'gpt-5.6-sol',
      importedAt: '2026-07-14T00:00:00.000Z',
    });
    const catalogItem = toStyleGalleryCatalogItem(item);
    assert.equal(catalogItem.prompt, item.prompts[0].prompt);
    assert.deepEqual(catalogItem.additionalPrompts, [secondPrompt]);
    assert.equal(catalogItem.promptCount, 2);
    assert.equal(catalogItem.promptRevision, getStyleGalleryPromptRevision(item.prompts));
    assert.equal('model' in catalogItem, false);
    assert.equal('sourceSession' in catalogItem, false);
  });

  it('changes prompt revision when source metadata changes without changing prompt count', () => {
    const item = createItem();
    const firstRevision = toStyleGalleryCatalogItem(item).promptRevision;
    item.prompts[0] = { ...item.prompts[0], model: 'gpt-5.6-terra' };
    assert.notEqual(toStyleGalleryCatalogItem(item).promptRevision, firstRevision);
  });

  it('rejects inconsistent or duplicated catalog prompt metadata', () => {
    const catalogItem = toStyleGalleryCatalogItem(createItem());
    const catalog = {
      version: 4,
      updatedAt: '2026-07-13T00:01:00.000Z',
      tags: ['codex-session', 'style-prompt'],
      modelTargets: ['GPT-Image', 'Nano Banana', 'PixAI', 'Midjourney', 'NovelAI', 'Flux'],
      items: [catalogItem],
    };

    assert.throws(
      () => styleGalleryCatalogSchema.parse({ ...catalog, items: [{ ...catalogItem, promptCount: 2 }] }),
      /Prompt count does not match/,
    );
    assert.throws(
      () =>
        styleGalleryCatalogSchema.parse({
          ...catalog,
          items: [{ ...catalogItem, promptCount: 2, additionalPrompts: [`  ${catalogItem.prompt}\r\n`] }],
        }),
      /Duplicate prompt text/,
    );
  });

  it('normalizes legacy items and appends only distinct prompt variants', () => {
    const current = createItem();
    const { prompts: _prompts, ...legacyFields } = current;
    const legacy = styleGalleryItemSchema.parse({
      ...legacyFields,
      version: 3,
      prompt: 'Reusable style prompt',
      originalPrompt: 'Extract this image style.',
      sourceSession: 'legacy-session.jsonl',
      sourceLine: 12,
    });
    assert.equal(legacy.version, 4);
    assert.equal(legacy.prompts.length, 1);
    assert.equal(legacy.prompts[0].originalPrompt, 'Extract this image style.');

    const differentPrompt = 'A second reusable style prompt';
    const incoming = [
      {
        id: getStyleGalleryPromptId(differentPrompt),
        prompt: differentPrompt,
        model: 'gpt-5.6-terra',
        importedAt: '2026-07-14T00:00:00.000Z',
      },
      { ...legacy.prompts[0], model: 'gpt-5.6-sol' },
    ];
    const merged = mergeStyleGalleryPromptVariants(legacy.prompts, incoming);
    assert.equal(merged.added, 1);
    assert.equal(merged.skipped, 1);
    assert.equal(merged.prompts[0].prompt, 'Reusable style prompt');
    assert.equal(merged.prompts[1].model, 'gpt-5.6-terra');
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
      alt: 'GPT-Image generated example',
      model: 'GPT-Image',
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

    const group = toStyleGalleryExampleIndexGroup('source-item', [updatedGptImage, pixaiImage], {
      sourceSlug: 'source-item',
      examples: [{ id: gptImage.id, src: gptImage.src, model: gptImage.model, uploadedAt: gptImage.uploadedAt, likedBy: [7] }],
    });
    assert.deepEqual(
      group.examples.map((example) => example.likedBy),
      [[7], []],
    );
    assert.equal(
      styleGalleryExampleIndexSchema.parse({ version: 2, updatedAt: gptImage.uploadedAt, groups: [group] }).version,
      2,
    );

    assert.deepEqual(appendUniqueStyleGalleryExamples([gptImage], [{ ...gptImage, id: 'replacement' }]), [gptImage]);
  });

  it('rejects legacy or unknown generated-image platform labels at persistence boundaries', () => {
    const item = createItem();
    item.examples = [
      {
        id: 'legacy-platform-example',
        src: `/api/style-gallery/image/examples/images/${firstHash}.png`,
        alt: 'Legacy platform example',
        model: 'GPT-Image2',
        uploadedAt: '2026-07-13T00:02:00.000Z',
        imageHash: firstHash,
      },
    ];
    assert.throws(() => styleGalleryItemSchema.parse(item), /Invalid enum value/);
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
  it('directs small files and keeps every large-file part below the Vercel Function payload limit', () => {
    assert.equal(STYLE_GALLERY_DIRECT_UPLOAD_MAX_SIZE, 4.25 * 1024 * 1024);
    assert.equal(STYLE_GALLERY_UPLOAD_CHUNK_SIZE, STYLE_GALLERY_DIRECT_UPLOAD_MAX_SIZE);
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

describe('style gallery image types', () => {
  it('uses one canonical MIME mapping for prepared extensions and direct uploads', () => {
    assert.equal(getStyleGalleryExampleExtension('', 'example.jpeg'), 'jpg');
    assert.equal(getStyleGalleryExampleContentType('jpg'), 'image/jpeg');
    assert.equal(getStyleGalleryExampleContentType('png'), 'image/png');
    assert.throws(() => getStyleGalleryExampleContentType('gif'), /Unsupported image extension/);
  });
});
