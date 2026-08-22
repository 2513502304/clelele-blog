import assert from 'node:assert/strict';
import test from 'node:test';
import { loadStyleGalleryPromptChoices, resetStyleGalleryPromptClientCache } from './style-gallery-prompt-client';

test('deduplicates concurrent prompt requests and versions cache entries by prompt count', async () => {
  const previousFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return Response.json({
      prompts: [{ id: `prompt-${requests}`, prompt: `Prompt ${requests}`, model: 'gpt-5.6-terra', importedAt: '2026-08-22' }],
    });
  };
  resetStyleGalleryPromptClientCache();

  try {
    const [first, duplicate] = await Promise.all([
      loadStyleGalleryPromptChoices('item-a', 1),
      loadStyleGalleryPromptChoices('item-a', 1),
    ]);
    assert.equal(requests, 1);
    assert.equal(first, duplicate);

    await loadStyleGalleryPromptChoices('item-a', 2);
    assert.equal(requests, 2);
  } finally {
    resetStyleGalleryPromptClientCache();
    globalThis.fetch = previousFetch;
  }
});
