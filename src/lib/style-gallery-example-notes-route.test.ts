import assert from 'node:assert/strict';
import { it } from 'node:test';
import { POST } from '../pages/api/style-gallery/examples/[slug]';
import { getStyleGalleryPromptId } from './style-gallery-prompts';
import { invalidateStyleGalleryStoreCache } from './style-gallery-store';

it('prepares full generation prompts without truncation while retaining token and string validation', async () => {
  const slug = 'long-note-test';
  const prompt = 'Reusable parent prompt';
  const note = `${'细腻的线条、柔和的光照与天空。'.repeat(100)}\n\n${'Preserve the original character. '.repeat(80)}\nEND`;
  const originalFetch = globalThis.fetch;
  const environment = {
    STYLE_GALLERY_UPLOAD_TOKEN: 'test-note-token',
    HF_S3_ACCESS_KEY_ID: 'HFAKTEST',
    HF_S3_SECRET_ACCESS_KEY: 'test-secret',
    HF_S3_ENDPOINT: 'https://storage.example.test',
    HF_S3_BUCKET: 'raw-datasets',
    STYLE_GALLERY_BUCKET_PREFIX: 'image-style-prompt-gallery',
  };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  invalidateStyleGalleryStoreCache();
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.pathname.endsWith(`/items/${slug}.json`)) {
      return Response.json({
        version: 4,
        slug,
        title: 'Long note parent',
        date: '2026-09-26T00:00:00.000Z',
        sourceImage: '/api/style-gallery/image/source/aaaaaaaaaaaa.png',
        imageHash: 'a'.repeat(64),
        images: [{ sourceImage: '/api/style-gallery/image/source/aaaaaaaaaaaa.png', imageHash: 'a'.repeat(64) }],
        prompts: [{ id: getStyleGalleryPromptId(prompt), prompt, importedAt: '2026-09-26T00:00:00.000Z' }],
        examples: [],
      });
    }
    if (method === 'HEAD' && url.pathname.includes('/examples/images/')) return new Response(null, { status: 404 });
    assert.fail(`Unexpected storage operation: ${method} ${url.pathname}`);
  };

  async function prepare(value: unknown, authorized = true): Promise<Response> {
    return POST({
      params: { slug },
      request: new Request(`https://example.test/api/style-gallery/examples/${slug}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(authorized ? { authorization: 'Bearer test-note-token' } : {}) },
        body: JSON.stringify({
          action: 'prepare',
          platform: 'PixAI',
          note: value,
          files: [{ name: 'image.png', type: 'image/png', size: 123, imageHash: 'b'.repeat(64) }],
        }),
      }),
    } as never);
  }

  try {
    assert.ok(note.length > 500);
    const response = await prepare(note);
    assert.equal(response.status, 200);
    const result: { uploads: Array<{ example: { note?: string } }> } = await response.json();
    assert.equal(result.uploads[0].example.note, note);
    assert.equal((await prepare(note, false)).status, 401);
    assert.equal((await prepare(42)).status, 400);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateStyleGalleryStoreCache();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
