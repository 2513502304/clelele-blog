import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { POST } from '../pages/api/style-gallery/examples/[slug]';
import { getStyleGalleryPromptId } from './style-gallery-prompts';

test('example merge replaces forged client geometry with stored image dimensions', async () => {
  const slug = 'dimensions-test';
  const hash = 'a'.repeat(64);
  const prompt = 'Reusable prompt';
  const date = '2026-09-12T00:00:00Z';
  const item = {
    version: 4,
    slug,
    title: 'Dimensions test',
    date,
    imageHash: hash,
    sourceImage: '/api/style-gallery/image/source/aaaaaaaaaaaa.png',
    images: [{ sourceImage: '/api/style-gallery/image/source/aaaaaaaaaaaa.png', imageHash: hash }],
    prompts: [{ id: getStyleGalleryPromptId(prompt), prompt, importedAt: date }],
    examples: [],
  };
  const objects = new Map<string, string>([
    [`items/${slug}.json`, JSON.stringify(item)],
    [
      'metadata/catalog-v5.json',
      JSON.stringify({
        version: 5,
        updatedAt: date,
        modelTargets: ['GPT-Image', 'Nano Banana', 'PixAI', 'Midjourney', 'NovelAI', 'Flux'],
        items: [
          {
            slug,
            title: item.title,
            date,
            imageHash: hash,
            sourceImage: item.sourceImage,
            promptExcerpt: prompt,
            promptCount: 1,
            promptRevision: hash,
            imageCount: 1,
            exampleCount: 0,
          },
        ],
      }),
    ],
    ['examples/index-v2.json', JSON.stringify({ version: 2, updatedAt: date, groups: [] })],
  ]);
  const imageBytes = await sharp({ create: { width: 120, height: 80, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  const env = {
    STYLE_GALLERY_UPLOAD_TOKEN: 'test-token',
    HF_S3_ACCESS_KEY_ID: 'HFAKTEST',
    HF_S3_SECRET_ACCESS_KEY: 'test-secret',
    HF_S3_ENDPOINT: 'https://s3.hf.co/test',
    HF_S3_BUCKET: 'test',
    STYLE_GALLERY_BUCKET_PREFIX: 'gallery',
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  Object.assign(process.env, env);
  let imageReads = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const key = decodeURIComponent(url.pathname.replace('/test/test/gallery/', ''));
    if (key === `examples/images/${hash}.png`) {
      if (init?.method === 'HEAD') return new Response(null);
      imageReads++;
      return new Response(new Uint8Array(imageBytes));
    }
    if (init?.method === 'PUT') {
      objects.set(key, new TextDecoder().decode(init.body as ArrayBuffer));
      return new Response(null, { headers: { etag: '"2"' } });
    }
    const value = objects.get(key);
    return value === undefined ? new Response(null, { status: 404 }) : new Response(value, { headers: { etag: '"1"' } });
  };
  try {
    const request = new Request(`https://example.test/api/style-gallery/examples/${slug}`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'merge',
        examples: [
          {
            id: 'example-one',
            src: `/api/style-gallery/image/examples/images/${hash}.png`,
            alt: 'Example',
            model: 'GPT-Image',
            uploadedAt: date,
            imageHash: hash,
            dimensions: { width: 1, height: 100000 },
          },
        ],
        visualRecords: [
          {
            kind: 'example',
            sourceSlug: slug,
            imageId: 'example-one',
            feature: {
              imageHash: hash,
              perceptualHash: '0'.repeat(16),
              differenceHash: '0'.repeat(16),
              palette: 'A'.repeat(32),
              embedding: Buffer.alloc(384, 1).toString('base64'),
            },
          },
        ],
      }),
    });
    const response = await POST({ params: { slug }, request } as never);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(imageReads, 1);
    assert.deepEqual(JSON.parse(objects.get(`items/${slug}.json`) ?? '').examples[0].dimensions, { width: 120, height: 80 });
    assert.deepEqual(JSON.parse(objects.get('examples/index-v2.json') ?? '').groups[0].examples[0].dimensions, {
      width: 120,
      height: 80,
    });
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
