import { Icon } from '@iconify/react';
import { useMemo, useState } from 'react';
import type { StyleGalleryCardData } from '@/types/style-gallery';

interface StyleGalleryImageIndexProps {
  items: StyleGalleryCardData[];
  galleryBasePath: string;
  labels: StyleGalleryImageIndexLabels;
}

export interface StyleGalleryImageIndexLabels {
  searchPlaceholder: string;
  sortItems: string;
  sortDefault: string;
  sortImportedAt: string;
  sortImageId: string;
  sortExampleCount: string;
  sortAscending: string;
  sortDescending: string;
  imageCount: string;
  noMatches: string;
  view: string;
}

type SortKey = 'default' | 'date' | 'id' | 'examples';
type SortDirection = 'asc' | 'desc';

function normalize(value: string) {
  return value.toLowerCase().trim();
}

export default function StyleGalleryImageIndex({ items, galleryBasePath, labels }: StyleGalleryImageIndexProps) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('default');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const sortLabels: Record<SortKey, string> = {
    default: labels.sortDefault,
    date: labels.sortImportedAt,
    id: labels.sortImageId,
    examples: labels.sortExampleCount,
  };

  const visibleItems = useMemo(() => {
    const normalizedQuery = normalize(query);
    const filtered = normalizedQuery
      ? items.filter((item) =>
          normalize(`${item.title} ${item.prompt} ${item.imageHash} ${item.slug}`).includes(normalizedQuery),
        )
      : items;
    const sorted = [...filtered];

    if (sortKey !== 'default') {
      sorted.sort((a, b) => {
        if (sortKey === 'id') return a.imageHash.localeCompare(b.imageHash);
        if (sortKey === 'examples') return a.exampleCount - b.exampleCount || a.date.localeCompare(b.date);
        return a.date.localeCompare(b.date);
      });
    }

    return sortDirection === 'desc' ? sorted.reverse() : sorted;
  }, [items, query, sortDirection, sortKey]);

  return (
    <section className="space-y-4" aria-label="Image style prompt gallery index">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-background/85 p-3 shadow-sm md:flex-col md:items-stretch">
        <label className="relative min-w-52 flex-1 md:min-w-0">
          <Icon icon="ri:search-line" className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={labels.searchPlaceholder}
            className="h-10 w-full rounded-md border border-border bg-background pr-3 pl-9 text-sm outline-none transition-colors focus:border-primary"
          />
        </label>

        <div className="flex items-center gap-2 md:justify-between">
          <span className="shrink-0 text-muted-foreground text-sm tabular-nums">
            {visibleItems.length} / {items.length}
          </span>
          <label htmlFor="style-gallery-index-sort" className="sr-only">
            {labels.sortItems}
          </label>
          <div className="relative min-w-40 md:ml-auto">
            <select
              id="style-gallery-index-sort"
              value={sortKey}
              onChange={(event) => setSortKey(event.currentTarget.value as SortKey)}
              className="h-10 w-full appearance-none rounded-md border border-border bg-background pr-8 pl-3 text-sm outline-none transition-colors hover:border-primary/40 focus:border-primary"
            >
              {(Object.keys(sortLabels) as SortKey[]).map((key) => (
                <option key={key} value={key}>
                  {sortLabels[key]}
                </option>
              ))}
            </select>
            <Icon
              icon="ri:arrow-down-s-line"
              className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
            />
          </div>
          <button
            type="button"
            title={sortDirection === 'asc' ? labels.sortAscending : labels.sortDescending}
            aria-label={sortDirection === 'asc' ? labels.sortAscending : labels.sortDescending}
            onClick={() => setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'))}
            className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <Icon icon={sortDirection === 'asc' ? 'ri:sort-asc' : 'ri:sort-desc'} className="size-4" />
          </button>
        </div>
      </div>

      {visibleItems.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2.5 md:grid-cols-[repeat(auto-fill,minmax(76px,1fr))] md:gap-2">
          {visibleItems.map((item, index) => (
            <a
              key={item.slug}
              href={`${galleryBasePath}/${item.slug}`}
              data-astro-prefetch="false"
              className="group relative aspect-square min-w-0 overflow-hidden rounded-md border border-border bg-muted shadow-sm transition hover:z-10 hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={`${labels.view}: ${item.title}`}
              title={item.title}
            >
              <img
                src={item.thumbnailImage ?? item.sourceImage}
                alt={item.sourceImageAlt ?? item.title}
                loading={index < 24 ? 'eager' : 'lazy'}
                decoding="async"
                className="h-full w-full object-cover transition duration-200 group-hover:scale-105"
              />
              <span className="absolute top-1 left-1 rounded-sm bg-black/65 px-1 py-0.5 font-mono text-[9px] text-white tabular-nums">
                {String(index + 1).padStart(3, '0')}
              </span>
              {item.imageCount > 1 && (
                <span
                  className="absolute top-1 right-1 flex min-w-5 items-center justify-center rounded-sm bg-sky-500/90 px-1 py-0.5 font-bold text-[9px] text-white"
                  title={labels.imageCount.replace('{count}', String(item.imageCount))}
                >
                  ×{item.imageCount}
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1.5 py-1 font-mono text-[9px] text-white">
                {item.imageHash.slice(0, 12)}
              </span>
            </a>
          ))}
        </div>
      ) : (
        <div className="flex min-h-52 items-center justify-center rounded-lg border border-border border-dashed px-6 text-center text-muted-foreground text-sm">
          {labels.noMatches}
        </div>
      )}
    </section>
  );
}
