import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchMeting } from './meting';

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

test('normalizes common Meting fields and isolates caches by full API URL', async () => {
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
  globalThis.fetch = async (input) => {
    requestedUrls.push(String(input));
    return Response.json([
      {
        title: 'Song title',
        author: 'Artist name',
        url: `http://${new URL(String(input)).hostname}/audio?id=1`,
        pic: `http://${new URL(String(input)).hostname}/cover?id=1`,
        lrc: `http://${new URL(String(input)).hostname}/lyrics?id=1`,
      },
    ]);
  };

  try {
    const first = await fetchMeting('netease', 'playlist', '1', 'https://api.example.test/meting');
    const cached = await fetchMeting('netease', 'playlist', '1', 'https://api.example.test/meting');
    const otherPath = await fetchMeting('netease', 'playlist', '1', 'https://api.example.test/another-path');
    const otherOrigin = await fetchMeting('netease', 'playlist', '1', 'https://other.example.test/meting');

    assert.deepEqual(first, [
      {
        name: 'Song title',
        artist: 'Artist name',
        url: 'https://api.example.test/audio?id=1',
        pic: 'https://api.example.test/cover?id=1',
        lrc: 'https://api.example.test/lyrics?id=1',
      },
    ]);
    assert.deepEqual(cached, first);
    assert.equal(otherPath[0]?.url, 'https://api.example.test/audio?id=1');
    assert.equal(otherOrigin[0]?.url, 'https://other.example.test/audio?id=1');
    assert.equal(requestedUrls.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
    if (localStorageDescriptor) Object.defineProperty(globalThis, 'localStorage', localStorageDescriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
