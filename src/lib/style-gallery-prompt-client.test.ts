import assert from 'node:assert/strict';
import test from 'node:test';
import { loadStyleGalleryPromptChoices, resetStyleGalleryPromptClientCache } from './style-gallery-prompt-client';

test('deduplicates concurrent prompt requests and versions cache entries by prompt revision', async () => {
  const previousFetch = globalThis.fetch;
  let requests = 0;
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    requests += 1;
    urls.push(String(input));
    return Response.json({
      prompts: [{ id: `prompt-${requests}`, prompt: `Prompt ${requests}`, model: 'gpt-5.6-terra', importedAt: '2026-08-22' }],
    });
  };
  resetStyleGalleryPromptClientCache();

  try {
    const [first, duplicate] = await Promise.all([
      loadStyleGalleryPromptChoices('item-a', 'a'.repeat(64)),
      loadStyleGalleryPromptChoices('item-a', 'a'.repeat(64)),
    ]);
    assert.equal(requests, 1);
    assert.equal(first, duplicate);

    await loadStyleGalleryPromptChoices('item-a', 'b'.repeat(64));
    assert.equal(requests, 2);
    assert.match(urls[0], new RegExp(`\\?v=${'a'.repeat(64)}$`));
    assert.match(urls[1], new RegExp(`\\?v=${'b'.repeat(64)}$`));
  } finally {
    resetStyleGalleryPromptClientCache();
    globalThis.fetch = previousFetch;
  }
});

test('does not cache a failed prompt request and retries on the next call', async () => {
  const previousFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    if (requests === 1) return new Response('temporary', { status: 500 });
    return Response.json({
      prompts: [{ id: 'recovered', prompt: 'Recovered prompt', importedAt: '2026-08-22' }],
    });
  };
  resetStyleGalleryPromptClientCache();

  try {
    await assert.rejects(() => loadStyleGalleryPromptChoices('item-retry', 'c'.repeat(64)), /HTTP 500/);
    const prompts = await loadStyleGalleryPromptChoices('item-retry', 'c'.repeat(64));
    assert.equal(requests, 2);
    assert.equal(prompts[0]?.prompt, 'Recovered prompt');
  } finally {
    resetStyleGalleryPromptClientCache();
    globalThis.fetch = previousFetch;
  }
});
