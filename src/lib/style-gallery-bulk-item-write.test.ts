import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import type { StoredStyleGalleryItem, StyleGalleryExample } from '@/types/style-gallery';
import { POST as writeItems } from '../pages/api/style-gallery/items';

const token = 'test-upload-token';
const objectPrefix = '/clelele0722/raw-datasets/image-style-prompt-gallery/';

function createItem(index: number): StoredStyleGalleryItem {
  const imageHash = `${index.toString(16).padStart(12, '0')}${'0'.repeat(52)}`;
  const shortHash = imageHash.slice(0, 12);
  const prompt = `[subject] reusable prompt ${index}`;
  return {
    version: 4,
    slug: `2026-08-03-${shortHash}`,
    title: `Style Prompt ${shortHash}`,
    date: '2026-08-03T00:00:00.000Z',
    sourceImage: `/api/style-gallery/image/source/${shortHash}.jpg`,
    thumbnailImage: `/api/style-gallery/image/thumb/${shortHash}.webp`,
    sourceImageAlt: `Reference ${index}`,
    prompts: [
      {
        id: createHash('sha256').update(prompt).digest('hex'),
        prompt,
        model: 'gpt-test',
        importedAt: '2026-08-03T00:00:00.000Z',
        sourceSession: 'test-session.jsonl',
        sourceLine: index,
      },
    ],
    imageHash,
    images: [
      {
        sourceImage: `/api/style-gallery/image/source/${shortHash}.jpg`,
        thumbnailImage: `/api/style-gallery/image/thumb/${shortHash}.webp`,
        sourceImageAlt: `Reference ${index}`,
        imageHash,
      },
    ],
    examples: [],
  };
}

function bodyText(body: BodyInit | null | undefined): string {
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
  throw new TypeError('Unexpected mock S3 request body.');
}

