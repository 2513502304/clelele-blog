import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { HfS3ConflictError } from '../hf-s3';
import { isAllowedStyleGalleryImageKey } from '../style-gallery-image-key';
import type { HpoiPurchaseStore } from './purchases-schema';
import { createHpoiPurchaseStore, hpoiPurchaseStorage } from './purchases-store';

const initial = (sourceUserId = '1'): HpoiPurchaseStore => ({
  version: 1,
  revision: randomUUID(),
  sourceUserId,
  snapshot: null,
  job: null,
});

function fakeStorage() {
  const objects = new Map<string, { bytes: Uint8Array; etag: string }>();
  let conflict = false;
  let uncertain = false;
  let writes = 0;
  return {
    objects,
    conflict: () => {
      conflict = true;
    },
    uncertain: () => {
      uncertain = true;
    },
    writes: () => writes,
    async get(key: string) {
      const record = objects.get(key);
      return record ? { ...record, contentType: 'application/json', contentLength: record.bytes.length } : null;
    },
    async put(key: string, bytes: Uint8Array, _type: string, conditions: { ifMatch?: string; ifNoneMatch?: '*' } = {}) {
      writes++;
      const current = objects.get(key);
      if ((current && conditions.ifMatch !== current.etag) || (!current && conditions.ifNoneMatch !== '*'))
        throw new HfS3ConflictError('Conflict');
      if (conflict) {
        conflict = false;
        throw new HfS3ConflictError('Concurrent update');
      }
      objects.set(key, { bytes, etag: randomUUID() });
      if (uncertain) {
        uncertain = false;
        throw new Error('Lost acknowledgement');
      }
    },
  };
}

it('isolates accounts and uses ETag CAS, including conflict retry and uncertain commit readback', async () => {
  const storage = fakeStorage();
  const owner = createHpoiPurchaseStore('1', storage);
  const other = createHpoiPurchaseStore('2', storage);
  await owner.edit(() => initial());
  assert.equal(await other.read(), null);
  storage.conflict();
  await owner.edit((current) => current);
  storage.uncertain();
  const accepted = await owner.edit((current) => current);
  assert.equal((await owner.read())?.value.revision, accepted?.revision);
  assert.equal(storage.writes(), 4);
  assert.equal(storage.objects.size, 1);
  await assert.rejects(
    owner.edit(() => initial('2')),
    /account mismatch/,
  );
});

it('refuses account-mismatched, corrupted or unversioned private checkpoints', async () => {
  const storage = fakeStorage();
  const store = createHpoiPurchaseStore('1', storage);
  await store.edit(() => initial());
  const key = [...storage.objects.keys()][0];
  storage.objects.set(key, { bytes: Buffer.from(JSON.stringify(initial('2'))), etag: 'etag' });
  await assert.rejects(store.read(), /account mismatch/);
  storage.objects.set(key, { bytes: Buffer.from(JSON.stringify(initial())), etag: '' });
  await assert.rejects(store.read(), /checkpoint/);
  storage.objects.set(key, { bytes: Buffer.from('Login required'), etag: 'etag' });
  await assert.rejects(store.read());
});

it('the existing public Gallery image signer rejects the private namespace and traversal variants', () => {
  const filename = `${'a'.repeat(64)}.json`;
  for (const key of [
    `hpoi-private-purchases/${filename}`,
    `../hpoi-private-purchases/${filename}`,
    `source/../../hpoi-private-purchases/${filename}`,
    `examples/images/${filename}`,
    `source/%2e%2e%2fhpoi-private-purchases%2f${filename}`,
    `hpoi-private-purchases/${'a'.repeat(64)}.png`,
  ])
    assert.equal(isAllowedStyleGalleryImageKey(key), false);
});

it('requires a dedicated private bucket and cannot fall back to the public Gallery bucket', async () => {
  const names = [
    'HF_S3_ACCESS_KEY_ID',
    'HF_S3_SECRET_ACCESS_KEY',
    'HF_S3_ENDPOINT',
    'HF_S3_BUCKET',
    'HPOI_PURCHASES_BUCKET',
  ] as const;
  const previous = names.map((name) => process.env[name]);
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, {
    HF_S3_ACCESS_KEY_ID: 'test',
    HF_S3_SECRET_ACCESS_KEY: 'test',
    HF_S3_ENDPOINT: 'https://storage.test',
    HF_S3_BUCKET: 'public-gallery',
  });
  try {
    delete process.env.HPOI_PURCHASES_BUCKET;
    assert.throws(hpoiPurchaseStorage, /not configured/);
    for (const bucket of ['raw-datasets', 'public-gallery', '../private-bucket']) {
      process.env.HPOI_PURCHASES_BUCKET = bucket;
      assert.throws(hpoiPurchaseStorage, /separate private bucket/);
    }
    process.env.HPOI_PURCHASES_BUCKET = 'private-purchases-test';
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      assert.equal(url.hostname, 'storage.test');
      assert.equal(url.pathname, '/private-purchases-test/hpoi-private-purchases/example.json');
      return new Response(null, { status: 404 });
    };
    assert.equal(await hpoiPurchaseStorage().get('example.json'), null);
  } finally {
    globalThis.fetch = originalFetch;
    names.forEach((name, index) => {
      const value = previous[index];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
  }
});
