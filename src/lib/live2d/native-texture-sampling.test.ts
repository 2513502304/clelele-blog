import assert from 'node:assert/strict';
import test from 'node:test';
import { enableNativeMipmaps } from './native-texture-sampling';

test('minifies original single-level native textures with a trilinear mip chain', () => {
  const texture = {
    texture: 'original.png',
    width: 2048,
    height: 2048,
    mipCount: 1,
    settings: { m_FilterMode: 1, m_WrapU: 1 },
  };
  enableNativeMipmaps({ materials: [{ texture }] });
  assert.equal(texture.mipCount, 12);
  assert.deepEqual(texture.settings, { m_FilterMode: 2, m_WrapU: 1 });
  assert.equal(texture.texture, 'original.png');
  enableNativeMipmaps(texture);
  assert.equal(texture.mipCount, 12);
});

test('preserves authored mip chains, point sampling and unrelated render targets', () => {
  const data = [
    { mipCount: 1, width: 1024, height: 1024 },
    { texture: 'point.png', width: 64, height: 64, mipCount: 1, settings: { m_FilterMode: 0 } },
    { texture: 'mip.png', width: 64, height: 64, mipCount: 7, settings: { m_FilterMode: 1 } },
  ];
  const before = structuredClone(data);
  enableNativeMipmaps(data);
  assert.deepEqual(data, before);
});
