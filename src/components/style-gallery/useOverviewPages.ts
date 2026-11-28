import { type OverviewPage, unpackOverview } from '@lib/style-gallery-overview-payload';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Ordinary browsing pages complete stacks. Global operations can upgrade to the entire public revision. */
export function useOverviewPages(initial: OverviewPage) {
  const [examples, setExamples] = useState(() => unpackOverview(initial.payload));
  const [page, setPage] = useState(initial);
  const [failed, setFailed] = useState(false);
  const deleted = useRef(new Set<string>());
  const request = useRef<{ cursor: number | 'all'; controller: AbortController; task: Promise<void> } | null>(null);
  useEffect(
    () => () => {
      request.current?.controller.abort();
      request.current = null;
    },
    [],
  );
  const load = useCallback(
    (cursor: number | 'all'): Promise<void> => {
      if (page.full) return Promise.resolve();
      const previous = request.current;
      if (previous) {
        if (previous.cursor === cursor || previous.cursor === 'all') return previous.task;
        previous.controller.abort();
      }
      const controller = new AbortController();
      setFailed(false);
      const task = (async () => {
        try {
          const response = await fetch(
            '/api/style-gallery/overview-page?' + new URLSearchParams({ offset: String(cursor), revision: page.revision }),
            { signal: controller.signal },
          );
          if (!response.ok) throw Error('Gallery page unavailable');
          const next: OverviewPage = await response.json();
          if (controller.signal.aborted) return;
          const rows = unpackOverview(next.payload).filter((row) => !deleted.current.has(row.id));
          setExamples((current) => (next.full ? rows : [...current, ...rows]));
          setPage(next);
        } catch {
          if (!controller.signal.aborted) setFailed(true);
        } finally {
          if (request.current?.controller === controller) request.current = null;
        }
      })();
      request.current = { cursor, controller, task };
      return task;
    },
    [page.full, page.revision],
  );
  const remove = useCallback((id: string) => {
    deleted.current.add(id);
    setExamples((current) => current.filter((row) => row.id !== id));
  }, []);
  return { examples, page, failed, load, remove, removed: deleted.current };
}
