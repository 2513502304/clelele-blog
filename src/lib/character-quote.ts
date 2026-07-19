import { z } from 'zod';

const YURIPPE_QUOTES_URL = 'https://yurippe.vercel.app/api/quotes';
const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

const yurippeResponseSchema = z.array(
  z.object({
    character: z.string().trim().min(1),
    quote: z.string().trim().min(1),
    show: z.string().trim().min(1),
  }),
);

export interface CharacterQuote {
  character: string;
  quote: string;
  show: string;
}

interface FetchCharacterQuoteOptions {
  cacheTtlMs?: number;
  fetcher?: typeof fetch;
  now?: () => number;
  random?: () => number;
  retries?: number;
  sleep?: (delayMs: number) => Promise<void>;
  timeoutMs?: number;
}

interface QuoteCacheEntry {
  expiresAt: number;
  quotes: CharacterQuote[];
}

const quoteCaches = new WeakMap<typeof fetch, Map<string, QuoteCacheEntry>>();
const inflightRequests = new WeakMap<typeof fetch, Map<string, Promise<CharacterQuote[]>>>();

export class CharacterQuoteError extends Error {
  readonly status: number;

  constructor(message: string, status = 503, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CharacterQuoteError';
    this.status = status;
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function getFetcherMap<T>(store: WeakMap<typeof fetch, Map<string, T>>, fetcher: typeof fetch): Map<string, T> {
  const existing = store.get(fetcher);
  if (existing) return existing;

  const created = new Map<string, T>();
  store.set(fetcher, created);
  return created;
}

async function requestCharacterQuotes(character: string, options: FetchCharacterQuoteOptions = {}): Promise<CharacterQuote[]> {
  const fetcher = options.fetcher ?? fetch;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const sleep = options.sleep ?? wait;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = new URL(YURIPPE_QUOTES_URL);
  url.searchParams.set('character', character);

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetcher(url, {
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });

      if (response.status === 404) {
        throw new CharacterQuoteError(`No Yurippe quote found for ${character}.`, 404);
      }
      if (!response.ok) {
        throw new CharacterQuoteError(
          `Yurippe returned HTTP ${response.status}.`,
          isRetryableStatus(response.status) ? 503 : 502,
        );
      }

      const quotes = yurippeResponseSchema.parse(await response.json());
      if (!quotes.length) throw new CharacterQuoteError(`No Yurippe quote found for ${character}.`, 404);
      return quotes;
    } catch (error) {
      if (error instanceof CharacterQuoteError && (error.status < 500 || error.status === 502)) throw error;
      if (attempt === retries) {
        throw new CharacterQuoteError('Yurippe is temporarily unavailable.', 503, { cause: error });
      }
      await sleep(250 * 2 ** attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new CharacterQuoteError('Yurippe is temporarily unavailable.');
}

/** Returns the validated quote collection, cached per character for the current server instance. */
export async function fetchCharacterQuotes(
  character: string,
  options: FetchCharacterQuoteOptions = {},
): Promise<CharacterQuote[]> {
  const normalizedCharacter = character.trim();
  if (!normalizedCharacter) throw new CharacterQuoteError('Character name is required.', 400);
  if (normalizedCharacter.length > 100) throw new CharacterQuoteError('Character name is too long.', 400);

  const fetcher = options.fetcher ?? fetch;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  const cache = getFetcherMap(quoteCaches, fetcher);
  const cached = cache.get(normalizedCharacter);
  const currentTime = now();
  if (cached && cached.expiresAt > currentTime) return cached.quotes;
  if (cached) cache.delete(normalizedCharacter);

  const pending = getFetcherMap(inflightRequests, fetcher);
  const existingRequest = pending.get(normalizedCharacter);
  if (existingRequest) return existingRequest;

  const request = requestCharacterQuotes(normalizedCharacter, options);
  pending.set(normalizedCharacter, request);

  try {
    const quotes = await request;
    if (cacheTtlMs > 0) cache.set(normalizedCharacter, { expiresAt: currentTime + cacheTtlMs, quotes });
    return quotes;
  } finally {
    pending.delete(normalizedCharacter);
  }
}

/** Selects one quote locally from the cached Yurippe collection. */
export async function fetchCharacterQuote(
  character: string,
  options: FetchCharacterQuoteOptions = {},
): Promise<CharacterQuote> {
  const quotes = await fetchCharacterQuotes(character, options);
  const randomValue = (options.random ?? Math.random)();
  const index = Math.min(quotes.length - 1, Math.max(0, Math.floor(randomValue * quotes.length)));
  return quotes[index];
}
