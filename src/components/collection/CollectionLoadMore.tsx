import { useEffect, useRef } from 'react';

/** Keep an explicit retry/load button for keyboard users and browsers without IntersectionObserver. */
export function CollectionLoadMore({
  more,
  loading,
  error,
  onLoad,
  locale,
  rootMargin = '160px',
}: {
  more: boolean;
  loading: boolean;
  error: boolean;
  onLoad: () => void;
  locale: string;
  rootMargin?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onLoad);
  callback.current = onLoad;
  useEffect(() => {
    if (!more || loading || error || !ref.current || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) callback.current();
      },
      { rootMargin },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [more, loading, error, rootMargin]);
  const zh = locale.startsWith('zh'),
    ja = locale.startsWith('ja');
  if (!more && !error) return null;
  return (
    <div ref={ref} className="flex justify-center py-4" aria-live="polite">
      <button
        type="button"
        disabled={loading}
        onClick={onLoad}
        className="rounded-full border border-border bg-card px-5 py-2 text-muted-foreground text-sm disabled:opacity-60"
      >
        {loading
          ? zh
            ? '正在加载…'
            : ja
              ? '読み込み中…'
              : 'Loading…'
          : error
            ? zh
              ? '加载失败，点击重试'
              : ja
                ? '再試行'
                : 'Retry loading'
            : zh
              ? '继续加载'
              : ja
                ? 'さらに読み込む'
                : 'Load more'}
      </button>
    </div>
  );
}
