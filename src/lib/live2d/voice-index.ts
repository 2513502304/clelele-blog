import type { Live2DVoiceIndex, Live2DVoicePack } from './types';
import { live2dVoiceIndexSchema } from './types';

const DEFAULT_CACHE_SIZE = 8;
const DEFAULT_AUDIO_CACHE_SIZE = 64;
const DEFAULT_AUDIO_PREFETCH_CONCURRENCY = 2;
const MAX_AUDIO_PREFETCH_CONCURRENCY = 4;

function assetUrl(entryPath: string): string {
  return `/api/live2d-assets/${entryPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
}

async function consumeResponse(response: Response): Promise<void> {
  if (!response.ok) throw new Error(`Live2D voice prefetch failed with status ${response.status}.`);
  if (!response.body) {
    await response.arrayBuffer();
    return;
  }
  const reader = response.body.getReader();
  try {
    while (!(await reader.read()).done) {
      // 完整消费响应后交给浏览器有界 HTTP 缓存；JS 堆不保留音频字节。
    }
  } finally {
    reader.releaseLock();
  }
}

function dialogueCount(index: Live2DVoiceIndex): number {
  return index.interactions.reduce(
    (total, interaction) => total + (interaction.dialogues?.length ?? interaction.lines?.length ?? 0),
    0,
  );
}

/**
 * Keeps a small LRU of character dialogue indexes. Audio remains browser-streamed on demand and is never retained here.
 */
export function createLive2DVoiceIndexCache(maximumEntries = DEFAULT_CACHE_SIZE) {
  if (!Number.isInteger(maximumEntries) || maximumEntries < 1) throw new Error('Voice cache size must be positive.');
  const cache = new Map<string, Promise<Live2DVoiceIndex>>();

  function touch(releaseId: string, value: Promise<Live2DVoiceIndex>): void {
    cache.delete(releaseId);
    cache.set(releaseId, value);
    while (cache.size > maximumEntries) cache.delete(cache.keys().next().value as string);
  }

  function get(voice: Live2DVoicePack, fetchImpl: typeof fetch = fetch): Promise<Live2DVoiceIndex> {
    const cached = cache.get(voice.releaseId);
    if (cached) {
      touch(voice.releaseId, cached);
      return cached;
    }
    if (!voice.entryPath.startsWith(`releases/${voice.releaseId}/`)) {
      return Promise.reject(new Error('Voice entry path does not belong to its release.'));
    }
    const request = fetchImpl(assetUrl(voice.entryPath), { headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Live2D voice index request failed with status ${response.status}.`);
        const index = live2dVoiceIndexSchema.parse(await response.json());
        if (dialogueCount(index) !== voice.dialogueCount) {
          throw new Error(`Live2D voice index count does not match release ${voice.releaseId}.`);
        }
        return index;
      })
      .catch((error) => {
        cache.delete(voice.releaseId);
        throw error;
      });
    touch(voice.releaseId, request);
    return request;
  }

  return { get };
}

export const live2dVoiceIndexCache = createLive2DVoiceIndexCache();

export interface Live2DVoiceAudioPrefetchOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  concurrency?: number;
}

/**
 * 只记录少量不可变 URL 的完成状态，实际音频由浏览器 HTTP 缓存管理。失败或取消的请求
 * 会从索引移除，因此之后的真实播放仍可走原有按需加载路径。
 */
export function createLive2DVoiceAudioPreloader(maximumEntries = DEFAULT_AUDIO_CACHE_SIZE) {
  if (!Number.isInteger(maximumEntries) || maximumEntries < 1) throw new Error('Audio cache size must be positive.');
  const cache = new Map<string, Promise<void>>();

  function touch(url: string, value: Promise<void>): void {
    cache.delete(url);
    cache.set(url, value);
    while (cache.size > maximumEntries) cache.delete(cache.keys().next().value as string);
  }

  function preload(url: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<void> {
    const cached = cache.get(url);
    if (cached) {
      touch(url, cached);
      return cached;
    }
    const request = fetchImpl(url, {
      cache: 'force-cache',
      credentials: 'same-origin',
      signal,
    })
      .then(consumeResponse)
      .catch((error) => {
        cache.delete(url);
        throw error;
      });
    touch(url, request);
    return request;
  }

  async function prefetch(
    index: Live2DVoiceIndex,
    releaseId: string,
    options: Live2DVoiceAudioPrefetchOptions = {},
  ): Promise<void> {
    const urls = [
      ...new Set(
        index.interactions.flatMap((interaction) =>
          (interaction.dialogues ?? [])
            .map((dialogue) => dialogue.audio)
            .filter((audio): audio is string => Boolean(audio))
            .map((audio) => assetUrl(`releases/${releaseId}/${audio}`)),
        ),
      ),
    ];
    const concurrency = Math.max(
      1,
      Math.min(MAX_AUDIO_PREFETCH_CONCURRENCY, Math.floor(options.concurrency ?? DEFAULT_AUDIO_PREFETCH_CONCURRENCY)),
    );
    let cursor = 0;
    const worker = async () => {
      while (!options.signal?.aborted) {
        const url = urls[cursor++];
        if (!url) return;
        try {
          await preload(url, options.fetchImpl ?? fetch, options.signal);
        } catch {
          if (options.signal?.aborted) return;
          // 预热失败不影响点击时的原生 Audio 按需加载和错误恢复。
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()));
  }

  return { prefetch };
}

export const live2dVoiceAudioPreloader = createLive2DVoiceAudioPreloader();
