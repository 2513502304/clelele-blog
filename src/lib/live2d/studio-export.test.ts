import assert from 'node:assert/strict';
import test from 'node:test';
import { exportStudioScene, INITIAL_STUDIO_SCENE } from './studio-export';

test('PNG export rejects missing or ignored Canvas filters instead of silently changing the picture', async () => {
  class FakeImage {
    src = '';
    async decode() {}
  }
  const originals = new Map(['Image', 'document'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    Object.defineProperty(globalThis, 'Image', { configurable: true, value: FakeImage });
    for (const context of [
      {},
      {
        get filter() {
          return 'none';
        },
        set filter(_value: string) {},
      },
    ]) {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: { createElement: () => ({ getContext: () => context }) },
      });
      await assert.rejects(
        exportStudioScene('data:image/png;base64,', { ...INITIAL_STUDIO_SCENE, filter: 'film' }, 1),
        /Canvas filters unavailable/,
      );
    }
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
