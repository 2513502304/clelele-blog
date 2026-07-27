import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCostumeMatchesManifest, live2dCatalog } from './catalog';
import type { Live2DCostume, Live2DPackageManifest } from './types';

test('published catalog remains lightweight and validates at import time', () => {
  assert.equal(live2dCatalog.version, 1);
  assert.equal(live2dCatalog.characters.length, 2);
  assert.equal(
    live2dCatalog.characters.reduce((total, character) => total + character.costumes.length, 0),
    4,
  );
  assert.equal('model' in live2dCatalog.characters[0].costumes[0], false);
});

test('catalog costume must match its manifest', () => {
  const releaseId = 'a'.repeat(64);
  const costume: Live2DCostume = {
    id: 'default',
    label: { zh: '默认' },
    releaseId,
    entryPath: `releases/${releaseId}/model.json`,
    packageBytes: 12,
    scale: 1,
    position: [0, 0],
    interactions: [],
    provenancePath: `src/data/live2d/provenance/${releaseId}.json`,
  };
  const manifest: Live2DPackageManifest = {
    version: 1,
    releaseId,
    entryPath: 'model.json',
    totalBytes: 12,
    objects: [{ path: 'model.json', size: 12, mime: 'application/json', sha256: 'b'.repeat(64) }],
  };
  assert.doesNotThrow(() => assertCostumeMatchesManifest(costume, manifest));
  assert.throws(
    () => assertCostumeMatchesManifest({ ...costume, entryPath: `releases/${releaseId}/other.json` }, manifest),
    /Entry path mismatch/,
  );
  assert.throws(
    () =>
      assertCostumeMatchesManifest(
        { ...costume, entryPath: `releases/${releaseId}/missing.json` },
        { ...manifest, entryPath: 'missing.json' },
      ),
    /Entry path is not present in manifest/,
  );
  assert.throws(() => assertCostumeMatchesManifest({ ...costume, packageBytes: 13 }, manifest), /Package size mismatch/);
});
