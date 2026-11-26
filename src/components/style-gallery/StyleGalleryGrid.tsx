import { Icon } from '@iconify/react';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { getMasonryPositions } from '@/lib/style-gallery-layout';

/** URL state makes the display choice shareable and restores it on back navigation. */
export function useStyleGalleryLayout() {
  return useQueryState('layout', parseAsStringLiteral(['grid', 'masonry'] as const).withDefault('masonry'));
}

/** The caller owns layout state; color and a decorative check mirror the same accessible pressed state. */
export function StyleGalleryLayoutToggle({
  masonry,
  onChange,
  locale,
}: {
  masonry: boolean;
  onChange: () => void;
  locale: string;
}) {
  const label = locale.startsWith('zh') ? '瀑布流' : locale.startsWith('ja') ? 'ウォーターフォール表示' : 'Masonry view';
  return (
    <button
      type="button"
      aria-pressed={masonry}
      onClick={onChange}
      className="gallery-view-toggle inline-flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-sm"
    >
      <Icon icon="ri:layout-masonry-line" className="size-4" />
      {label}
      <span className="gallery-toggle-status" aria-hidden="true">
        {masonry ? '✓' : ''}
      </span>
    </button>
  );
}

/**
 * Keep DOM/filter/lightbox order and row-major column assignment intact.
 * Gallery images reserve height from metadata; external collection covers may acquire their
 * intrinsic ratio after loading. ResizeObserver measures either change without per-image listeners. Appending cards leaves
 * existing positions intact. Without JS this remains an ordinary readable grid.
 */
export default function StyleGalleryGrid({ children, masonry = false }: { children: ReactNode; masonry?: boolean }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const syncRef = useRef(() => {});
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    let cards: HTMLElement[] = [];
    const heights = new Map<HTMLElement, number>();
    let previousWidth = -1;
    let previousColumns = -1;
    let previousGap = -1;
    let previousCardWidth = -1;
    const tops: number[] = [];
    const write = (element: HTMLElement, property: string, value: string) => {
      if (element.style.getPropertyValue(property) !== value) element.style.setProperty(property, value);
    };
    const arrange = (firstChanged = 0, remeasure = false) => {
      if (!masonry) return;
      const style = getComputedStyle(grid);
      const columns = style.gridTemplateColumns.split(' ').length;
      const gap = Number.parseFloat(style.columnGap) || 16;
      const width = grid.clientWidth;
      if (!width) return;
      // Preserve the scroll extent while first moving the cards out of grid flow.
      if (!grid.style.height) grid.style.height = `${grid.offsetHeight}px`;
      previousWidth = width;
      const cardWidth = (width - gap * (columns - 1)) / columns;
      const widthChanged = cardWidth !== previousCardWidth;
      // Earlier rows retain their coordinates on append and on late image resizes.
      // Restart at a whole row so each column can resume from its predecessor.
      const start =
        widthChanged || remeasure || columns !== previousColumns || gap !== previousGap
          ? 0
          : Math.floor(firstChanged / columns) * columns;
      previousCardWidth = cardWidth;
      previousColumns = columns;
      previousGap = gap;
      const changed = cards.slice(start);
      for (const card of changed) {
        write(card, 'position', 'absolute');
        write(card, 'width', `${cardWidth}px`);
      }
      for (const card of changed) {
        if (widthChanged || remeasure || !heights.has(card)) heights.set(card, card.offsetHeight);
      }
      const columnStarts = start
        ? cards
            .slice(start - columns, start)
            .map((card, column) => tops[start - columns + column] + (heights.get(card) ?? 0) + gap)
        : undefined;
      const { positions, height } = getMasonryPositions(
        changed.map((card) => heights.get(card) ?? 0),
        columns,
        gap,
        columnStarts,
      );
      tops.length = cards.length;
      changed.forEach((card, index) => {
        tops[start + index] = positions[index].top;
        write(card, 'left', `${positions[index].column * (cardWidth + gap)}px`);
        write(card, 'top', `${positions[index].top}px`);
      });
      write(grid, 'height', `${height}px`);
    };
    const observer = new ResizeObserver((entries) => {
      let firstChanged = grid.clientWidth !== previousWidth ? 0 : Infinity;
      for (const entry of entries) {
        if (entry.target === grid) continue;
        const card = entry.target as HTMLElement;
        if (!heights.has(card)) continue;
        const height = Math.round(entry.borderBoxSize[0]?.blockSize ?? card.offsetHeight);
        if (heights.get(card) !== height) {
          heights.set(card, height);
          firstChanged = Math.min(firstChanged, cards.indexOf(card));
        }
      }
      if (Number.isFinite(firstChanged)) arrange(firstChanged);
    });
    // Keep artwork/text mounted and painted on reverse scrolling. Only distant
    // glass controls stop requesting backdrop surfaces; overscan restores their
    // normal appearance before they reach the viewport, without scroll handlers.
    const proximity =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                (entry.target as HTMLElement).dataset.galleryNearViewport = String(entry.isIntersecting);
              }
            },
            { rootMargin: '1200px 0px' },
          );
    const sync = () => {
      const next = Array.from(grid.children) as HTMLElement[];
      let prefix = 0;
      while (prefix < next.length && next[prefix] === cards[prefix]) prefix++;
      if (prefix === next.length && prefix === cards.length) return;
      const retained = new Set(next);
      for (const card of cards) {
        if (retained.has(card)) continue;
        observer.unobserve(card);
        proximity?.unobserve(card);
        heights.delete(card);
        delete card.dataset.galleryNearViewport;
      }
      const existing = new Set(cards);
      for (const card of next) {
        if (existing.has(card)) continue;
        if (masonry) observer.observe(card, { box: 'border-box' });
        proximity?.observe(card);
      }
      cards = next;
      arrange(prefix);
    };
    syncRef.current = sync;
    sync();
    // Density changes the gutter without changing container width or card text height.
    const readingChanged = () => arrange(0, true);
    window.addEventListener('reading-change', readingChanged);
    if (masonry) observer.observe(grid);
    return () => {
      syncRef.current = () => {};
      observer.disconnect();
      proximity?.disconnect();
      window.removeEventListener('reading-change', readingChanged);
      grid.style.removeProperty('height');
      for (const card of cards) {
        delete card.dataset.galleryNearViewport;
        for (const property of ['position', 'width', 'left', 'top']) card.style.removeProperty(property);
      }
    };
  }, [masonry]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Sync DOM membership after React appends, filters or reorders children.
  useLayoutEffect(() => syncRef.current(), [children, masonry]);

  return (
    <div
      ref={gridRef}
      data-gallery-marquee-area
      data-gallery-layout={masonry ? 'masonry' : 'grid'}
      className="relative grid grid-cols-4 items-start gap-4 md:grid-cols-1 min-[1800px]:grid-cols-5 min-[2200px]:grid-cols-6 min-[3000px]:grid-cols-8 [@media(min-width:769px)_and_(max-width:992px)]:grid-cols-2 [@media(min-width:993px)_and_(max-width:1279px)]:grid-cols-3"
    >
      {children}
    </div>
  );
}
