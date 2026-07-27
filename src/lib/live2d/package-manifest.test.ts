import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertLive2DManifestReleaseId,
  buildLive2DPackageManifest,
  calculateLive2DReleaseId,
  serializeLive2DManifest,
} from './package-manifest';
import { live2dPackageManifestSchema } from './types';

async function createPackage(model: unknown): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'live2d-package-'));
  await mkdir(path.join(root, 'data', 'textures'), { recursive: true });
  await mkdir(path.join(root, 'data', 'motions'), { recursive: true });
  await writeFile(path.join(root, 'model.json'), JSON.stringify(model));
  await writeFile(path.join(root, 'data', 'model.moc'), 'moc');
  await writeFile(path.join(root, 'data', 'textures', 'body.png'), 'png');
  await writeFile(path.join(root, 'data', 'motions', 'idle.mtn'), 'motion');
  return root;
}

const validModel = {
  model: 'data/model.moc',
  textures: ['data/textures/body.png'],
  motions: { idle: [{ file: 'data/motions/idle.mtn', sound: 'voice/idle.wav' }] },
};

test('creates a deterministic manifest and strips core-owned sound bindings', async () => {
  const root = await createPackage(validModel);
  const first = await buildLive2DPackageManifest(root);
  const second = await buildLive2DPackageManifest(root);
  assert.deepEqual(first.manifest, second.manifest);
  assert.deepEqual(
    first.manifest.objects.map((object) => object.path),
    ['data/model.moc', 'data/motions/idle.mtn', 'data/textures/body.png', 'model.json'],
  );
  assert.doesNotMatch(new TextDecoder().decode(first.transformedFiles.get('model.json')), /sound/);
  assert.equal(
    calculateLive2DReleaseId(first.manifest.entryPath, [...first.manifest.objects].reverse()),
    first.manifest.releaseId,
  );
});

test('rejects duplicate paths after normalization', async () => {
  const root = await createPackage({ model: 'data/model.moc', textures: ['data/./model.moc'] });
  await assert.rejects(buildLive2DPackageManifest(root), /Duplicate package paths after normalization/);

  assert.throws(
    () =>
      calculateLive2DReleaseId('model.json', [
        { path: 'data/model.moc', size: 3, mime: 'application/octet-stream', sha256: 'a'.repeat(64) },
        { path: 'data/./model.moc', size: 3, mime: 'application/octet-stream', sha256: 'a'.repeat(64) },
      ]),
    /Duplicate package path after normalization/,
  );
});

test('rejects a manifest whose releaseId does not match its immutable contents', async () => {
  const { manifest } = await buildLive2DPackageManifest(await createPackage(validModel));
  const changed = { ...manifest, releaseId: 'a'.repeat(64) };
  assert.throws(() => assertLive2DManifestReleaseId(changed), /Manifest releaseId mismatch/);
  assert.throws(() => serializeLive2DManifest(changed), /Manifest releaseId mismatch/);
});

test('checked-in manifests retain their deterministic releaseId', async () => {
  const directory = path.resolve(import.meta.dirname, '../../data/live2d/manifests');
  const filenames = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  assert.ok(filenames.length > 0, 'Expected at least one checked-in Live2D manifest.');

  for (const filename of filenames) {
    const manifest = live2dPackageManifestSchema.parse(JSON.parse(await readFile(path.join(directory, filename), 'utf8')));
    assert.equal(filename, `${manifest.releaseId}.json`);
    assert.doesNotThrow(() => assertLive2DManifestReleaseId(manifest));
  }
});

for (const badReference of ['../secret', '/root/file', 'https://example.com/model.moc', 'data\\model.moc']) {
  test(`rejects unsafe reference ${badReference}`, async () => {
    const root = await createPackage({ model: badReference });
    await assert.rejects(buildLive2DPackageManifest(root));
  });
}

test('rejects missing and symbolic-link members', async () => {
  const missingRoot = await createPackage({ model: 'data/missing.moc' });
  await assert.rejects(buildLive2DPackageManifest(missingRoot));

  const symlinkRoot = await createPackage(validModel);
  await writeFile(path.join(symlinkRoot, 'outside.moc'), 'outside');
  await writeFile(path.join(symlinkRoot, 'model.json'), JSON.stringify({ model: 'data/link.moc' }));
  await symlink(path.join(symlinkRoot, 'outside.moc'), path.join(symlinkRoot, 'data', 'link.moc'));
  await assert.rejects(buildLive2DPackageManifest(symlinkRoot), /symbolic link|regular file/);
});
