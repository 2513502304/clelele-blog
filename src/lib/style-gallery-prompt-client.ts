import { getStyleGalleryPromptCacheKey } from './style-gallery-prompt-groups';

export interface StyleGalleryPromptChoice {
  id: string;
  prompt: string;
  model?: string;
  importedAt: string;
}

const promptCache = new Map<string, StyleGalleryPromptChoice[]>();
const promptRequests = new Map<string, Promise<StyleGalleryPromptChoice[]>>();
const PROMPT_REQUEST_TIMEOUT_MS = 15_000;

/** Refresh already-mounted islands after an edit, including their old SSR revision keys. */
export function publishStyleGalleryPromptChoices(slug: string, revision: string, prompts: StyleGalleryPromptChoice[]): void {
  const keys = new Set([getStyleGalleryPromptCacheKey(slug, revision), ...promptCache.keys(), ...promptRequests.keys()]);
  for (const key of keys) if (key.startsWith(`${slug}:`)) promptCache.set(key, prompts);
}

/** 所有 Gallery 入口共享候选缓存，避免列表预取、lightbox 和详情交互重复读取同一 item。 */
export async function loadStyleGalleryPromptChoices(slug: string, promptRevision: string): Promise<StyleGalleryPromptChoice[]> {
  const cacheKey = getStyleGalleryPromptCacheKey(slug, promptRevision);
  const cached = promptCache.get(cacheKey);
  if (cached) return cached;
  const pending = promptRequests.get(cacheKey);
  if (pending) return pending;

  const request = fetch(`/api/style-gallery/prompts/${encodeURIComponent(slug)}?v=${encodeURIComponent(promptRevision)}`, {
    credentials: 'same-origin',
    signal: AbortSignal.timeout(PROMPT_REQUEST_TIMEOUT_MS),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Prompt request failed with HTTP ${response.status}.`);
      const data = (await response.json()) as { prompts?: StyleGalleryPromptChoice[] };
      if (!data.prompts?.length) throw new Error('Prompt response was empty.');
      // An edit may have published newer choices while this read was in flight.
      const published = promptCache.get(cacheKey);
      if (published) return published;
      promptCache.set(cacheKey, data.prompts);
      return data.prompts;
    })
    .catch((error) => {
      const published = promptCache.get(cacheKey);
      if (published) return published;
      throw error;
    })
    .finally(() => promptRequests.delete(cacheKey));
  promptRequests.set(cacheKey, request);
  return request;
}

export async function loadStyleGalleryDefaultPrompt(slug: string, promptRevision: string): Promise<string> {
  const prompt = (await loadStyleGalleryPromptChoices(slug, promptRevision))[0];
  if (!prompt) throw new Error(`Style prompt not found: ${slug}`);
  return prompt.prompt;
}

export function getCachedStyleGalleryPromptChoices(
  slug: string,
  promptRevision: string,
): StyleGalleryPromptChoice[] | undefined {
  return promptCache.get(getStyleGalleryPromptCacheKey(slug, promptRevision));
}

export function resetStyleGalleryPromptClientCache(): void {
  promptCache.clear();
  promptRequests.clear();
}
