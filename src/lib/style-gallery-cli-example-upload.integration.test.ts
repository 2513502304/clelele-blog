import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import { runStyleGalleryExampleUpload } from '../../scripts/upload-style-examples';
import type { StyleGalleryVisualFeature } from './style-gallery-visual-types';

const parentHash = `2a256d37220e${'a'.repeat(52)}`;
const slug = '2026-07-26-2a256d37220e';

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function sendJson(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

function createVisualFeature(imageHash: string): StyleGalleryVisualFeature {
  return {
    imageHash,
    perceptualHash: '0'.repeat(16),
    differenceHash: '0'.repeat(16),
    palette: 'A'.repeat(32),
    embedding: 'A'.repeat(512),
  };
}

describe('style gallery example upload CLI integration', () => {
  it('uploads image bytes directly to HF and commits successful files when a sibling fails', async () => {
    const note = `${'保留原角色特征与清晰的赛璐璐阴影。'.repeat(80)}\n\nSoft daylight.\nEND`;
    const directory = await mkdtemp(path.join(tmpdir(), 'style-gallery-cli-'));
    const goodBytes = await sharp({ create: { width: 120, height: 80, channels: 3, background: 'red' } })
      .webp()
      .toBuffer();
    const failedBytes = await sharp({ create: { width: 80, height: 120, channels: 3, background: 'blue' } })
      .webp()
      .toBuffer();
    const goodHash = createHash('sha256').update(goodBytes).digest('hex');
    const failedHash = createHash('sha256').update(failedBytes).digest('hex');
    const goodPath = path.join(directory, 'good.webp');
    const failedPath = path.join(directory, 'failed.webp');
    await Promise.all([writeFile(goodPath, goodBytes), writeFile(failedPath, failedBytes)]);

    const uploaded = new Map<string, Buffer>();
    const thumbnails = new Map<string, Buffer>();
    const mergedHashes: string[] = [];
    const cleanedHashes: string[] = [];
    let catalogRequests = 0;
    const server = createServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'GET' && requestUrl.pathname === '/api/style-gallery/catalog') {
        catalogRequests += 1;
        if (catalogRequests === 1) {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end('{');
          return;
        }
        sendJson(response, {
          version: 5,
          updatedAt: '2026-07-26T00:00:00.000Z',
          tags: ['style-prompt'],
          modelTargets: ['GPT-Image', 'Nano Banana', 'PixAI', 'Midjourney', 'NovelAI', 'Flux'],
          items: [
            {
              slug,
              title: 'Style Prompt 2a256d37220e',
              date: '2026-07-26T00:00:00.000Z',
              sourceImage: '/api/style-gallery/image/source/2a256d37220e.jpg',
              promptExcerpt: 'Reusable prompt',
              promptCount: 1,
              promptRevision: 'c'.repeat(64),
              imageHash: parentHash,
              imageCount: 1,
              exampleCount: 0,
            },
          ],
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === `/api/style-gallery/examples/${slug}`) {
        assert.equal(request.headers.authorization, 'Bearer test-upload-token');
        const body = JSON.parse((await readBody(request)).toString('utf8'));
        if (body.action === 'prepare') {
          assert.equal(body.note, note);
          assert.deepEqual(body.files[0].dimensions, { width: 120, height: 80 });
          sendJson(response, {
            uploads: body.files.map(
              (file: { imageHash: string; dimensions: { width: number; height: number } }, index: number) => ({
                imageHash: file.imageHash,
                duplicate: false,
                exists: false,
                example: {
                  id: `example-${index}`,
                  src: `/api/style-gallery/image/examples/images/${file.imageHash}.webp`,
                  alt: 'PixAI example',
                  model: 'PixAI',
                  note: body.note,
                  uploadedAt: '2026-07-26T00:01:00.000Z',
                  imageHash: file.imageHash,
                  dimensions: file.dimensions,
                },
              }),
            ),
          });
          return;
        }
        if (body.action === 'merge') {
          assert.equal(body.examples[0].note, note);
          assert.deepEqual(body.examples[0].dimensions, { width: 120, height: 80 });
          assert.deepEqual(
            body.visualRecords.map((record: { feature: { imageHash: string }; imageId: string }) => ({
              imageHash: record.feature.imageHash,
              imageId: record.imageId,
            })),
            body.examples.map((example: { id: string; imageHash: string }) => ({
              imageHash: example.imageHash,
              imageId: example.id,
            })),
          );
          assert.ok(thumbnails.has(`${goodHash}.webp`), 'thumbnail must exist before metadata merge');
          mergedHashes.push(...body.examples.map((example: { imageHash: string }) => example.imageHash));
          sendJson(response, { uploaded: body.examples.length, skippedDuplicates: 0, visualIndexUpdated: true });
          return;
        }
        if (body.action === 'cleanup') {
          cleanedHashes.push(...body.examples.map((example: { imageHash: string }) => example.imageHash));
          response.writeHead(400);
          response.end('simulated cleanup rejection');
          return;
        }
      }

      const thumbPrefix = '/raw-datasets/image-style-prompt-gallery/examples/thumbs/';
      if (request.method === 'PUT' && requestUrl.pathname.startsWith(thumbPrefix)) {
        thumbnails.set(requestUrl.pathname.slice(thumbPrefix.length), await readBody(request));
        response.writeHead(200);
        response.end();
        return;
      }
      const objectPrefix = '/raw-datasets/image-style-prompt-gallery/examples/images/';
      if (request.method === 'PUT' && requestUrl.pathname.startsWith(objectPrefix)) {
        const key = requestUrl.pathname.slice(objectPrefix.length);
        if (key.startsWith(failedHash)) {
          response.writeHead(400);
          response.end('simulated rejection');
          return;
        }
        uploaded.set(key, await readBody(request));
        response.writeHead(200);
        response.end();
        return;
      }

      response.writeHead(404);
      response.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const envNames = [
      'STYLE_GALLERY_UPLOAD_TOKEN',
      'HF_S3_ACCESS_KEY_ID',
      'HF_S3_SECRET_ACCESS_KEY',
      'HF_S3_ENDPOINT',
      'HF_S3_BUCKET',
      'STYLE_GALLERY_BUCKET_PREFIX',
      'HF_S3_REGION',
      'STYLE_GALLERY_API_BASE_URL',
      'NODE_USE_ENV_PROXY',
      'NO_PROXY',
    ] as const;
    const previousEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
    const previousFetch = globalThis.fetch;
    // Keep production HTTPS signing validation while routing test-only storage traffic
    // to the local byte server; no public endpoint or real credentials are involved.
    globalThis.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      return previousFetch(
        url.origin === 'https://storage.example.test' ? `${baseUrl}${url.pathname}${url.search}` : input,
        init,
      );
    };

    try {
      Object.assign(process.env, {
        STYLE_GALLERY_UPLOAD_TOKEN: 'test-upload-token',
        HF_S3_ACCESS_KEY_ID: 'HFAKTEST',
        HF_S3_SECRET_ACCESS_KEY: 'test-secret',
        HF_S3_ENDPOINT: 'https://storage.example.test',
        HF_S3_BUCKET: 'raw-datasets',
        STYLE_GALLERY_BUCKET_PREFIX: 'image-style-prompt-gallery',
        HF_S3_REGION: 'us-east-1',
        STYLE_GALLERY_API_BASE_URL: baseUrl,
        NODE_USE_ENV_PROXY: '0',
        NO_PROXY: '127.0.0.1,localhost',
      });
      const code = await runStyleGalleryExampleUpload(
        ['--item', '2a256d37220e', '--platform', 'PixAI', '--note', note, '--attempts', '2', goodPath, failedPath],
        { computeVisualFeature: async (_bytes, imageHash) => createVisualFeature(imageHash) },
      );

      assert.equal(code, 1);
      assert.deepEqual(uploaded.get(`${goodHash}.webp`), goodBytes);
      assert.equal((await sharp(thumbnails.get(`${goodHash}.webp`)).metadata()).format, 'webp');
      assert.equal(catalogRequests, 2);
      assert.deepEqual(mergedHashes, [goodHash]);
      assert.deepEqual(cleanedHashes, [failedHash]);
    } finally {
      globalThis.fetch = previousFetch;
      for (const name of envNames) {
        const previous = previousEnv[name];
        if (previous === undefined) delete process.env[name];
        else process.env[name] = previous;
      }
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await rm(directory, { recursive: true, force: true });
    }
  });
});
