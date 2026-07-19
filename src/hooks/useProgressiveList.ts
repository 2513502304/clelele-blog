import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface ProgressiveListOptions {
  initialCount: number;
  batchSize: number;
  resetKey: string;
  rootMargin?: string;
}

interface ProgressiveListState {
  resetKey: string;
  count: number;
}

/** Progressively mounts large collections before the user reaches their end. */
export function useProgressiveList<T>(items: T[], options: ProgressiveListOptions) {
  const { initialCount, batchSize, resetKey, rootMargin = '800px 0px' } = options;
  const [state, setState] = useState<ProgressiveListState>(() => ({ resetKey, count: initialCount }));
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const visibleCount = state.resetKey === resetKey ? state.count : initialCount;
  const hasMore = visibleCount < items.length;

  const loadMore = useCallback(() => {
    setState((current) => {
      const currentCount = current.resetKey === resetKey ? current.count : initialCount;
      return { resetKey, count: Math.min(items.length, currentCount + batchSize) };
    });
  }, [batchSize, initialCount, items.length, resetKey]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!hasMore || !target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { rootMargin },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loadMore, rootMargin]);

  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  return { hasMore, loadMore, loadMoreRef, visibleItems };
}
