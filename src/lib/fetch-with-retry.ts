export interface FetchWithRetryOptions {
  attempts?: number;
  timeoutMs?: number;
  initialBackoffMs?: number;
  fetcher?: typeof fetch;
  statusError?: (response: Response) => Error;
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_INITIAL_BACKOFF_MS = 300;

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

/**
 * 对 GET 请求统一应用超时、指数退避和可重试状态码规则。
 * 4xx（429 除外）直接交给调用方处理，避免重试确定性的客户端错误。
 */
export async function fetchWithRetry(input: string | URL, options: FetchWithRetryOptions = {}): Promise<Response> {
  const attempts = positiveInteger(options.attempts, DEFAULT_ATTEMPTS);
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const initialBackoffMs = positiveInteger(options.initialBackoffMs, DEFAULT_INITIAL_BACKOFF_MS);
  const fetcher = options.fetcher ?? fetch;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetcher(input, { signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok || (response.status < 500 && response.status !== 429)) return response;
      lastError = options.statusError?.(response) ?? new Error(`Request failed with ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, initialBackoffMs * 2 ** (attempt - 1)));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed after retries.');
}
