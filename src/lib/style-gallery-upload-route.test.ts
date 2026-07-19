import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { POST as uploadExample } from '../pages/api/style-gallery/examples/[slug]/upload';
import { STYLE_GALLERY_UPLOAD_CHUNK_SIZE } from './style-gallery-chunk-upload';

const slug = 'test-style-item';
const token = 'test-upload-token';
const objectPrefix = '/clelele0722/raw-datasets/image-style-prompt-gallery/';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function createCatalog(): string {
  return JSON.stringify({
    version: 3,
    updatedAt: '2026-07-19T00:00:00.000Z',
    tags: ['style-prompt'],
    modelTargets: ['GPT-Image2'],
    items: [
      {
        slug,
        title: 'Style Prompt test',
        date: '2026-07-19T00:00:00.000Z',
        sourceImage: '/api/style-gallery/image/source/aaaaaaaaaaaa.jpg',
        prompt: 'Reusable style prompt',
        imageHash: 'a'.repeat(64),
        imageCount: 1,
        exampleCount: 0,
      },
    ],
  });
}

function toBytes(body: BodyInit | null | undefined): Uint8Array {
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  throw new TypeError('Unexpected mock S3 request body.');
}

async function callUpload(url: URL, body: BodyInit, contentType: string): Promise<Response> {
  const request = new Request(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
    body,
  });
  return uploadExample({ params: { slug }, request, url } as never);
}

describe('style gallery upload route', () => {
  it('assembles a file above Vercel payload size from independently verified parts', async () => {
    const previousEnv = {
      token: process.env.STYLE_GALLERY_UPLOAD_TOKEN,
      accessKey: process.env.HF_S3_ACCESS_KEY_ID,
      secretKey: process.env.HF_S3_SECRET_ACCESS_KEY,
      endpoint: process.env.HF_S3_ENDPOINT,
      bucket: process.env.HF_S3_BUCKET,
      prefix: process.env.STYLE_GALLERY_BUCKET_PREFIX,
    };
    const previousFetch = globalThis.fetch;
    const objects = new Map<string, Uint8Array>();
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
      if (method === 'GET' && key === 'metadata/catalog.json') return new Response(createCatalog());
      if (method === 'PUT') {
        objects.set(key, toBytes(init?.body).slice());
        return new Response(null, { status: 200 });
      }
      if (method === 'HEAD') return new Response(null, { status: objects.has(key) ? 200 : 404 });
      if (method === 'GET') {
        const bytes = objects.get(key);
        if (!bytes) return new Response(null, { status: 404 });
        const body = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(body).set(bytes);
        return new Response(body);
      }
      if (method === 'DELETE') {
        objects.delete(key);
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 405 });
    };

    try {
      const image = new Uint8Array(4_495_816);
      for (let index = 0; index < image.length; index += 1) image[index] = index % 251;
      const uploadId = '019f4f58-103a-7ac1-9f5e-6e27c9712154';
      const parts = [image.slice(0, STYLE_GALLERY_UPLOAD_CHUNK_SIZE), image.slice(STYLE_GALLERY_UPLOAD_CHUNK_SIZE)];

      for (const [index, part] of parts.entries()) {
        const url = new URL(`https://example.test/api/style-gallery/examples/${slug}/upload`);
        url.search = new URLSearchParams({
          platform: 'gpt-image2',
          action: 'chunk',
          uploadId,
          partIndex: index.toString(),
          partCount: parts.length.toString(),
          chunkHash: sha256(part),
        }).toString();
        const response = await callUpload(url, part, 'application/octet-stream');
        assert.equal(response.status, 200, await response.text());
      }

      const completeUrl = new URL(`https://example.test/api/style-gallery/examples/${slug}/upload?platform=gpt-image2`);
      const imageHash = sha256(image);
      const completeResponse = await callUpload(
        completeUrl,
        JSON.stringify({
          action: 'complete',
          uploadId,
          imageHash,
          extension: 'webp',
          contentType: 'image/webp',
          size: image.length,
          parts: parts.map((part, index) => ({ index, size: part.length, hash: sha256(part) })),
        }),
        'application/json',
      );

      assert.equal(completeResponse.status, 200, await completeResponse.text());
      assert.deepEqual(objects.get(`examples/images/${imageHash}.webp`), image);
      assert.equal(
        [...objects.keys()].some((key) => key.startsWith('examples/uploads/')),
        false,
      );
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
