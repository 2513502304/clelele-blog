import assert from 'node:assert/strict';
import test from 'node:test';
import type { HfS3ObjectSnapshot } from '../hf-s3';
import { getLive2DPackageManifest } from './asset-registry';
import { getLive2DObjectKey, live2dCatalog } from './catalog';
import { createLive2DMetadataStore } from './metadata-store';
import { calculateLive2DReleaseId } from './package-manifest';
import type { Live2DCatalog, Live2DPackageManifest } from './types';

function snapshot(value: unknown): HfS3ObjectSnapshot {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return {
    bytes,
    etag: '"test"',
    contentType: 'application/json',
    contentLength: bytes.byteLength,
  };
}

function remoteFixture(): {
  catalog: Live2DCatalog;
  manifest: Live2DPackageManifest;
} {
  const objects = [
    {
      path: 'model.json',
      size: 2,
      mime: 'application/json',
      sha256: 'a'.repeat(64),
    },
  ];
  const releaseId = calculateLive2DReleaseId('model.json', objects);
  const manifest: Live2DPackageManifest = {
    version: 1,
    releaseId,
    entryPath: 'model.json',
    totalBytes: 2,
    objects,
  };
  const catalog: Live2DCatalog = {
    version: 1,
    characters: [
      {
        id: 'remote-character',
        label: { zh: '远程角色' },
        costumes: [
          {
            id: 'remote-costume',
            label: { zh: '远程服装' },
            releaseId,
            entryPath: getLive2DObjectKey(releaseId, 'model.json'),
            packageBytes: 2,
            scale: 1,
            position: [0, 0],
            interactions: [],
            provenancePath: `provenance/${releaseId}.json`,
          },
        ],
      },
    ],
  };
  return { catalog, manifest };
}

test('coalesces remote catalog and immutable manifest reads', async () => {
  const { catalog, manifest } = remoteFixture();
  const calls = new Map<string, number>();
  const store = createLive2DMetadataStore({
    client: {
      async get(key) {
        calls.set(key, (calls.get(key) ?? 0) + 1);
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (key === 'catalog.json') return snapshot(catalog);
        if (key === `manifests/${manifest.releaseId}.json`) return snapshot(manifest);
        return null;
      },
    },
  });

  const [leftCatalog, rightCatalog] = await Promise.all([store.getCatalog(), store.getCatalog()]);
  assert.deepEqual(leftCatalog, catalog);
  assert.deepEqual(rightCatalog, catalog);
  const [leftManifest, rightManifest] = await Promise.all([
    store.getManifest(manifest.releaseId),
    store.getManifest(manifest.releaseId),
  ]);
  assert.deepEqual(leftManifest, manifest);
  assert.deepEqual(rightManifest, manifest);
  assert.equal(calls.get('catalog.json'), 1);
  assert.equal(calls.get(`manifests/${manifest.releaseId}.json`), 1);
});

test('falls back to the checked-in catalog when the remote directory is unavailable', async () => {
  const store = createLive2DMetadataStore({
    client: {
      async get() {
        throw new Error('network unavailable');
      },
    },
  });
  assert.deepEqual(await store.getCatalog(), live2dCatalog);
});

test('merges an optional native catalog without duplicating identities or replacing GBP metadata', async () => {
  const { catalog } = remoteFixture();
  const native = structuredClone(catalog);
  native.characters[0].label = { zh: '另一个来源名称' };
  native.characters[0].costumes[0].id = 'native-costume';
  native.characters[0].costumes[0].entryPath = getLive2DObjectKey(
    native.characters[0].costumes[0].releaseId,
    'model.native.json',
  );
  let fail = false;
  const store = createLive2DMetadataStore({
    nativeCatalogKey: 'catalog-our-notes.json',
    catalogTtlMs: 0,
    client: {
      async get(key) {
        if (key === 'catalog.json') return snapshot(catalog);
        if (fail) throw new Error('temporary outage');
        return snapshot(native);
      },
    },
  });
  const combined = await store.getCatalog();
  assert.equal(combined.characters.length, 1);
  assert.deepEqual(combined.characters[0].label, catalog.characters[0].label);
  assert.deepEqual(
    combined.characters[0].costumes.map((c) => c.id),
    ['remote-costume', 'native-costume'],
  );
  fail = true;
  assert.deepEqual(await store.getCatalog(), combined, 'a transient native read failure keeps the last complete snapshot');
  assert.equal(catalog.characters[0].costumes.length, 1);
});

test('a missing optional native catalog preserves the complete GBP directory', async () => {
  const { catalog } = remoteFixture();
  const store = createLive2DMetadataStore({
    nativeCatalogKey: 'catalog-our-notes.json',
    client: {
      async get(key) {
        return key === 'catalog.json' ? snapshot(catalog) : null;
      },
    },
  });
  assert.deepEqual(await store.getCatalog(), catalog);
});

test('a cold native catalog failure does not replace the remote GBP directory with bootstrap', async () => {
  const { catalog } = remoteFixture();
  for (const failure of ['network', 'invalid']) {
    const store = createLive2DMetadataStore({
      nativeCatalogKey: 'catalog-our-notes.json',
      client: {
        async get(key) {
          if (key === 'catalog.json') return snapshot(catalog);
          if (failure === 'network') throw new Error('Temporary native catalog failure');
          return snapshot({ version: 'invalid' });
        },
      },
    });
    assert.deepEqual(await store.getCatalog(), catalog);
  }
});

