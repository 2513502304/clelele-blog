import { Icon } from '@iconify/react';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { getMasonryPositions } from '@/lib/style-gallery-layout';

/** URL state makes the display choice shareable and restores it on back navigation. */
export function useStyleGalleryLayout() {
  return useQueryState('layout', parseAsStringLiteral(['grid', 'masonry'] as const).withDefault('masonry'));
}

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
      className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm transition hover:border-primary/40 aria-pressed:border-primary aria-pressed:text-primary"
    >
      <Icon icon="ri:layout-masonry-line" className="size-4" />
      {label}
    </button>
  );
}

/**
 * Keep DOM/filter/lightbox order and row-major column assignment intact.
 * Image aspect ratios reserve their height before requests start. Only container/text
 * sizes are measured; image load events never control layout. Appending cards leaves
 * existing positions intact. Without JS this remains an ordinary readable grid.
 */
export default function StyleGalleryGrid({ children, masonry = false }: { children: ReactNode; masonry?: boolean }) {
  const gridRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new child list must rebind observers after filtering or appending.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const cards = Array.from(grid.children) as HTMLElement[];
    if (!masonry) {
      grid.style.removeProperty('height');
      for (const card of cards) {
        for (const property of ['position', 'width', 'left', 'top']) card.style.removeProperty(property);
      }
      return;
    }
    // Never let the container collapse between appends: reading absolute card geometry
    // flushes layout, and a transient zero height clamps the document's scroll position.
    if (!grid.style.height) grid.style.height = `${grid.offsetHeight}px`;
    let previousWidth = -1;
    const arrange = () => {
      const style = getComputedStyle(grid);
      const columns = style.gridTemplateColumns.split(' ').length;
      const gap = Number.parseFloat(style.columnGap) || 16;
      const width = grid.clientWidth;
      if (!width) return;
      previousWidth = width;
      const cardWidth = (width - gap * (columns - 1)) / columns;
      // Write widths together before reading heights to avoid per-card forced layouts.
      for (const card of cards) {
        card.style.position = 'absolute';
        card.style.width = `${cardWidth}px`;
      }
      const { positions, height } = getMasonryPositions(
        cards.map((card) => card.offsetHeight),
        columns,
        gap,
      );
      cards.forEach((card, index) => {
        card.style.left = `${positions[index].column * (cardWidth + gap)}px`;
        card.style.top = `${positions[index].top}px`;
      });
      grid.style.height = `${height}px`;
    };
    arrange();
    const observer = new ResizeObserver((entries) => {
      if (entries.some((entry) => entry.target !== grid) || grid.clientWidth !== previousWidth) arrange();
    });
    observer.observe(grid);
    for (const card of cards) observer.observe(card);
    return () => {
      observer.disconnect();
    };
  }, [children, masonry]);

  return (
    <div
      ref={gridRef}
      data-gallery-marquee-area
      data-gallery-layout={masonry ? 'masonry' : 'grid'}
      className="relative grid grid-cols-4 items-start gap-4 md:grid-cols-1 [@media(min-width:769px)_and_(max-width:992px)]:grid-cols-2 [@media(min-width:993px)_and_(max-width:1279px)]:grid-cols-3"
    >
      {children}
    </div>
  );
}
