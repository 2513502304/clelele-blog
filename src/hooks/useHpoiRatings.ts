import { useEffect, useState } from 'react';
import type { HpoiCollectionItem } from '@/types/hpoi';

const pending = new Map<string, Promise<Record<string, string | null>>>();
const CACHE_MS = 30 * 60 * 1000;

/** Reuse optional scores across overlapping categories; never retry a failed batch in a render loop. */
async function readRatings(ids: string[]) {
  const url = `/api/hpoi/ratings?ids=${[...ids].sort().join(',')}`;
  let request = pending.get(url);
  if (!request) {
    request = Promise.allSettled([...pending.values()])
      .then(() => fetch(url))
      .then(async (response) => {
        if (!response.ok) throw new Error('Ratings unavailable');
        const data = await response.json();
        const scores: Record<string, string | null> = {};
        for (const id of ids) {
          // Absent/invalid IDs are temporary failures, not a cacheable "unrated" result.
          if (data?.[id] !== null && !(typeof data?.[id] === 'string' && /^\d+(\.\d+)?$/.test(data[id]))) continue;
          scores[id] = data[id];
          try {
            sessionStorage.setItem(
              `hpoi-rating-v1:${id}`,
              JSON.stringify({ score: scores[id], expires: Date.now() + CACHE_MS }),
            );
          } catch {
            /* Optional storage. */
          }
        }
        return scores;
      })
      .finally(() => pending.delete(url));
    pending.set(url, request);
  }
  return request;
}

/** Covers render immediately. Scores arrive independently; callers may wait only for explicit score sorting. */
export function useHpoiRatings(items: HpoiCollectionItem[]) {
  const ids = items
    .filter((item) => !item.score)
    .map((item) => item.id)
    .join(',');
  const [state, setState] = useState<{
    ids: string;
    scores: Record<string, string | null>;
    pendingIds: Set<string>;
  }>({ ids: '', scores: {}, pendingIds: new Set() });
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const scores: Record<string, string | null> = {};
      const missing: string[] = [];
      for (const id of ids.split(',').filter(Boolean)) {
        try {
          const cached = JSON.parse(sessionStorage.getItem(`hpoi-rating-v1:${id}`) || 'null');
          if (cached?.expires > Date.now()) {
            scores[id] = cached.score;
            continue;
          }
        } catch {
          /* Optional storage. */
        }
        missing.push(id);
      }
      const pendingIds = new Set(missing);
      // Publish cached scores immediately, then settle each batch independently. A missing score in
      // a completed response is a failed lookup, not a reason to keep its loading indicator running.
      const publish = () => {
        if (!cancelled) setState({ ids, scores: { ...scores }, pendingIds: new Set(pendingIds) });
      };
      publish();
      // Serialize batches so rapid scrolling never starts an unbounded detail-request pool.
      for (let i = 0; i < missing.length && !cancelled; i += 24) {
        const batch = missing.slice(i, i + 24);
        try {
          Object.assign(scores, await readRatings(batch));
        } catch {
          for (const id of batch) scores[id] = null;
        }
        for (const id of batch) pendingIds.delete(id);
        publish();
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [ids]);
  // New cards must show pending on their first render, before the cache-reading effect runs.
  const pendingIds = state.ids === ids ? state.pendingIds : new Set(ids.split(',').filter(Boolean));
  return { scores: state.scores, pendingIds, loading: pendingIds.size > 0 };
}