describe('style gallery bulk item writes', () => {
  it('writes item objects concurrently while committing catalog once and leaving the example index untouched', async () => {
    const previousEnv = {
      token: process.env.STYLE_GALLERY_UPLOAD_TOKEN,
      accessKey: process.env.HF_S3_ACCESS_KEY_ID,
      secretKey: process.env.HF_S3_SECRET_ACCESS_KEY,
      endpoint: process.env.HF_S3_ENDPOINT,
      bucket: process.env.HF_S3_BUCKET,
      prefix: process.env.STYLE_GALLERY_BUCKET_PREFIX,
    };
    const previousFetch = globalThis.fetch;
    const objects = new Map<string, string>([
      [
        'metadata/catalog.json',
        JSON.stringify({
          version: 3,
          updatedAt: '2026-08-03T00:00:00.000Z',
          tags: ['codex-session', 'style-prompt'],
          modelTargets: ['GPT-Image2', 'Nano Banana', 'PixAI', 'Midjourney', 'Flux'],
          items: [],
        }),
      ],
    ]);
    const objectVersions = new Map<string, number>([['metadata/catalog.json', 1]]);
    const concurrentExample: StyleGalleryExample = {
      id: 'concurrent-example',
      src: '/api/style-gallery/image/examples/images/concurrent-example.webp',
      alt: 'Concurrent example',
      model: 'PixAI',
      uploadedAt: '2026-08-03T00:01:00.000Z',
      imageHash: 'f'.repeat(64),
    };
    let injectedItemConflict = false;
    let activeItemPuts = 0;
    let maxConcurrentItemPuts = 0;
    let catalogPutCount = 0;
    let exampleIndexPutCount = 0;
    process.env.STYLE_GALLERY_UPLOAD_TOKEN = token;
    process.env.HF_S3_ACCESS_KEY_ID = 'HFAKTEST';
    process.env.HF_S3_SECRET_ACCESS_KEY = 'test-secret';
    process.env.HF_S3_ENDPOINT = 'https://s3.hf.co/clelele0722';
    process.env.HF_S3_BUCKET = 'raw-datasets';
    process.env.STYLE_GALLERY_BUCKET_PREFIX = 'image-style-prompt-gallery';

    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      const key = decodeURIComponent(url.pathname.slice(objectPrefix.length));
      const method = init?.method ?? 'GET';
      if (method === 'HEAD') {
        return new Response(null, { status: 200, headers: { etag: `"${objectVersions.get(key) ?? 1}"` } });
      }
      if (method === 'GET') {
        const value = objects.get(key);
        return value === undefined
          ? new Response(null, { status: 404 })
          : new Response(value, { headers: { etag: `"${objectVersions.get(key) ?? 1}"` } });
      }
      if (method === 'PUT') {
        if (key.startsWith('items/')) {
          activeItemPuts += 1;
          maxConcurrentItemPuts = Math.max(maxConcurrentItemPuts, activeItemPuts);
          await new Promise((resolve) => setTimeout(resolve, 10));
          activeItemPuts -= 1;
          if (!injectedItemConflict) {
            const concurrentlyUpdatedItem = JSON.parse(bodyText(init?.body)) as StoredStyleGalleryItem;
            objects.set(key, JSON.stringify({ ...concurrentlyUpdatedItem, examples: [concurrentExample] }));
            objectVersions.set(key, 1);
            injectedItemConflict = true;
            return new Response(null, { status: 412 });
          }
        }
        const requestHeaders = new Headers(init?.headers);
        const currentValue = objects.get(key);
        const currentEtag = currentValue === undefined ? null : `"${objectVersions.get(key) ?? 1}"`;
        if (requestHeaders.get('if-none-match') === '*' && currentValue !== undefined) {
          return new Response(null, { status: 412 });
        }
        if (requestHeaders.has('if-match') && requestHeaders.get('if-match') !== currentEtag) {
          return new Response(null, { status: 412 });
        }
        if (key === 'metadata/catalog.json') catalogPutCount += 1;
        if (key === 'examples/index-v2.json') exampleIndexPutCount += 1;
        objects.set(key, bodyText(init?.body));
        const version = (objectVersions.get(key) ?? 0) + 1;
        objectVersions.set(key, version);
        return new Response(null, { status: 200, headers: { etag: `"${version}"` } });
      }
      if (method === 'DELETE') {
        objects.delete(key);
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 405 });
    };

    try {
      const items = Array.from({ length: 12 }, (_, index) => createItem(index + 1));
      const request = new Request('https://example.test/api/style-gallery/items', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'create', items }),
      });
      const response = await writeItems({ request } as never);
      const responseBody = await response.text();
      assert.equal(response.status, 200, responseBody);
      assert.equal(JSON.parse(responseBody).written, items.length);
      assert.ok(maxConcurrentItemPuts > 1);
      assert.equal(catalogPutCount, 1);
      assert.equal(exampleIndexPutCount, 0);
      assert.equal(JSON.parse(objects.get('metadata/catalog.json') ?? '{}').items.length, items.length);
      const savedItems = [...objects.entries()]
        .filter(([key]) => key.startsWith('items/'))
        .map(([, value]) => JSON.parse(value) as StoredStyleGalleryItem);
      assert.ok(savedItems.some((item) => item.examples.some((example) => example.id === concurrentExample.id)));

      const alternatePrompt = '[subject] alternate extraction from another model';
      const alternateItem: StoredStyleGalleryItem = {
        ...items[0],
        prompts: [
          {
            id: createHash('sha256').update(alternatePrompt).digest('hex'),
            prompt: alternatePrompt,
            model: 'gpt-5.6-terra',
            importedAt: '2026-08-03T01:00:00.000Z',
          },
        ],
      };
      const appendRequest = new Request('https://example.test/api/style-gallery/items', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'create', items: [alternateItem] }),
      });
      const appendResponse = await writeItems({ request: appendRequest } as never);
      assert.equal(appendResponse.status, 200);
      assert.deepEqual(await appendResponse.json(), {
        items: [
          {
            ...JSON.parse(objects.get(`items/${items[0].slug}.json`) ?? '{}'),
          },
        ],
        written: 1,
        created: 0,
        updated: 1,
        addedPrompts: 1,
        skippedDuplicates: 0,
      });
      const appendedItem = JSON.parse(objects.get(`items/${items[0].slug}.json`) ?? '{}') as StoredStyleGalleryItem;
      assert.equal(appendedItem.prompts.length, 2);
      assert.equal(appendedItem.prompts[0].prompt, items[0].prompts[0].prompt);
      assert.equal(appendedItem.prompts[1].prompt, alternatePrompt);
      assert.ok(appendedItem.examples.some((example) => example.id === concurrentExample.id));
      assert.equal(catalogPutCount, 2);

      const duplicateRequest = new Request('https://example.test/api/style-gallery/items', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'create', items: [alternateItem] }),
      });
      const duplicateResponse = await writeItems({ request: duplicateRequest } as never);
      assert.equal(duplicateResponse.status, 200);
      const duplicateResult = await duplicateResponse.json();
      assert.equal(duplicateResult.written, 0);
      assert.equal(duplicateResult.addedPrompts, 0);
      assert.equal(duplicateResult.skippedDuplicates, 1);
      assert.equal(catalogPutCount, 2);
    } finally {
      globalThis.fetch = previousFetch;
      for (const [name, value] of Object.entries({
        STYLE_GALLERY_UPLOAD_TOKEN: previousEnv.token,
        HF_S3_ACCESS_KEY_ID: previousEnv.accessKey,
        HF_S3_SECRET_ACCESS_KEY: previousEnv.secretKey,
        HF_S3_ENDPOINT: previousEnv.endpoint,
        HF_S3_BUCKET: previousEnv.bucket,
        STYLE_GALLERY_BUCKET_PREFIX: previousEnv.prefix,
      })) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
