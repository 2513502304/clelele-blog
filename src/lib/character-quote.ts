import { z } from 'zod';

const YURIPPE_QUOTES_URL = 'https://yurippe.vercel.app/api/quotes';
const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_RETRIES = 2;

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
  fetcher?: typeof fetch;
  retries?: number;
  sleep?: (delayMs: number) => Promise<void>;
  timeoutMs?: number;
}

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

/** Fetches one random Yurippe quote with bounded retries and response validation. */
export async function fetchCharacterQuote(
  character: string,
  options: FetchCharacterQuoteOptions = {},
): Promise<CharacterQuote> {
  const normalizedCharacter = character.trim();
  if (!normalizedCharacter) throw new CharacterQuoteError('Character name is required.', 400);
  if (normalizedCharacter.length > 100) throw new CharacterQuoteError('Character name is too long.', 400);

  const fetcher = options.fetcher ?? fetch;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const sleep = options.sleep ?? wait;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = new URL(YURIPPE_QUOTES_URL);
  url.searchParams.set('character', normalizedCharacter);
  url.searchParams.set('random', '1');

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
        throw new CharacterQuoteError(`No Yurippe quote found for ${normalizedCharacter}.`, 404);
      }
      if (!response.ok) {
        throw new CharacterQuoteError(
          `Yurippe returned HTTP ${response.status}.`,
          isRetryableStatus(response.status) ? 503 : 502,
        );
      }

      const quotes = yurippeResponseSchema.parse(await response.json());
      const quote = quotes[0];
      if (!quote) throw new CharacterQuoteError(`No Yurippe quote found for ${normalizedCharacter}.`, 404);
      return quote;
    } catch (error) {
      if (error instanceof CharacterQuoteError && error.status < 500) throw error;
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
