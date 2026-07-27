import type { Live2DVoiceIndex, Live2DVoicePack } from './types';
import { live2dVoiceIndexSchema } from './types';

const DEFAULT_CACHE_SIZE = 8;

function assetUrl(entryPath: string): string {
  return `/api/live2d-assets/${entryPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
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
