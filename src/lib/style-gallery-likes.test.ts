import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setStyleGalleryExampleLike } from './style-gallery-likes';

const exampleId = 'example-one';
let body = JSON.stringify({
  version: 2,
  updatedAt: '2026-07-22T00:00:00.000Z',
  groups: [
    {
      sourceSlug: 'source-one',
      examples: [
        {
          id: exampleId,
          src: '/api/style-gallery/image/examples/images/aaaaaaaa.png',
          model: 'GPT-Image2',
          uploadedAt: '2026-07-22T00:00:00.000Z',
          likedBy: [],
        },
      ],
    },
  ],
});
let etag = '"etag-1"';
let conflictOnce = true;
const originalFetch = globalThis.fetch;
const previousEnv = {
  accessKey: process.env.HF_S3_ACCESS_KEY_ID,
  secretKey: process.env.HF_S3_SECRET_ACCESS_KEY,
};

describe('style gallery like writes', () => {
  before(() => {
    process.env.HF_S3_ACCESS_KEY_ID = 'HFAKTEST';
    process.env.HF_S3_SECRET_ACCESS_KEY = 'test-secret';
    globalThis.fetch = async (_input, init) => {
      if (!init?.method || init.method === 'GET') return new Response(body, { headers: { etag } });
      if (init.method === 'PUT') {
        if (conflictOnce) {
          conflictOnce = false;
          etag = '"etag-2"';
          return new Response('conflict', { status: 412 });
        }
        assert.equal(new Headers(init.headers).get('if-match'), etag);
        body = new TextDecoder().decode(init.body as ArrayBuffer);
        etag = '"etag-3"';
        return new Response(null, { status: 200, headers: { etag } });
      }
      return new Response(null, { status: 405 });
    };
  });

  after(() => {
    globalThis.fetch = originalFetch;
    if (previousEnv.accessKey === undefined) delete process.env.HF_S3_ACCESS_KEY_ID;
    else process.env.HF_S3_ACCESS_KEY_ID = previousEnv.accessKey;
    if (previousEnv.secretKey === undefined) delete process.env.HF_S3_SECRET_ACCESS_KEY;
    else process.env.HF_S3_SECRET_ACCESS_KEY = previousEnv.secretKey;
  });

  it('replays a like after an ETag conflict and remains idempotent', async () => {
    const first = await setStyleGalleryExampleLike({ exampleId, userId: 7, liked: true });
    assert.deepEqual(first, { liked: true, likeCount: 1, sourceSlug: 'source-one' });
    const duplicate = await setStyleGalleryExampleLike({ exampleId, userId: 7, liked: true });
    assert.equal(duplicate.likeCount, 1);
    const removed = await setStyleGalleryExampleLike({ exampleId, userId: 7, liked: false });
    assert.equal(removed.likeCount, 0);
  });
});
