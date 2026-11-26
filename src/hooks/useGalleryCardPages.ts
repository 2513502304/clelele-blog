import { useCallback, useEffect, useRef, useState } from 'react';
import type { StyleGalleryCardData } from '@/types/style-gallery';

export interface GalleryCardPage {
  items: StyleGalleryCardData[];
  revision: string;
  total: number;
}

/** A full-list request supersedes a pending scroll page. Keep rendered rows available if a request fails. */
export function useGalleryCardPages(initial: GalleryCardPage) {
  const [page, setPage] = useState(initial);
  const [error, setError] = useState<'next' | 'all' | null>(null);
  const latest = useRef(initial);
  const inFlight = useRef<{ mode: 'next' | 'all'; controller: AbortController } | null>(null);
  useEffect(
    () => () => {
      inFlight.current?.controller.abort();
      inFlight.current = null;
    },
    [],
  );

  const load = useCallback(async (mode: 'next' | 'all') => {
    const current = latest.current;
    if (current.items.length >= current.total) return;
    if (inFlight.current && (inFlight.current.mode === 'all' || mode === 'next')) return;
    inFlight.current?.controller.abort();
    const controller = new AbortController();
    inFlight.current = { mode, controller };
    setError(null);
    const params =
      mode === 'all'
        ? new URLSearchParams({ all: '1' })
        : new URLSearchParams({ offset: String(current.items.length), revision: current.revision });
    try {
      const response = await fetch(`/api/style-gallery/cards?${params}`, { signal: controller.signal });
      if (!response.ok) throw new Error('Gallery page unavailable');
      const data: GalleryCardPage & { start: number } = await response.json();
      if (controller.signal.aborted) return;
      if (
        !Array.isArray(data.items) ||
        !Number.isSafeInteger(data.total) ||
        typeof data.revision !== 'string' ||
        data.start + data.items.length > data.total ||
        (data.start === 0 ? data.items.length !== data.total : mode === 'all' || data.items.length === 0) ||
        (data.start !== 0 && (data.start !== current.items.length || data.revision !== current.revision))
      )
        throw new Error('Invalid gallery page');
      const next = {
        items: data.start ? current.items.concat(data.items) : data.items,
        total: data.total,
        revision: data.revision,
      };
      latest.current = next;
      setPage(next);
    } catch {
      if (!controller.signal.aborted) setError(mode);
    } finally {
      if (inFlight.current?.controller === controller) inFlight.current = null;
    }
  }, []);
  return { ...page, complete: page.items.length >= page.total, load, error };
}
