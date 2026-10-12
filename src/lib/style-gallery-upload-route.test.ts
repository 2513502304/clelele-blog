import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import { POST as uploadExample } from '../pages/api/style-gallery/examples/[slug]/upload';
import { POST as uploadSource } from '../pages/api/style-gallery/source-upload';
import {
  getStyleGalleryUploadPartKey,
  MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE,
  MAX_STYLE_GALLERY_UPLOAD_PARTS,
  STYLE_GALLERY_DIRECT_UPLOAD_MAX_SIZE,
  STYLE_GALLERY_UPLOAD_CHUNK_SIZE,
} from './style-gallery-chunk-upload';

const slug = 'test-style-item';
const token = 'test-upload-token';
const objectPrefix = '/clelele0722/raw-datasets/image-style-prompt-gallery/';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function createCatalog(): string {
  return JSON.stringify({
    version: 5,
    updatedAt: '2026-07-19T00:00:00.000Z',
    tags: ['style-prompt'],
    modelTargets: ['GPT-Image', 'Nano Banana', 'PixAI', 'Midjourney', 'NovelAI', 'Flux'],
    items: [
      {
        slug,
        title: 'Style Prompt test',
        date: '2026-07-19T00:00:00.000Z',
        sourceImage: '/api/style-gallery/image/source/aaaaaaaaaaaa.jpg',
        promptExcerpt: 'Reusable style prompt',
        promptCount: 1,
        promptRevision: 'c'.repeat(64),
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
  if (url.pathname.endsWith('/source-upload')) return uploadSource({ request, url } as never);
  return uploadExample({ params: { slug }, request, url } as never);
}

describe('style gallery upload route', () => {
  it('preserves originals above 12 MiB with bounded downloads, verified parts, and a 64 MiB ceiling', async () => {
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
    let activePartDownloads = 0;
    let maxPartDownloads = 0;
    let partDownloadCount = 0;
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
      if (method === 'GET' && key === 'metadata/catalog-v5.json') return new Response(createCatalog());
      if (method === 'PUT') {
        objects.set(key, toBytes(init?.body).slice());
        return new Response(null, { status: 200 });
      }
      if (method === 'HEAD') return new Response(null, { status: objects.has(key) ? 200 : 404 });
      if (method === 'GET') {
        const bytes = objects.get(key);
        if (!bytes) return new Response(null, { status: 404 });
        if (key.startsWith('examples/uploads/')) {
          activePartDownloads += 1;
          partDownloadCount += 1;
          maxPartDownloads = Math.max(maxPartDownloads, activePartDownloads);
          // Let every available worker begin its download before completing the first wave.
          await new Promise<void>((resolve) => setImmediate(resolve));
          activePartDownloads -= 1;
        }
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
      const directImage = new Uint8Array(1024);
      for (let index = 0; index < directImage.length; index += 1) directImage[index] = index % 251;
      const directHash = sha256(directImage);
      const directUrl = new URL(`https://example.test/api/style-gallery/examples/${slug}/upload`);
      directUrl.search = new URLSearchParams({
        platform: 'gpt-image',
        action: 'direct',
        imageHash: directHash,
      }).toString();
      const directResponse = await callUpload(directUrl, directImage, 'image/webp');

      assert.equal(directResponse.status, 200, await directResponse.text());
      assert.deepEqual(objects.get(`examples/images/${directHash}.webp`), directImage);
      assert.equal(
        [...objects.keys()].some((key) => key.startsWith('examples/uploads/')),
        false,
      );

      const boundaryImage = new Uint8Array(STYLE_GALLERY_DIRECT_UPLOAD_MAX_SIZE);
      const boundaryHash = sha256(boundaryImage);
      const boundaryUrl = new URL(`https://example.test/api/style-gallery/examples/${slug}/upload`);
      boundaryUrl.search = new URLSearchParams({
        platform: 'gpt-image',
        action: 'direct',
        imageHash: boundaryHash,
      }).toString();
      const boundaryResponse = await callUpload(boundaryUrl, boundaryImage, 'image/webp');
      assert.equal(boundaryResponse.status, 200, await boundaryResponse.text());
      assert.deepEqual(objects.get(`examples/images/${boundaryHash}.webp`), boundaryImage);

      const oversizedDirectImage = new Uint8Array(STYLE_GALLERY_DIRECT_UPLOAD_MAX_SIZE + 1);
      const oversizedUrl = new URL(`https://example.test/api/style-gallery/examples/${slug}/upload`);
      oversizedUrl.search = new URLSearchParams({
        platform: 'gpt-image',
        action: 'direct',
        imageHash: sha256(oversizedDirectImage),
      }).toString();
      const oversizedResponse = await callUpload(oversizedUrl, oversizedDirectImage, 'image/webp');
      assert.equal(oversizedResponse.status, 413);

      const pixels = new Uint8Array(16 * 1024 * 1024);
      for (let index = 0; index < pixels.length; index += 1) pixels[index] = index % 251;
      const image = new Uint8Array(
        await sharp(pixels, { raw: { width: 2048, height: 2048, channels: 4 } })
          .png({ compressionLevel: 0 })
          .toBuffer(),
      );
      assert.ok(image.length > 16 * 1024 * 1024);
      const uploadId = '019f4f58-103a-7ac1-9f5e-6e27c9712154';
      const parts = Array.from({ length: Math.ceil(image.length / STYLE_GALLERY_UPLOAD_CHUNK_SIZE) }, (_, index) =>
        image.slice(index * STYLE_GALLERY_UPLOAD_CHUNK_SIZE, (index + 1) * STYLE_GALLERY_UPLOAD_CHUNK_SIZE),
      );
      assert.equal(parts.length, 4);

      for (const [index, part] of parts.entries()) {
        const url = new URL(`https://example.test/api/style-gallery/examples/${slug}/upload`);
        url.search = new URLSearchParams({
          platform: 'gpt-image',
          action: 'chunk',
          uploadId,
          partIndex: index.toString(),
          partCount: parts.length.toString(),
          chunkHash: sha256(part),
        }).toString();
        const response = await callUpload(url, part, 'application/octet-stream');
        assert.equal(response.status, 200, await response.text());
      }

      const completeUrl = new URL(`https://example.test/api/style-gallery/examples/${slug}/upload?platform=gpt-image`);
      const imageHash = sha256(image);
      const manifest = {
        action: 'complete',
        uploadId,
        imageHash,
        extension: 'png',
        contentType: 'image/png',
        size: image.length,
        parts: parts.map((part, index) => ({ index, size: part.length, hash: sha256(part) })).reverse(),
      };
      const complete = (body = manifest) => callUpload(completeUrl, JSON.stringify(body), 'application/json');

      const badHash = 'b'.repeat(64);
      const invalidManifest = { ...manifest, parts: manifest.parts.map((part) => ({ ...part, hash: badHash })) };
      assert.equal((await complete(invalidManifest)).status, 500);
      const mismatchedHashResponse = await complete({ ...manifest, imageHash: badHash });
      assert.equal(mismatchedHashResponse.status, 409);
      assert.equal(objects.has(`examples/images/${badHash}.png`), false);
      maxPartDownloads = 0;
      partDownloadCount = 0;
      const completeResponse = await complete();

      assert.equal(completeResponse.status, 200, await completeResponse.text());
      assert.equal(partDownloadCount, 4);
      assert.equal(maxPartDownloads, 3);
      assert.deepEqual(objects.get(`examples/images/${imageHash}.png`), image);
      assert.equal(
        [...objects.keys()].some((key) => key.startsWith('examples/uploads/')),
        false,
      );

      // Source uploads use the same transport and additionally verify the original image format.
      const sourceUrl = new URL('https://example.test/api/style-gallery/source-upload');
      const unauthorizedResponse = await uploadSource({
        url: sourceUrl,
        request: new Request(sourceUrl, {
          method: 'POST',
          headers: { authorization: 'Bearer wrong-token', 'content-type': 'application/json' },
          body: JSON.stringify(manifest),
        }),
      } as never);
      assert.equal(unauthorizedResponse.status, 401);
      for (const [index, part] of parts.entries()) {
        const partUrl = new URL(sourceUrl);
        partUrl.search = new URLSearchParams({
          action: 'chunk',
          uploadId,
          partIndex: index.toString(),
          partCount: parts.length.toString(),
          chunkHash: sha256(part),
        }).toString();
        assert.equal((await callUpload(partUrl, part, 'application/octet-stream')).status, 200);
      }
      const sourceResponse = await callUpload(sourceUrl, JSON.stringify(manifest), 'application/json');
      assert.equal(sourceResponse.status, 200, await sourceResponse.text());
      assert.deepEqual(objects.get(`source/${imageHash.slice(0, 12)}.png`), image);
      assert.equal(
        [...objects.keys()].some((key) => key.startsWith('examples/uploads/')),
        false,
      );

      // The maximum manifest can reuse an existing original without allocating a 64 MiB fixture.
      const maxManifest = {
        ...manifest,
        size: MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE,
        parts: Array.from({ length: MAX_STYLE_GALLERY_UPLOAD_PARTS }, (_, index) => ({
          index,
          size: Math.min(
            STYLE_GALLERY_UPLOAD_CHUNK_SIZE,
            MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE - index * STYLE_GALLERY_UPLOAD_CHUNK_SIZE,
          ),
          hash: badHash,
        })),
      };
      const maxResponse = await complete(maxManifest);
      assert.equal(maxResponse.status, 200, await maxResponse.clone().text());
      assert.equal((await maxResponse.json()).reused, true);
      const downloadsBeforeOversize = partDownloadCount;
      assert.equal((await complete({ ...maxManifest, size: MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE + 1 })).status, 400);
      assert.equal(partDownloadCount, downloadsBeforeOversize);

      const lastPart = new Uint8Array([1, 2, 3]);
      const lastPartUrl = new URL(completeUrl);
      lastPartUrl.search = new URLSearchParams({
        platform: 'gpt-image',
        action: 'chunk',
        uploadId,
        partIndex: (MAX_STYLE_GALLERY_UPLOAD_PARTS - 1).toString(),
        partCount: MAX_STYLE_GALLERY_UPLOAD_PARTS.toString(),
        chunkHash: sha256(lastPart),
      }).toString();
      assert.equal((await callUpload(lastPartUrl, lastPart, 'application/octet-stream')).status, 200);
      assert.deepEqual(objects.get(getStyleGalleryUploadPartKey(uploadId, 15)), lastPart);
      const abortResponse = await callUpload(
        completeUrl,
        JSON.stringify({ action: 'abort', uploadId, partCount: MAX_STYLE_GALLERY_UPLOAD_PARTS }),
        'application/json',
      );
      assert.equal(abortResponse.status, 200);
      assert.equal(objects.has(getStyleGalleryUploadPartKey(uploadId, 15)), false);

      lastPartUrl.searchParams.set('partCount', (MAX_STYLE_GALLERY_UPLOAD_PARTS + 1).toString());
      assert.equal((await callUpload(lastPartUrl, lastPart, 'application/octet-stream')).status, 400);
      lastPartUrl.searchParams.set('partCount', MAX_STYLE_GALLERY_UPLOAD_PARTS.toString());
      lastPartUrl.searchParams.set('chunkHash', sha256(oversizedDirectImage));
      assert.equal((await callUpload(lastPartUrl, oversizedDirectImage, 'application/octet-stream')).status, 413);
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
