import assert from 'node:assert/strict';
import test from 'node:test';
import type { Live2DVoicePack } from './types';
import { createLive2DVoiceAudioPreloader, createLive2DVoiceIndexCache } from './voice-index';

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

test('an evicted stale voice failure cannot delete a newer request for the same release', async () => {
  const cache = createLive2DVoiceIndexCache(1);
  const first = voice('1'.repeat(64));
  const second = voice('2'.repeat(64));
  let rejectStale: ((reason?: unknown) => void) | undefined;
  let firstCalls = 0;
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes(first.releaseId)) {
      firstCalls += 1;
      if (firstCalls === 1) {
        return new Promise<Response>((_resolve, reject) => {
          rejectStale = reject;
        });
      }
    }
    return Response.json(index);
  };

  const stale = cache.get(first, fetchImpl);
  await cache.get(second, fetchImpl);
  await cache.get(first, fetchImpl);
  rejectStale?.(new Error('stale request failed'));
  await assert.rejects(stale, /stale request failed/);
  await cache.get(first, fetchImpl);
  assert.equal(firstCalls, 2);
});

test('prefetches unique character audio with bounded concurrency and reuses completed requests', async () => {
  const preloader = createLive2DVoiceAudioPreloader(4);
  const voiceIndex = {
    version: 1 as const,
    interactions: [
      {
        area: 'head',
        dialogues: [
          { text: 'text only' },
          { text: 'first', audio: 'audio/first.mp3' },
          { text: 'duplicate', audio: 'audio/first.mp3' },
          { text: 'second', audio: 'audio/second.mp3' },
        ],
      },
    ],
  };
  const urls: string[] = [];
  let active = 0;
  let maximumActive = 0;
  const fetchImpl: typeof fetch = async (input) => {
    urls.push(String(input));
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return new Response('audio');
  };
  const releaseId = 'f'.repeat(64);

  await preloader.prefetch(voiceIndex, releaseId, { fetchImpl, concurrency: 2 });
  await preloader.prefetch(voiceIndex, releaseId, { fetchImpl, concurrency: 2 });

  assert.equal(urls.length, 2);
  assert.equal(maximumActive, 2);
  assert.ok(urls.every((url) => url.includes(`/releases/${releaseId}/audio/`)));
});

test('drops failed audio prefetch entries so a later attempt can recover', async () => {
  const preloader = createLive2DVoiceAudioPreloader();
  const voiceIndex = {
    version: 1 as const,
    interactions: [{ area: 'head', dialogues: [{ text: 'line', audio: 'audio/line.mp3' }] }],
  };
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return new Response('', { status: calls === 1 ? 503 : 200 });
  };

  await preloader.prefetch(voiceIndex, 'a'.repeat(64), { fetchImpl });
  await preloader.prefetch(voiceIndex, 'a'.repeat(64), { fetchImpl });
  assert.equal(calls, 2);
});

test('an evicted stale audio failure cannot remove a newer completed preload', async () => {
  const preloader = createLive2DVoiceAudioPreloader(1);
  const firstRelease = '1'.repeat(64);
  const secondRelease = '2'.repeat(64);
  const voiceIndex = {
    version: 1 as const,
    interactions: [{ area: 'head', dialogues: [{ text: 'line', audio: 'audio/line.mp3' }] }],
  };
  let rejectStale: ((reason?: unknown) => void) | undefined;
  let firstCalls = 0;
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes(firstRelease)) {
      firstCalls += 1;
      if (firstCalls === 1) {
        return new Promise<Response>((_resolve, reject) => {
          rejectStale = reject;
        });
      }
    }
    return new Response('audio');
  };

  const stale = preloader.prefetch(voiceIndex, firstRelease, { fetchImpl });
  await preloader.prefetch(voiceIndex, secondRelease, { fetchImpl });
  await preloader.prefetch(voiceIndex, firstRelease, { fetchImpl });
  rejectStale?.(new Error('stale preload failed'));
  await stale;
  await preloader.prefetch(voiceIndex, firstRelease, { fetchImpl });
  assert.equal(firstCalls, 2);
});
