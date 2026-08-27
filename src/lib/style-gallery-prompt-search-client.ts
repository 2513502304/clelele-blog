const SEARCH_INDEX_URL = '/api/style-gallery/prompt-search-index';
const SEARCH_INDEX_TIMEOUT_MS = 15_000;
const SEARCH_INDEX_CACHE_TTL_MS = 30 * 60_000;

let cachedSearchIndex: Record<string, string> | null = null;
let cachedSearchIndexExpiresAt = 0;
let pendingSearchIndex: Promise<Record<string, string>> | null = null;

/** 所有 Gallery 页面共享同一份按需请求；失败不缓存，后续输入或聚焦可以重试。 */
export async function loadStyleGalleryPromptSearchIndex(): Promise<Record<string, string>> {
  if (cachedSearchIndex && Date.now() < cachedSearchIndexExpiresAt) return cachedSearchIndex;
  if (pendingSearchIndex) return pendingSearchIndex;

  pendingSearchIndex = fetch(SEARCH_INDEX_URL, {
    credentials: 'same-origin',
    signal: AbortSignal.timeout(SEARCH_INDEX_TIMEOUT_MS),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Prompt search index request failed with HTTP ${response.status}.`);
      const data = (await response.json()) as unknown;
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Prompt search index was invalid.');
      const entries = Object.entries(data);
      if (entries.some(([sourceSlug, sourceText]) => !sourceSlug || typeof sourceText !== 'string')) {
        throw new Error('Prompt search index contained an invalid entry.');
      }
      cachedSearchIndex = Object.fromEntries(entries) as Record<string, string>;
      cachedSearchIndexExpiresAt = Date.now() + SEARCH_INDEX_CACHE_TTL_MS;
      return cachedSearchIndex;
    })
    .finally(() => {
      pendingSearchIndex = null;
    });
  return pendingSearchIndex;
}

export function resetStyleGalleryPromptSearchClientCache(): void {
  cachedSearchIndex = null;
  cachedSearchIndexExpiresAt = 0;
  pendingSearchIndex = null;
}
