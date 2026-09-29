import assert from 'node:assert/strict';
import { it } from 'node:test';
import { HfS3ConflictError } from '../hf-s3';
import type { SiteProfile } from './schema';
import { deleteSiteAsset, getSiteProfile, saveSiteProfile, uploadSiteAsset } from './store';

it('deletes HF bytes, reserves references during deletion and resumes a failed deletion without losing history', async () => {
  const originalFetch = globalThis.fetch;
  const previous = [process.env.HF_S3_ACCESS_KEY_ID, process.env.HF_S3_SECRET_ACCESS_KEY];
  process.env.HF_S3_ACCESS_KEY_ID = 'test';
  process.env.HF_S3_SECRET_ACCESS_KEY = 'test';
  const active = `images/${'a'.repeat(64)}.png`;
  const inactive = `images/${'b'.repeat(64)}.png`;
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  );
  const blobs = new Map([
    [active, bytes],
    [inactive, bytes],
  ]);
  let profile: SiteProfile = {
    version: 1,
    revision: '0b6964a3-f2db-4555-9383-d600bcaa448d',
    updatedAt: '2026-09-26T00:00:00Z',
    name: 'A',
    signature: '',
    links: [],
    assets: { home: active, avatar: active },
    history: [active, inactive].map((key) => ({ key, name: key, uploadedAt: '2026-09-26T00:00:00Z', width: 1, height: 1 })),
  };
  let etag = 0;
  let failDelete = true;
  let failFinalSave = false;
  let deleting = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const key = url.includes('/images/') ? `images/${url.split('/images/')[1]}` : 'profile.v1.json';
    const method = init?.method ?? 'GET';
    if (method === 'PUT' && key === 'profile.v1.json') {
      if (new Headers(init?.headers).get('if-match') !== `"v${etag}"`) return new Response('', { status: 412 });
      const next = JSON.parse(new TextDecoder().decode(init?.body as ArrayBuffer));
      if (failFinalSave && !next.pendingDeletion) return new Response('Save failed', { status: 400 });
      profile = next;
      etag++;
      return new Response(null);
    }
    if (method === 'DELETE') {
      deleting++;
      assert.equal(profile.pendingDeletion, inactive);
      await assert.rejects(
        () =>
          saveSiteProfile(profile.revision, (current) => {
            assert.ok(current);
            return { ...current, assets: { home: inactive, avatar: active } };
          }),
        HfS3ConflictError,
      );
      if (failDelete) return new Response('Delete denied', { status: 400 });
      blobs.delete(key);
      return new Response(null, { status: 204 });
    }
    if (method === 'PUT') {
      blobs.set(key, Buffer.from(init?.body as ArrayBuffer));
      return new Response(null);
    }
    if (key === 'profile.v1.json') return Response.json(profile, { headers: { ETag: `"v${etag}"` } });
    return new Response(method === 'HEAD' ? null : blobs.get(key), { status: blobs.has(key) ? 200 : 404 });
  };
  try {
    const oldRevision = profile.revision;
    await assert.rejects(() => deleteSiteAsset(oldRevision, active), HfS3ConflictError);
    assert.equal(deleting, 0);
    await assert.rejects(() => deleteSiteAsset(oldRevision, inactive));
    assert.equal(profile.history.length, 2);
    assert.equal(profile.pendingDeletion, inactive);
    assert.ok(blobs.has(inactive));
    failDelete = false;
    failFinalSave = true;
    await assert.rejects(() => deleteSiteAsset(oldRevision, inactive));
    assert.ok(!blobs.has(inactive));
    assert.equal((await getSiteProfile(true)).pendingDeletion, inactive);
    failFinalSave = false;
    const done = await deleteSiteAsset(oldRevision, inactive);
    assert.equal(done.history.length, 1);
    assert.equal(done.pendingDeletion, undefined);
    assert.ok(blobs.has(active));
    // Identical bytes uploaded again have a different version key, immune to late deletion retries.
    const one = await uploadSiteAsset(bytes, 'one.png', true);
    const two = await uploadSiteAsset(bytes, 'two.png', true);
    assert.notEqual(one.key, two.key);
    assert.deepEqual(blobs.get(one.key), bytes);
    await assert.rejects(() => deleteSiteAsset(oldRevision, inactive), HfS3ConflictError);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [index, name] of ['HF_S3_ACCESS_KEY_ID', 'HF_S3_SECRET_ACCESS_KEY'].entries()) {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    }
  }
});
