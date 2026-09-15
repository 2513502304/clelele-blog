import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadStyleGalleryPromptChoices,
  publishStyleGalleryPromptChoices,
  resetStyleGalleryPromptClientCache,
} from './style-gallery-prompt-client';

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

test('a successful edit supersedes an in-flight chooser read and refreshes existing revision keys', async () => {
  const previousFetch = globalThis.fetch;
  let finish: ((response: Response) => void) | undefined;
  globalThis.fetch = () =>
    new Promise<Response>((resolve) => {
      finish = resolve;
    });
  resetStyleGalleryPromptClientCache();
  try {
    const pending = loadStyleGalleryPromptChoices('edited-item', 'old-revision');
    const updated = [{ id: 'new-id', prompt: 'Edited\n\nMultiline prompt', importedAt: '2026-09-15' }];
    publishStyleGalleryPromptChoices('edited-item', 'old-revision', updated);
    finish?.(Response.json({ prompts: [{ id: 'old-id', prompt: 'Old prompt', importedAt: '2026-09-15' }] }));
    assert.deepEqual(await pending, updated);
    assert.deepEqual(await loadStyleGalleryPromptChoices('edited-item', 'old-revision'), updated);
  } finally {
    resetStyleGalleryPromptClientCache();
    globalThis.fetch = previousFetch;
  }
});

test('published edits remain available when the superseded chooser request fails', async () => {
  const previousFetch = globalThis.fetch;
  let fail: ((reason: Error) => void) | undefined;
  globalThis.fetch = () =>
    new Promise<Response>((_resolve, reject) => {
      fail = reject;
    });
  resetStyleGalleryPromptClientCache();
  try {
    const pending = loadStyleGalleryPromptChoices('edited-item', 'old-revision');
    const updated = [{ id: 'new-id', prompt: 'Edited prompt', importedAt: '2026-09-15' }];
    publishStyleGalleryPromptChoices('edited-item', 'old-revision', updated);
    fail?.(new TypeError('Network failed'));
    assert.deepEqual(await pending, updated);
  } finally {
    resetStyleGalleryPromptClientCache();
    globalThis.fetch = previousFetch;
  }
});
