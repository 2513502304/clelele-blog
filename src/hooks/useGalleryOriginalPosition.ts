import { locateStyleGalleryElement } from '@lib/style-gallery-lightbox-actions';
import { parseAsString, useQueryStates } from 'nuqs';
import { useCallback, useEffect, useState } from 'react';

interface OriginalPositionOptions<T> {
  items: T[];
  visibleCount: number;
  revealThrough: (index: number) => void;
  matchesTarget: (item: T, identity: string) => boolean;
  elementId: (item: T) => string;
  hasVisualFilter: boolean;
  clearVisualFilter: () => void;
}

/**
 * Restore a filtered card's neighborhood without changing sort, layout or grouping.
 * Wait for the unfiltered React commit before revealing a batch: a reveal against the
 * old list would be discarded by useProgressiveList's filter reset.
 */
export function useGalleryOriginalPosition<T>({
  items,
  visibleCount,
  revealThrough,
  matchesTarget,
  elementId,
  hasVisualFilter,
  clearVisualFilter,
}: OriginalPositionOptions<T>) {
  const [filters, setFilters] = useQueryStates({
    q: parseAsString.withDefault(''),
    tag: parseAsString.withDefault(''),
    from: parseAsString.withDefault(''),
    to: parseAsString.withDefault(''),
    platform: parseAsString.withDefault('all'),
  });
  const [target, setTarget] = useState<string | null>(null);
  const [visualResetKey, setVisualResetKey] = useState(0);
  const hasFilters =
    Boolean(filters.q.trim() || filters.tag || filters.from || filters.to) || filters.platform !== 'all' || hasVisualFilter;

  const locateOriginal = useCallback(
    (identity: string) => {
      setTarget(identity);
      clearVisualFilter();
      // Remounting clears the visual filter badge/input and aborts any pending search.
      // Its generation guard also prevents a late feature/result from reapplying filters.
      setVisualResetKey((key) => key + 1);
      void setFilters({ q: null, tag: null, from: null, to: null, platform: null }).catch((error: unknown) => {
        setTarget(null);
        console.error('Failed to restore the unfiltered gallery:', error);
      });
    },
    [clearVisualFilter, setFilters],
  );

  useEffect(() => {
    if (target === null || hasFilters) return;
    const index = items.findIndex((item) => matchesTarget(item, target));
    if (index < 0) {
      setTarget(null);
      return;
    }
    if (index >= visibleCount) {
      revealThrough(index);
      return;
    }
    // Grid layout effects have placed the newly mounted cards before this runs.
    // Resolve the representative *after* clearing filters: a folded group's cover
    // can change when previously hidden members rejoin it.
    locateStyleGalleryElement(elementId(items[index]));
    setTarget(null);
  }, [elementId, hasFilters, items, matchesTarget, revealThrough, target, visibleCount]);

  return { hasFilters, locateOriginal, visualResetKey };
}
