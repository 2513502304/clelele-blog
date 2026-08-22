import assert from 'node:assert/strict';
import test from 'node:test';
import {
  invalidateStyleGalleryImageUrl,
  resetStyleGalleryImageUrlCache,
  resolveStyleGalleryImageUrls,
} from './style-gallery-image-client';

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

test('refreshes expired or explicitly invalidated signed URLs without dropping unrelated cache entries', async () => {
  const previousFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return Response.json({
      images: { [SOURCE]: `https://s3.example.test/signed-${requests}` },
      expiresAt: requests === 1 ? Date.now() - 1 : Date.now() + 60_000,
    });
  };
  resetStyleGalleryImageUrlCache();

  try {
    assert.equal((await resolveStyleGalleryImageUrls([SOURCE]))[SOURCE], 'https://s3.example.test/signed-1');
    assert.equal((await resolveStyleGalleryImageUrls([SOURCE]))[SOURCE], 'https://s3.example.test/signed-2');
    invalidateStyleGalleryImageUrl(SOURCE);
    assert.equal((await resolveStyleGalleryImageUrls([SOURCE]))[SOURCE], 'https://s3.example.test/signed-3');
    assert.equal(requests, 3);
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
