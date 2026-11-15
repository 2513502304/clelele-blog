import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HpoiSourceError, readHpoiCandidate } from './image-source';

test('missing thumbnails fall back to originals; two 404s skip only that candidate', async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    return url.includes('/pic/n/available') ? new Response('photo') : new Response(null, { status: 404 });
  };
  try {
    assert.equal((await readHpoiCandidate('https://rfx.hpoi.net/gk/pic/n/available.jpg'))?.toString(), 'photo');
    assert.equal(await readHpoiCandidate('https://rfx.hpoi.net/gk/pic/n/missing.jpg'), null);
    assert.equal(calls.length, 4, 'permanent 404s do not consume transient retry attempts');
    assert.ok(calls[0].includes('/pic/s/'));
  } finally {
    globalThis.fetch = original;
  }
});
test('forbidden responses are retryable failures, never confirmed deletions', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(null, { status: 403 });
  };
  try {
    await assert.rejects(
      readHpoiCandidate('https://rfx.hpoi.net/gk/pic/n/blocked.jpg'),
      (error) => error instanceof HpoiSourceError && error.status === 403,
    );
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = original;
  }
});
