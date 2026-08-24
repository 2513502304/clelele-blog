import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadStyleGalleryExampleSearchIndex,
  resetStyleGalleryExampleSearchClientCache,
} from './style-gallery-example-search-client';

test('loads the Sub-gallery prompt index once and retries after a failed request', async () => {
  const previousFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    if (requests === 1) return new Response('temporary', { status: 503 });
    return Response.json({ 'source-a': 'searchable parent prompt' });
  };
  resetStyleGalleryExampleSearchClientCache();

  try {
    await assert.rejects(() => loadStyleGalleryExampleSearchIndex(), /HTTP 503/);
    const [first, duplicate] = await Promise.all([loadStyleGalleryExampleSearchIndex(), loadStyleGalleryExampleSearchIndex()]);
    assert.equal(requests, 2);
    assert.equal(first, duplicate);
    assert.equal(first['source-a'], 'searchable parent prompt');
  } finally {
    resetStyleGalleryExampleSearchClientCache();
    globalThis.fetch = previousFetch;
  }
});

test('rejects malformed index entries without caching them', async () => {
  const previousFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return requests === 1 ? Response.json({ 'source-a': 1 }) : Response.json({ 'source-a': 'valid prompt' });
  };
  resetStyleGalleryExampleSearchClientCache();

  try {
    await assert.rejects(() => loadStyleGalleryExampleSearchIndex(), /invalid entry/);
    assert.equal((await loadStyleGalleryExampleSearchIndex())['source-a'], 'valid prompt');
    assert.equal(requests, 2);
  } finally {
    resetStyleGalleryExampleSearchClientCache();
    globalThis.fetch = previousFetch;
  }
});
