import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCachedStyleGalleryImageUrl,
  getReusableStyleGalleryImageUrl,
  invalidateStyleGalleryImageUrl,
  isStyleGalleryImageUrlLoaded,
  markStyleGalleryImageUrlLoaded,
  rememberLoadedStyleGalleryImage,
  resetStyleGalleryImageUrlCache,
  resolveStyleGalleryImageUrls,
} from './style-gallery-image-client';

const SOURCE = '/api/style-gallery/image/source/012345abcdef.jpg';

test('deduplicates concurrent image signing requests', async () => {
  const previousFetch = globalThis.fetch;
  let requests = 0;
  let requestedKeys: string[] = [];
  globalThis.fetch = async (_input, init) => {
    requests += 1;
    requestedKeys = (JSON.parse(String(init?.body)) as { keys: string[] }).keys;
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
    assert.deepEqual(requestedKeys, ['source/012345abcdef.jpg']);
    assert.equal(getCachedStyleGalleryImageUrl(SOURCE), 'https://s3.example.test/signed');
    assert.equal(getReusableStyleGalleryImageUrl(SOURCE, false), 'https://s3.example.test/signed');
    assert.equal((await resolveStyleGalleryImageUrls([SOURCE]))[SOURCE], 'https://s3.example.test/signed');
    assert.equal(requests, 1);
  } finally {
    resetStyleGalleryImageUrlCache();
    globalThis.fetch = previousFetch;
  }
});

test('reuses canonical URLs only after the page image has actually loaded', () => {
  resetStyleGalleryImageUrlCache();
  assert.equal(getReusableStyleGalleryImageUrl(SOURCE, false), undefined);
  assert.equal(getReusableStyleGalleryImageUrl(SOURCE, true), SOURCE);
});

test('prefers the URL that is already loaded over a signed URL that is only prepared', async () => {
  const previousFetch = globalThis.fetch;
  const signed = 'https://s3.example.test/prepared-but-not-loaded';
  globalThis.fetch = async () => Response.json({ images: { [SOURCE]: signed }, expiresAt: Date.now() + 60_000 });
  resetStyleGalleryImageUrlCache();

  try {
    await resolveStyleGalleryImageUrls([SOURCE]);
    assert.equal(getReusableStyleGalleryImageUrl(SOURCE, true), SOURCE);
    assert.equal(isStyleGalleryImageUrlLoaded(signed), false);

    markStyleGalleryImageUrlLoaded(signed);
    assert.equal(getReusableStyleGalleryImageUrl(SOURCE, true), signed);
  } finally {
    resetStyleGalleryImageUrlCache();
    globalThis.fetch = previousFetch;
  }
});

test('detects an image that completed before island hydration attached onLoad', () => {
  const loaded = new Set<string>();
  rememberLoadedStyleGalleryImage(loaded, SOURCE, { complete: true, naturalWidth: 1024 });
  rememberLoadedStyleGalleryImage(loaded, '/still-loading.webp', { complete: false, naturalWidth: 0 });
  assert.deepEqual([...loaded], [SOURCE]);
  assert.equal(isStyleGalleryImageUrlLoaded(SOURCE), true);
  assert.equal(isStyleGalleryImageUrlLoaded('/still-loading.webp'), false);
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
    assert.equal(getCachedStyleGalleryImageUrl(SOURCE), undefined);
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

test('chunks signing requests at the shared server limit', async () => {
  const previousFetch = globalThis.fetch;
  const sources = Array.from(
    { length: 49 },
    (_, index) => `/api/style-gallery/image/source/${index.toString(16).padStart(12, '0')}.jpg`,
  );
  const batchSizes: number[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { keys: string[] };
    batchSizes.push(body.keys.length);
    return Response.json({
      images: Object.fromEntries(body.keys.map((key) => [`/api/style-gallery/image/${key}`, `https://s3.example.test/${key}`])),
      expiresAt: Date.now() + 60_000,
    });
  };
  resetStyleGalleryImageUrlCache();

  try {
    const resolved = await resolveStyleGalleryImageUrls(sources);
    assert.deepEqual(batchSizes, [48, 1]);
    assert.equal(Object.keys(resolved).length, sources.length);
  } finally {
    resetStyleGalleryImageUrlCache();
    globalThis.fetch = previousFetch;
  }
});
