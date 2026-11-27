import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forgetReviewedOriginal, readReviewedOriginal, streamReviewedOriginal } from './style-gallery-reviewed-original';

test('confirmation reuses complete owner-scoped bytes only while storage attests to the reviewed version', async (t) => {
  const key = 'drafts/owner-a/id/0',
    other = 'drafts/owner-b/id/0';
  let etag = '"a"',
    value = 'first',
    downloads = 0;
  for (const [name, setting] of Object.entries({
    HF_S3_ENDPOINT: 'https://review-cache.invalid',
    HF_S3_ACCESS_KEY_ID: 'fixture',
    HF_S3_SECRET_ACCESS_KEY: 'fixture',
  })) {
    const old = process.env[name];
    process.env[name] = setting;
    t.after(() => {
      if (old === undefined) delete process.env[name];
      else process.env[name] = old;
    });
  }
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(new URL(input instanceof Request ? input.url : input).hostname, 'review-cache.invalid');
    if (!value) return new Response(null, { status: 404 });
    if (init?.method === 'HEAD') return new Response(null, { headers: { etag } });
    downloads++;
    return new Response(value, { headers: { etag } });
  });
  t.after(() => {
    forgetReviewedOriginal(key);
    forgetReviewedOriginal(other);
  });
  const stream = (body: string, length = body.length) =>
    streamReviewedOriginal(key, new Response(body, { headers: { etag, 'content-length': String(length) } }));
  assert.equal(await new Response(stream(value)).text(), value);
  assert.equal((await readReviewedOriginal(key)).reused, true);
  assert.equal(downloads, 0);
  assert.equal((await readReviewedOriginal(other)).reused, false);
  assert.equal(downloads, 1);
  etag = '"b"';
  value = 'replacement';
  const changed = await readReviewedOriginal(key);
  assert.equal(changed.reused, false);
  assert.ok(changed.bytes);
  assert.equal(Buffer.from(changed.bytes).toString(), value);
  forgetReviewedOriginal(key);
  await new Response(stream('abc', 10)).arrayBuffer();
  assert.equal((await readReviewedOriginal(key)).reused, false);
  const large = 'x'.repeat(8 * 1024 * 1024 + 1);
  await new Response(stream(large)).arrayBuffer();
  assert.equal((await readReviewedOriginal(key)).reused, false);
  await new Response(stream(value)).arrayBuffer();
  value = '';
  assert.equal((await readReviewedOriginal(key)).bytes, null);
});
