import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import type { StoredStyleGalleryItem, StyleGalleryExampleIndex } from '@/types/style-gallery';
import { PATCH as updatePlatform } from '../pages/api/style-gallery/examples/[slug]';

const slug = 'platform-update-item';
const token = 'test-upload-token';
const objectPrefix = '/clelele0722/raw-datasets/image-style-prompt-gallery/';
const firstHash = 'a'.repeat(64);
const secondHash = 'b'.repeat(64);

function createItem(): StoredStyleGalleryItem {
  const prompt = 'Reusable style prompt';
  return {
    version: 4,
    slug,
    title: 'Style Prompt platform update',
    date: '2026-08-04T00:00:00.000Z',
    sourceImage: '/api/style-gallery/image/source/aaaaaaaaaaaa.jpg',
    prompts: [
      {
        id: createHash('sha256').update(prompt).digest('hex'),
        prompt,
        importedAt: '2026-07-13T00:00:00.000Z',
      },
    ],
    imageHash: firstHash,
    images: [
      {
        sourceImage: '/api/style-gallery/image/source/aaaaaaaaaaaa.jpg',
        imageHash: firstHash,
      },
    ],
    examples: [
      {
        id: 'first-example',
        src: `/api/style-gallery/image/examples/images/${firstHash}.webp`,
        alt: 'First GPT-Image2 example',
        model: 'GPT-Image2',
        uploadedAt: '2026-08-04T00:01:00.000Z',
        imageHash: firstHash,
      },
      {
        id: 'second-example',
        src: `/api/style-gallery/image/examples/images/${secondHash}.webp`,
        alt: 'Second Nano Banana example',
        model: 'Nano Banana',
        uploadedAt: '2026-08-04T00:02:00.000Z',
        imageHash: secondHash,
      },
    ],
  };
}

function createIndex(): StyleGalleryExampleIndex {
  return {
    version: 2,
    updatedAt: '2026-08-04T00:02:00.000Z',
    groups: [
      {
        sourceSlug: slug,
        examples: [
          {
            id: 'first-example',
            src: `/api/style-gallery/image/examples/images/${firstHash}.webp`,
            model: 'GPT-Image2',
            uploadedAt: '2026-08-04T00:01:00.000Z',
            likedBy: [2513502304],
          },
          {
            id: 'second-example',
            src: `/api/style-gallery/image/examples/images/${secondHash}.webp`,
            model: 'Nano Banana',
            uploadedAt: '2026-08-04T00:02:00.000Z',
            likedBy: [],
          },
        ],
      },
    ],
  };
}

function bodyText(body: BodyInit | null | undefined): string {
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
  throw new TypeError('Unexpected mock S3 request body.');
}

describe('style gallery platform updates', () => {
  it('updates item and example index once without reading or rewriting catalog', async () => {
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
      [`items/${slug}.json`, JSON.stringify(createItem())],
      ['examples/index-v2.json', JSON.stringify(createIndex())],
    ]);
    const reads = new Map<string, number>();
    const writes = new Map<string, number>();
    const versions = new Map<string, number>([
      [`items/${slug}.json`, 1],
      ['examples/index-v2.json', 1],
    ]);
    let injectConcurrentPrompt = true;
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
      if (method === 'GET') {
        reads.set(key, (reads.get(key) ?? 0) + 1);
        const value = objects.get(key);
        return value === undefined
          ? new Response(null, { status: 404 })
          : new Response(value, { headers: { etag: `"${versions.get(key) ?? 1}"` } });
      }
      if (method === 'PUT') {
        if (key === `items/${slug}.json` && injectConcurrentPrompt) {
          injectConcurrentPrompt = false;
          const current = JSON.parse(objects.get(key) ?? '') as StoredStyleGalleryItem;
          const concurrentPrompt = 'Concurrent prompt variant';
          objects.set(
            key,
            JSON.stringify({
              ...current,
              prompts: [
                ...current.prompts,
                {
                  id: createHash('sha256').update(concurrentPrompt).digest('hex'),
                  prompt: concurrentPrompt,
                  importedAt: '2026-08-04T00:03:00.000Z',
                },
              ],
            }),
          );
          versions.set(key, (versions.get(key) ?? 1) + 1);
          return new Response(null, { status: 412 });
        }
        const expected = new Headers(init?.headers).get('if-match');
        if (expected && expected !== `"${versions.get(key) ?? 1}"`) return new Response(null, { status: 412 });
        writes.set(key, (writes.get(key) ?? 0) + 1);
        objects.set(key, bodyText(init?.body));
        const version = (versions.get(key) ?? 0) + 1;
        versions.set(key, version);
        return new Response(null, { status: 200, headers: { etag: `"${version}"` } });
      }
      return new Response(null, { status: 405 });
    };

    try {
      const request = new Request(`https://example.test/api/style-gallery/examples/${slug}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ids: ['first-example'], platform: 'pixai' }),
      });
      const response = await updatePlatform({ params: { slug }, request } as never);
      assert.equal(response.status, 200, await response.text());

      const item = JSON.parse(objects.get(`items/${slug}.json`) ?? '') as StoredStyleGalleryItem;
      const index = JSON.parse(objects.get('examples/index-v2.json') ?? '') as StyleGalleryExampleIndex;
      assert.equal(item.examples[0].model, 'PixAI');
      assert.equal(item.prompts[1].prompt, 'Concurrent prompt variant');
      assert.equal(index.groups[0].examples[0].model, 'PixAI');
      assert.deepEqual(index.groups[0].examples[0].likedBy, [2513502304]);
      assert.equal(reads.get(`items/${slug}.json`), 2);
      assert.equal(reads.get('examples/index-v2.json'), 1);
      assert.equal(reads.get('metadata/catalog.json') ?? 0, 0);
      assert.equal(writes.get(`items/${slug}.json`), 1);
      assert.equal(writes.get('examples/index-v2.json'), 1);
      assert.equal(writes.get('metadata/catalog.json') ?? 0, 0);
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
