import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadStyleGalleryPromptSearchIndex,
  resetStyleGalleryPromptSearchClientCache,
} from './style-gallery-prompt-search-client';

test('loads the Sub-gallery prompt index once and retries after a failed request', async () => {
  const previousFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    if (requests === 1) return new Response('temporary', { status: 503 });
    return Response.json({ 'source-a': 'searchable parent prompt' });
  };
  resetStyleGalleryPromptSearchClientCache();

  try {
    await assert.rejects(() => loadStyleGalleryPromptSearchIndex(), /HTTP 503/);
    const [first, duplicate] = await Promise.all([loadStyleGalleryPromptSearchIndex(), loadStyleGalleryPromptSearchIndex()]);
    assert.equal(requests, 2);
    assert.equal(first, duplicate);
    assert.equal(first['source-a'], 'searchable parent prompt');
  } finally {
    resetStyleGalleryPromptSearchClientCache();
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
  resetStyleGalleryPromptSearchClientCache();

  try {
    await assert.rejects(() => loadStyleGalleryPromptSearchIndex(), /invalid entry/);
    assert.equal((await loadStyleGalleryPromptSearchIndex())['source-a'], 'valid prompt');
    assert.equal(requests, 2);
  } finally {
    resetStyleGalleryPromptSearchClientCache();
    globalThis.fetch = previousFetch;
  }
});

test('refreshes the in-memory index after the browser cache interval', async () => {
  const previousFetch = globalThis.fetch;
  const previousDateNow = Date.now;
  let now = 1_000;
  let requests = 0;
  Date.now = () => now;
  globalThis.fetch = async () => {
    requests += 1;
    return Response.json({ 'source-a': `prompt-${requests}` });
  };
  resetStyleGalleryPromptSearchClientCache();

  try {
    assert.equal((await loadStyleGalleryPromptSearchIndex())['source-a'], 'prompt-1');
    now += 1_799_999;
    assert.equal((await loadStyleGalleryPromptSearchIndex())['source-a'], 'prompt-1');
    now += 1;
    assert.equal((await loadStyleGalleryPromptSearchIndex())['source-a'], 'prompt-2');
    assert.equal(requests, 2);
  } finally {
    resetStyleGalleryPromptSearchClientCache();
    globalThis.fetch = previousFetch;
    Date.now = previousDateNow;
  }
});
