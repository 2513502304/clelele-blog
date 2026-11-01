import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
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

test('approved audio controls package inclusion without retaining core-owned sound bindings', async () => {
  const root = await createPackage(validModel);
  await mkdir(path.join(root, 'voice'), { recursive: true });
  await writeFile(path.join(root, 'voice', 'idle.wav'), 'voice');

  const withoutApproval = await buildLive2DPackageManifest(root);
  assert.equal(
    withoutApproval.manifest.objects.some((object) => object.path === 'voice/idle.wav'),
    false,
  );

  const withApproval = await buildLive2DPackageManifest(root, { approvedAudio: new Set(['voice/idle.wav']) });
  assert.equal(
    withApproval.manifest.objects.some((object) => object.path === 'voice/idle.wav'),
    true,
  );
  assert.doesNotMatch(new TextDecoder().decode(withApproval.transformedFiles.get('model.json')), /sound/);
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
  assert.throws(
    () => assertLive2DManifestReleaseId({ ...manifest, totalBytes: manifest.totalBytes + 1 }),
    /Manifest totalBytes mismatch/,
  );
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

test('packages native Our Notes compressed and split assets without losing shader or moc data', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'live2d-native-'));
  await mkdir(path.join(root, 'assets'));
  const files = ['model.json.gz', 'model.moc3.gz', 'shader.glsl.gz', 'texture.png', 'nodes.json.gz'];
  const assets = [];
  for (const file of files) {
    const decoded = Buffer.from(file);
    const bytes = file.endsWith('.gz') ? gzipSync(decoded) : decoded;
    const name = `${createHash('sha256').update(decoded).digest('hex')}.${file.split('.').slice(1).join('.')}`;
    await writeFile(path.join(root, 'assets', name), bytes);
    assets.push({ asset: `assets/${name}`, size: decoded.length, stored: bytes.length });
  }
  const source = {
    format: 3,
    id: 'anon',
    files: {
      'model.json': assets[0],
      'model.moc3': assets[1],
      'shader.glsl': assets[2],
      'texture.png': assets[3],
      'prefab.json': { parts: [['nodes', assets[4].asset, assets[4].size, assets[4].stored]], size: assets[4].size },
    },
  };
  await writeFile(path.join(root, 'model.native.json'), JSON.stringify(source));
  const { manifest } = await buildLive2DPackageManifest(root, { entryPath: 'model.native.json' });
  assert.deepEqual(manifest.objects.map((o) => o.path).sort(), [...assets.map((a) => a.asset), 'model.native.json'].sort());
  const aliased = structuredClone(source);
  aliased.files['model.json'].asset = `./${assets[0].asset}`;
  aliased.files['model.json'].stored++;
  await writeFile(path.join(root, 'model.native.json'), JSON.stringify(aliased));
  await assert.rejects(buildLive2DPackageManifest(root, { entryPath: 'model.native.json' }), /stored size\/path mismatch/);
  const collision = { ...source, files: { ...source.files, alias: { ...assets[0], asset: `./${assets[0].asset}` } } };
  await writeFile(path.join(root, 'model.native.json'), JSON.stringify(collision));
  await assert.rejects(buildLive2DPackageManifest(root, { entryPath: 'model.native.json' }), /Duplicate native asset path/);
  for (const change of ['stored', 'decoded', 'hash', 'gzip']) {
    const broken = structuredClone(source);
    if (change === 'stored') broken.files['model.json'].stored++;
    if (change === 'decoded') broken.files['model.json'].size++;
    if (change === 'hash' || change === 'gzip') {
      const bytes = change === 'gzip' ? Buffer.from('broken gzip') : gzipSync(Buffer.from('incorrect content'));
      await writeFile(path.join(root, assets[0].asset), bytes);
      broken.files['model.json'].stored = bytes.length;
    }
    await writeFile(path.join(root, 'model.native.json'), JSON.stringify(broken));
    await assert.rejects(buildLive2DPackageManifest(root, { entryPath: 'model.native.json' }));
  }
  await writeFile(
    path.join(root, 'model.native.json'),
    JSON.stringify({ format: 3, files: { a: { asset: '../outside.moc3', size: 1 } } }),
  );
  await assert.rejects(buildLive2DPackageManifest(root, { entryPath: 'model.native.json' }), /escapes/);
});