test('keeps checked-in release manifests readable after the remote catalog replaces their entries', async () => {
  const bootstrapReleaseId = live2dCatalog.characters[0]?.costumes[0]?.releaseId;
  assert.ok(bootstrapReleaseId);
  const bootstrapManifest = getLive2DPackageManifest(bootstrapReleaseId);
  assert.ok(bootstrapManifest);
  const { catalog: remoteCatalog } = remoteFixture();
  const store = createLive2DMetadataStore({
    client: {
      async get(key) {
        if (key === 'catalog.json') return snapshot(remoteCatalog);
        return null;
      },
    },
  });

  assert.deepEqual(await store.getManifest(bootstrapReleaseId), bootstrapManifest);
});

test('rejects a remote manifest whose key and immutable release id disagree', async () => {
  const { catalog, manifest } = remoteFixture();
  const wrongReleaseId = 'b'.repeat(64);
  const conflictingCatalog: Live2DCatalog = {
    ...catalog,
    characters: catalog.characters.map((character) => ({
      ...character,
      costumes: character.costumes.map((costume) => ({
        ...costume,
        releaseId: wrongReleaseId,
        entryPath: getLive2DObjectKey(wrongReleaseId, 'model.json'),
      })),
    })),
  };
  const store = createLive2DMetadataStore({
    client: {
      async get(key) {
        if (key === 'catalog.json') return snapshot(conflictingCatalog);
        if (key === `manifests/${wrongReleaseId}.json`) return snapshot(manifest);
        return null;
      },
    },
  });
  await assert.rejects(store.getManifest(wrongReleaseId), /does not match release/);
});

test('allows immutable manifests referenced only by a character voice pack', async () => {
  const { catalog } = remoteFixture();
  const objects = [{ path: 'dialogues.json', size: 2, mime: 'application/json', sha256: 'd'.repeat(64) }];
  const releaseId = calculateLive2DReleaseId('dialogues.json', objects);
  const manifest: Live2DPackageManifest = {
    version: 1,
    releaseId,
    entryPath: 'dialogues.json',
    totalBytes: 2,
    objects,
  };
  catalog.characters[0].voice = {
    releaseId,
    entryPath: getLive2DObjectKey(releaseId, 'dialogues.json'),
    packageBytes: 2,
    dialogueCount: 1,
    provenancePath: `provenance/${releaseId}.json`,
  };
  const store = createLive2DMetadataStore({
    client: {
      async get(key) {
        if (key === 'catalog.json') return snapshot(catalog);
        if (key === `manifests/${releaseId}.json`) return snapshot(manifest);
        return null;
      },
    },
  });

  assert.deepEqual(await store.getManifest(releaseId), manifest);
});

test('bounds immutable manifest metadata with least-recently-used eviction', async () => {
  const first = remoteFixture();
  const secondObjects = [{ path: 'model.json', size: 2, mime: 'application/json', sha256: 'e'.repeat(64) }];
  const secondManifest: Live2DPackageManifest = {
    version: 1,
    releaseId: calculateLive2DReleaseId('model.json', secondObjects),
    entryPath: 'model.json',
    totalBytes: 2,
    objects: secondObjects,
  };
  const secondCostume = {
    ...first.catalog.characters[0].costumes[0],
    id: 'second-costume',
    releaseId: secondManifest.releaseId,
    entryPath: getLive2DObjectKey(secondManifest.releaseId, 'model.json'),
  };
  first.catalog.characters[0].costumes.push(secondCostume);
  const reads = new Map<string, number>();
  const store = createLive2DMetadataStore({
    manifestCacheEntries: 1,
    client: {
      async get(key) {
        reads.set(key, (reads.get(key) ?? 0) + 1);
        if (key === 'catalog.json') return snapshot(first.catalog);
        if (key === `manifests/${first.manifest.releaseId}.json`) return snapshot(first.manifest);
        if (key === `manifests/${secondManifest.releaseId}.json`) return snapshot(secondManifest);
        return null;
      },
    },
  });

  await store.getManifest(first.manifest.releaseId);
  await store.getManifest(secondManifest.releaseId);
  await store.getManifest(first.manifest.releaseId);
  assert.equal(reads.get(`manifests/${first.manifest.releaseId}.json`), 2);
});

test('reports remote bootstrap-manifest integrity failures once and caches the trusted fallback', async () => {
  const bootstrapReleaseId = live2dCatalog.characters[0]?.costumes[0]?.releaseId;
  assert.ok(bootstrapReleaseId);
  const bootstrapManifest = getLive2DPackageManifest(bootstrapReleaseId);
  assert.ok(bootstrapManifest);
  const diagnostics: Array<{ message: string; error: unknown }> = [];
  let manifestReads = 0;
  const store = createLive2DMetadataStore({
    onDiagnostic(message, error) {
      diagnostics.push({ message, error });
    },
    client: {
      async get(key) {
        if (key === 'catalog.json') return snapshot(live2dCatalog);
        if (key === `manifests/${bootstrapReleaseId}.json`) {
          manifestReads += 1;
          return snapshot({ ...bootstrapManifest, totalBytes: bootstrapManifest.totalBytes + 1 });
        }
        return null;
      },
    },
  });

  assert.deepEqual(await store.getManifest(bootstrapReleaseId), bootstrapManifest);
  assert.deepEqual(await store.getManifest(bootstrapReleaseId), bootstrapManifest);
  assert.equal(manifestReads, 1);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0].message, /integrity check failed/);
});
