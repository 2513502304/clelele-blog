import assert from 'node:assert/strict';
import { it } from 'node:test';
import { HfS3ConflictError } from '../hf-s3';
import { getSiteProfile, saveSiteProfile } from './store';

it('uses conditional writes, rejects stale editors, and verifies uncertain commits by revision', async () => {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.HF_S3_ACCESS_KEY_ID;
  const previousSecret = process.env.HF_S3_SECRET_ACCESS_KEY;
  process.env.HF_S3_ACCESS_KEY_ID = 'test';
  process.env.HF_S3_SECRET_ACCESS_KEY = 'test';
  const key = `images/${'a'.repeat(64)}.png`;
  let profile = {
    version: 1,
    revision: '0b6964a3-f2db-4555-9383-d600bcaa448d',
    updatedAt: '2026-09-26T00:00:00.000Z',
    name: 'A',
    signature: '',
    links: [],
    assets: { avatar: key, home: key },
    history: [{ key, name: 'x', uploadedAt: '2026-09-26T00:00:00.000Z', width: 10, height: 10 }],
  };
  let writes = 0;
  let uncertain = false;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === 'PUT') {
      writes++;
      assert.equal(new Headers(init.headers).get('if-match'), '"revision-etag"');
      profile = JSON.parse(new TextDecoder().decode(init.body as ArrayBuffer));
      if (uncertain) throw new Error('Connection closed after accepted write');
      return new Response(null, { status: 200 });
    }
    return Response.json(profile, { headers: { ETag: '"revision-etag"' } });
  };
  try {
    const first = await saveSiteProfile(profile.revision, (current) => {
      assert.ok(current);
      return { ...current, signature: 'first' };
    });
    await assert.rejects(
      () =>
        saveSiteProfile('0b6964a3-f2db-4555-9383-d600bcaa448d', (current) => {
          assert.ok(current);
          return current;
        }),
      HfS3ConflictError,
    );
    assert.equal(writes, 1);
    uncertain = true;
    const second = await saveSiteProfile(first.revision, (current) => {
      assert.ok(current);
      return { ...current, signature: 'second' };
    });
    assert.equal((await getSiteProfile(true)).revision, second.revision);
    assert.equal(second.signature, 'second');
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.HF_S3_ACCESS_KEY_ID;
    else process.env.HF_S3_ACCESS_KEY_ID = previousKey;
    if (previousSecret === undefined) delete process.env.HF_S3_SECRET_ACCESS_KEY;
    else process.env.HF_S3_SECRET_ACCESS_KEY = previousSecret;
  }
});
