import { useEffect, useSyncExternalStore } from 'react';
import { type HpoiSnapshot, reconcileHpoiItems } from '@/lib/hpoi/snapshot';
import type { CollectionPage } from '@/types/collection-page';
import { HPOI_COLLECTION_STATES, type HpoiCollectionState } from '@/types/hpoi';

const EMPTY: HpoiSnapshot = { items: [], complete: false, savedAt: 0, loading: false, error: false };
const TTL = 30 * 60_000;
const KEY = 'hpoi-snapshots-v2';
const snapshots = new Map<HpoiCollectionState, HpoiSnapshot>();
const listeners = new Set<() => void>();
let hydrated = false;
let running = false;
let retryQueued = false;
let preferred: HpoiCollectionState = 'all';
const notify = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    for (const state of HPOI_COLLECTION_STATES) {
      const value = saved[state];
      if (
        value?.complete &&
        Number.isFinite(value.savedAt) &&
        Array.isArray(value.items) &&
        value.items.every(
          (item: { id?: unknown; title?: unknown }) => typeof item?.id === 'string' && typeof item.title === 'string',
        ) &&
        value.meta?.profile?.profileUrl &&
        Array.isArray(value.meta.warnings) &&
        Number.isFinite(Date.parse(value.meta.fetchedAt))
      ) {
        snapshots.set(state, { ...value, loading: false, error: false });
      }
    }
  } catch {
    /* Private browsing/quota/corrupt storage must not prevent live reads. */
  }
}

/** One bounded background crawler for all tabs. First pages are prioritized over deep pagination.
 * Completed per-category snapshots survive reloads; failed refreshes never erase a previous snapshot.
 * Hpoi exposes HTML pages, not a delta feed, so network refresh is full and reconciliation is by ID.
 */
async function refresh() {
  if (running) return;
  running = true;
  const work = new Map(
    HPOI_COLLECTION_STATES.filter((state) => {
      const old = snapshots.get(state);
      return !old?.error && (!old?.complete || Date.now() - old.savedAt > TTL);
    }).map((state) => [
      state,
      {
        next: `/api/hpoi?state=${state}` as string | null,
        items: [] as HpoiSnapshot['items'],
        meta: undefined as HpoiSnapshot['meta'],
        seen: new Set<string>(),
      },
    ]),
  );
  try {
    while (work.size && listeners.size) {
      const entries = [...work.entries()];
      // Switching to an unvisited tab moves its first page ahead of speculative reads.
      const candidate =
        entries.find(([s, w]) => s === preferred && !w.seen.size) ??
        entries.find(([, w]) => !w.seen.size) ??
        entries.find(([s]) => s === preferred) ??
        entries[0];
      const [state, crawl] = candidate;
      const prior = snapshots.get(state) ?? EMPTY;
      snapshots.set(state, { ...prior, loading: true, error: false });
      notify();
      try {
        const url = crawl.next;
        if (!url) throw new Error('Missing Hpoi cursor');
        if (crawl.seen.has(url) || crawl.seen.size >= 100) throw new Error('Invalid Hpoi cursor');
        crawl.seen.add(url);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Hpoi ${response.status}`);
        const page = (await response.json()) as CollectionPage<HpoiSnapshot['items'][number], HpoiSnapshot['meta']>;
        if (
          !Array.isArray(page.items) ||
          (page.next !== null && (typeof page.next !== 'string' || !page.next.startsWith(`/api/hpoi?state=${state}&`)))
        )
          throw new Error('Invalid Hpoi page');
        crawl.items.push(...page.items);
        crawl.meta ??= page.meta;
        crawl.next = page.next;
        if (!crawl.next) {
          snapshots.set(state, {
            items: reconcileHpoiItems(prior.items, crawl.items),
            meta: crawl.meta,
            complete: true,
            savedAt: Date.now(),
            loading: false,
            error: false,
          });
          work.delete(state);
          try {
            localStorage.setItem(KEY, JSON.stringify(Object.fromEntries([...snapshots].filter(([, s]) => s.complete))));
          } catch {
            /* Optional persistence. */
          }
        } else if (!prior.complete) {
          snapshots.set(state, {
            ...prior,
            items: reconcileHpoiItems(prior.items, crawl.items),
            meta: crawl.meta,
            loading: true,
          });
        }
      } catch {
        snapshots.set(state, { ...(snapshots.get(state) ?? EMPTY), loading: false, error: true });
        work.delete(state);
      }
      notify();
    }
  } finally {
    running = false;
    if (retryQueued && listeners.size) {
      retryQueued = false;
      void refresh();
    }
  }
}

export function useHpoiCollection(state: HpoiCollectionState) {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => snapshots.get(state) ?? EMPTY,
    () => EMPTY,
  );
  useEffect(() => {
    hydrate();
    preferred = state;
    notify();
    void refresh();
  }, [state]);
  return {
    ...snapshot,
    meta: snapshot.meta ?? snapshots.get('all')?.meta,
    loadMore: () => {
      const prior = snapshots.get(state) ?? EMPTY;
      snapshots.set(state, { ...prior, error: false, savedAt: 0 });
      notify();
      if (running) retryQueued = true;
      else void refresh();
    },
  };
}
