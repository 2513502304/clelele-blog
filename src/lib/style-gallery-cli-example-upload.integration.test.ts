import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

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

function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/upload-style-examples.ts', ...args], {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    let settled = false;
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      settle(() => reject(new Error('Style gallery upload CLI timed out after 30 seconds.')));
    }, 30_000);
    child.once('error', (error) => settle(() => reject(error)));
    child.once('close', (code) => settle(() => resolve({ code, stderr, stdout })));
  });
}

describe('style gallery example upload CLI integration', () => {
  it('uploads image bytes directly to HF and commits successful files when a sibling fails', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'style-gallery-cli-'));
    const goodBytes = Buffer.from('valid generated image');
    const failedBytes = Buffer.from('rejected generated image');
    const goodHash = createHash('sha256').update(goodBytes).digest('hex');
    const failedHash = createHash('sha256').update(failedBytes).digest('hex');
    const goodPath = path.join(directory, 'good.webp');
    const failedPath = path.join(directory, 'failed.webp');
    await Promise.all([writeFile(goodPath, goodBytes), writeFile(failedPath, failedBytes)]);

    const uploaded = new Map<string, Buffer>();
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
          version: 3,
          updatedAt: '2026-07-26T00:00:00.000Z',
          tags: ['style-prompt'],
          modelTargets: ['PixAI'],
          items: [
            {
              slug,
              title: 'Style Prompt 2a256d37220e',
              date: '2026-07-26T00:00:00.000Z',
              sourceImage: '/api/style-gallery/image/source/2a256d37220e.jpg',
              prompt: 'Reusable prompt',
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
          sendJson(response, {
            uploads: body.files.map((file: { imageHash: string }, index: number) => ({
              imageHash: file.imageHash,
              duplicate: false,
              exists: false,
              example: {
                id: `example-${index}`,
                src: `/api/style-gallery/image/examples/images/${file.imageHash}.webp`,
                alt: 'PixAI example',
                model: 'PixAI',
                uploadedAt: '2026-07-26T00:01:00.000Z',
                imageHash: file.imageHash,
              },
            })),
          });
          return;
        }
        if (body.action === 'merge') {
          mergedHashes.push(...body.examples.map((example: { imageHash: string }) => example.imageHash));
          sendJson(response, { uploaded: body.examples.length, skippedDuplicates: 0 });
          return;
        }
        if (body.action === 'cleanup') {
          cleanedHashes.push(...body.examples.map((example: { imageHash: string }) => example.imageHash));
          response.writeHead(400);
          response.end('simulated cleanup rejection');
          return;
        }
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

    try {
      const result = await runCli(['--item', '2a256d37220e', '--platform', 'PixAI', '--attempts', '2', goodPath, failedPath], {
        ...process.env,
        STYLE_GALLERY_UPLOAD_TOKEN: 'test-upload-token',
        HF_S3_ACCESS_KEY_ID: 'HFAKTEST',
        HF_S3_SECRET_ACCESS_KEY: 'test-secret',
        HF_S3_ENDPOINT: baseUrl,
        HF_S3_BUCKET: 'raw-datasets',
        STYLE_GALLERY_BUCKET_PREFIX: 'image-style-prompt-gallery',
        HF_S3_REGION: 'us-east-1',
        STYLE_GALLERY_API_BASE_URL: baseUrl,
        NODE_USE_ENV_PROXY: '0',
        NO_PROXY: '127.0.0.1,localhost',
      });

      assert.equal(result.code, 1, result.stdout + result.stderr);
      assert.deepEqual(uploaded.get(`${goodHash}.webp`), goodBytes);
      assert.equal(catalogRequests, 2);
      assert.deepEqual(mergedHashes, [goodHash]);
      assert.deepEqual(cleanedHashes, [failedHash]);
      assert.match(result.stdout, /1 added/);
      assert.match(result.stderr, /failed\.webp/);
      assert.match(result.stderr, /orphan cleanup failed/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await rm(directory, { recursive: true, force: true });
    }
  });
});
