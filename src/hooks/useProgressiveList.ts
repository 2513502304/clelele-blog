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

/**
 * 分批挂载大型列表，并在观察点进入预加载距离时自动扩充下一批。
 * 筛选或排序改变 `resetKey` 后立即回到首批，既稳定网格顺序，也避免一次创建全部图片节点。
 */
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
