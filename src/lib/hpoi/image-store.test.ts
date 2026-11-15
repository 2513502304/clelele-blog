import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type CachedHpoiImage, publishHpoiImage, readHpoiImageManifest } from './image-store';
import { syncHpoiImage } from './image-sync';

const record: CachedHpoiImage = {
  coverUrl: 'https://rfx.hpoi.net/gk/cover/n/test.jpg',
  width: 360,
  height: 520,
  key: `objects/${'a'.repeat(64)}.jpg`,
  fallbackKey: `objects/${'b'.repeat(64)}.jpg`,
  score: null,
  matched: true,
  processedAt: '2026-11-16T00:00:00Z',
  candidates: [],
};

test('completed IDs skip Hpoi/CV; concurrent manifest writes retain another publisher’s record', async () => {
  const originalFetch = globalThis.fetch;
  const names = ['HF_S3_ACCESS_KEY_ID', 'HF_S3_SECRET_ACCESS_KEY', 'HF_S3_ENDPOINT'] as const;
  const originalEnv = names.map((name) => process.env[name]);
  process.env.HF_S3_ACCESS_KEY_ID = 'test';
  process.env.HF_S3_SECRET_ACCESS_KEY = 'test';
  process.env.HF_S3_ENDPOINT = 'https://storage.test/test';
  let remote: Record<string, CachedHpoiImage> = { '1': record };
  let conflict = true;
  let writes = 0;
  globalThis.fetch = async (input, init) => {
    assert.equal(new URL(String(input)).hostname, 'storage.test', 'cached entries must not contact Hpoi');
    if (init?.method === 'PUT') {
      writes++;
      assert.ok(new Headers(init.headers).has('if-match'));
      if (conflict) {
        conflict = false;
        remote['2'] = record;
        return new Response(null, { status: 412 });
      }
      remote = JSON.parse(Buffer.from(init.body as ArrayBuffer).toString());
      return new Response(null, { headers: { etag: 'v3' } });
    }
    return Response.json(remote, { headers: { etag: conflict ? 'v1' : 'v2' } });
  };
  try {
    assert.equal((await syncHpoiImage('1')).key, record.key);
    assert.equal(writes, 0);
    await publishHpoiImage('3', record);
    assert.deepEqual(Object.keys(await readHpoiImageManifest()).sort(), ['1', '2', '3']);
    assert.equal(writes, 2);
  } finally {
    globalThis.fetch = originalFetch;
    names.forEach((name, index) => {
      if (originalEnv[index] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[index];
    });
  }
});
