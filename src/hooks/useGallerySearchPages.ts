import { useCallback, useEffect, useRef, useState } from 'react';
import type { GalleryCardPage } from './useGalleryCardPages';

type Mode = 'next' | 'all';
type Result = GalleryCardPage & { key: string };

/** Delay text searches, cancel obsolete requests and keep a failed continuation retryable in place. */
export function useGallerySearchPages(key: string) {
  const [page, setPage] = useState<Result>();
  const [failure, setFailure] = useState<{ key: string; mode: Mode }>();
  const latest = useRef<Result | undefined>(undefined);
  const pending = useRef<{ controller: AbortController; mode: Mode } | undefined>(undefined);
  const load = useCallback(
    async (mode: Mode) => {
      if (!key) return;
      const current = latest.current?.key === key ? latest.current : undefined;
      if (current && current.items.length >= current.total) return;
      if (pending.current && (pending.current.mode === 'all' || mode === 'next')) return;
      pending.current?.controller.abort();
      const controller = new AbortController();
      pending.current = { controller, mode };
      const params = new URLSearchParams(key);
      if (mode === 'all') params.set('all', '1');
      else if (current) {
        params.set('offset', String(current.items.length));
        params.set('revision', current.revision);
      }
      setFailure(undefined);
      try {
        const response = await fetch(`/api/style-gallery/search?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Search unavailable');
        const data: GalleryCardPage & { start: number } = await response.json();
        if (controller.signal.aborted) return;
        if (
          !Array.isArray(data.items) ||
          !Number.isSafeInteger(data.total) ||
          data.total < 0 ||
          data.start + data.items.length > data.total ||
          (data.start !== 0 && (data.start !== current?.items.length || data.revision !== current?.revision))
        )
          throw new Error('Invalid search page');
        latest.current = { ...data, key, items: data.start && current ? [...current.items, ...data.items] : data.items };
        setPage(latest.current);
      } catch {
        if (!controller.signal.aborted) setFailure({ key, mode });
      } finally {
        if (pending.current?.controller === controller) pending.current = undefined;
      }
    },
    [key],
  );
  useEffect(() => {
    latest.current = undefined;
    setPage(undefined);
    setFailure(undefined);
    const timer = key ? window.setTimeout(() => void load('next'), 220) : undefined;
    return () => {
      window.clearTimeout(timer);
      pending.current?.controller.abort();
      pending.current = undefined;
    };
  }, [key, load]);
  const result = page?.key === key ? page : undefined;
  const error = failure?.key === key ? failure.mode : null;
  return {
    result,
    error,
    load,
    waiting: Boolean(key && !result && !error),
    complete: Boolean(result && result.items.length >= result.total),
  };
}
