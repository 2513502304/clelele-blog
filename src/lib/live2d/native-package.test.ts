import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeModelAssets } from './native-package';

test('supports both uncompressed three-field parts and compressed four-field parts', () => {
  const assets = nativeModelAssets({
    format: 3,
    files: {
      'prefab.json': {
        parts: [
          ['nodes', 'assets/a.json', 100],
          ['canvas', 'assets/b.json.gz', 200, 50],
        ],
        size: 310,
      },
    },
  });
  assert.deepEqual(assets, [
    { path: 'assets/a.json', size: 100, decodedSize: 100 },
    { path: 'assets/b.json.gz', size: 50, decodedSize: 200 },
  ]);
  assert.throws(
    () => nativeModelAssets({ format: 3, files: { a: { asset: 'same', size: 10 }, b: { asset: 'same', size: 20 } } }),
    /Conflicting/,
  );
});
