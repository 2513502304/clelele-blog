import { useEffect, useRef, useState } from 'react';
import type { CollectionPage } from '@/types/collection-page';

const CACHE_MS = 30 * 60 * 1000;
const pending = new Map<string, Promise<CollectionPage<unknown, unknown>>>();

/** Validate both persisted and fetched pages before a cursor can poison the retry cache. */
function isCollectionPage(page: unknown, url: string): page is CollectionPage<unknown, unknown> {
  if (!page || typeof page !== 'object') return false;
  const value = page as Partial<CollectionPage<unknown, unknown>>;
  return (
    Array.isArray(value.items) &&
    (value.next === null || (typeof value.next === 'string' && /^\/api\/(hpoi|bangumi)\?/.test(value.next))) &&
    value.next !== url
  );
}

/** Only public collection pages are cached. Failed requests are never persisted or automatically retried. */
async function readPage<T, M>(url: string): Promise<CollectionPage<T, M>> {
  const key = `collection-page-v1:${url}`;
  try {
    const cached = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (cached?.expires > Date.now() && isCollectionPage(cached.page, url)) return cached.page as CollectionPage<T, M>;
  } catch {
    /* Storage is optional. */
  }
  let request = pending.get(url);
  if (!request) {
    request = fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Collection HTTP ${response.status}`);
        const page = await response.json();
        if (!isCollectionPage(page, url)) throw new Error('Invalid collection page or non-advancing cursor');
        try {
          sessionStorage.setItem(key, JSON.stringify({ expires: Date.now() + CACHE_MS, page }));
        } catch {
          /* Quota full. */
        }
        return page;
      })
      .finally(() => pending.delete(url));
    pending.set(url, request);
  }
  return request as Promise<CollectionPage<T, M>>;
}

/** Fetch on demand, retaining order and removing overlapping IDs. A filter or global sort
 * can request completion of the active collection; it never fetches unrelated tabs.
 * Each effect owns its cancellation flag so old tab requests cannot replace newer results.
 */
export function useProgressiveCollection<T, M>(url: string, identity: (item: T) => string | number, complete: boolean) {
  const [snapshot, setSnapshot] = useState<{ url: string; items: T[]; next: string | null; total?: number; meta?: M }>({
    url,
    items: [],
    next: url,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [request, setRequest] = useState(0);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const current = snapshot.url === url ? snapshot : { url, items: [], next: url };
  const next = current.next;
  const isInitial = snapshot.url !== url || next === url;
  const requestRef = useRef(request);
  useEffect(() => {
    if (!next || (!isInitial && !complete && requestRef.current === request)) {
      setLoading(false);
      return;
    }
    requestRef.current = request;
    let cancelled = false;
    setLoading(true);
    setError(false);
    readPage<T, M>(next)
      .then((page) => {
        if (cancelled) return;
        setSnapshot((previous) => {
          const prior = previous.url === url ? previous : { url, items: [] as T[], next: url };
          return {
            url,
            items: [...new Map([...prior.items, ...page.items].map((item) => [identityRef.current(item), item])).values()],
            next: page.next,
            total: page.total ?? prior.total,
            meta: prior.meta ?? page.meta,
          };
        });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url, next, isInitial, complete, request]);
  return {
    ...current,
    loading: loading || (isInitial && !error),
    error,
    loadMore: () => setRequest((value) => value + 1),
    complete: next === null,
  };
}
