import assert from 'node:assert/strict';
import test from 'node:test';
import { resetStyleGalleryImageUrlCache, resolveStyleGalleryImageUrls } from './style-gallery-image-client';

const SOURCE = '/api/style-gallery/image/source/012345abcdef.jpg';

test('deduplicates concurrent image signing requests', async () => {
  const previousFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return Response.json({ images: { [SOURCE]: 'https://s3.example.test/signed' } });
  };
  resetStyleGalleryImageUrlCache();

  try {
    const [first, duplicate] = await Promise.all([
      resolveStyleGalleryImageUrls([SOURCE]),
      resolveStyleGalleryImageUrls([SOURCE]),
    ]);
    assert.equal(requests, 1);
    assert.deepEqual(first, duplicate);
  } finally {
    resetStyleGalleryImageUrlCache();
    globalThis.fetch = previousFetch;
  }
});

test('retries transient signing failures without retrying invalid requests', async () => {
  const previousFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    if (requests === 1) return new Response('temporary', { status: 503 });
    return Response.json({ images: { [SOURCE]: 'https://s3.example.test/recovered' } });
  };
  resetStyleGalleryImageUrlCache();

  try {
    assert.equal((await resolveStyleGalleryImageUrls([SOURCE]))[SOURCE], 'https://s3.example.test/recovered');
    assert.equal(requests, 2);

    resetStyleGalleryImageUrlCache();
    requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return new Response('invalid', { status: 400 });
    };
    await assert.rejects(() => resolveStyleGalleryImageUrls([SOURCE]), /HTTP 400/);
    assert.equal(requests, 1);
  } finally {
    resetStyleGalleryImageUrlCache();
    globalThis.fetch = previousFetch;
  }
});
