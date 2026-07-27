import assert from 'node:assert/strict';
import test from 'node:test';
import type { HfS3ObjectSnapshot } from '../hf-s3';
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
