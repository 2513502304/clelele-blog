import assert from 'node:assert/strict';
import test from 'node:test';
import type { Live2DVoicePack } from './types';
import { createLive2DVoiceIndexCache } from './voice-index';

function voice(releaseId: string, dialogueCount = 1): Live2DVoicePack {
  return {
    releaseId,
    entryPath: `releases/${releaseId}/dialogues.json`,
    packageBytes: 100,
    dialogueCount,
    provenancePath: `provenance/${releaseId}.json`,
  };
}

const index = {
  version: 1 as const,
  interactions: [{ area: 'head', dialogues: [{ text: '台词' }] }],
};

test('coalesces voice-index reads and bounds the character cache', async () => {
  const cache = createLive2DVoiceIndexCache(1);
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return Response.json(index);
  };
  const first = voice('a'.repeat(64));
  const second = voice('b'.repeat(64));

  const [left, right] = await Promise.all([cache.get(first, fetchImpl), cache.get(first, fetchImpl)]);
  assert.deepEqual(left, index);
  assert.deepEqual(right, index);
  assert.equal(calls, 1);
  await cache.get(second, fetchImpl);
  await cache.get(first, fetchImpl);
  assert.equal(calls, 3, 'the one-entry LRU should evict the first character after loading the second');
});

test('rejects mismatched release paths and dialogue counts', async () => {
  const cache = createLive2DVoiceIndexCache();
  const fetchImpl: typeof fetch = async () => Response.json(index);
  const releaseId = 'c'.repeat(64);

  await assert.rejects(
    cache.get({ ...voice(releaseId), entryPath: `releases/${'d'.repeat(64)}/dialogues.json` }, fetchImpl),
    /does not belong/,
  );
  await assert.rejects(cache.get(voice('e'.repeat(64), 2), fetchImpl), /count does not match/);
});
