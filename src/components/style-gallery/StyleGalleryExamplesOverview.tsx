import { ErrorBoundary, InlineErrorFallback } from '@components/common';
import { Icon } from '@iconify/react';
import { STYLE_GALLERY_PLATFORMS } from '@lib/style-gallery-platforms';
import { openModal } from '@store/modal';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { NuqsAdapter } from 'nuqs/adapters/react';
import { useMemo, useState } from 'react';
import { useProgressiveList } from '@/hooks/useProgressiveList';
import type { StyleGalleryExampleOverviewItem } from '@/types/style-gallery';
import { StyleGalleryLikeButton, type StyleGalleryLikeLabels, useStyleGalleryLikes } from './StyleGalleryLikeButton';

interface Props {
  examples: StyleGalleryExampleOverviewItem[];
  galleryBasePath: string;
  locale: string;
  labels: StyleGalleryExamplesOverviewLabels;
}

export interface StyleGalleryExamplesOverviewLabels {
  searchPlaceholder: string;
  platform: string;
  allPlatforms: string;
  otherPlatform: string;
  noMatches: string;
  loadMore: string;
  sortItems: string;
  sortDefault: string;
  sortImportedAt: string;
  sortImageId: string;
  sortExampleCount: string;
  sortLikeCount: string;
  sortAscending: string;
  sortDescending: string;
  likes: StyleGalleryLikeLabels;
}

const INITIAL_EXAMPLE_COUNT = 24;
const EXAMPLE_BATCH_SIZE = 24;
const EAGER_EXAMPLE_COUNT = 8;
const sortKeys = ['default', 'date', 'id', 'examples', 'likes'] as const;
const sortDirections = ['asc', 'desc'] as const;
type SortKey = (typeof sortKeys)[number];

function reportUrlStateError(error: unknown) {
  console.error('Failed to update sub-gallery overview URL state:', error);
}

/**
 * 跨 item 的 Sub-gallery 总览。数据来自轻量示例索引，并采用固定比例卡片与渐进挂载，
 * 因此慢图片只会在预留区域内补齐，不会把已经显示的卡片重新排位。
 */
function StyleGalleryExamplesOverviewContent({ examples, galleryBasePath, locale, labels }: Props) {
  const [platform, setPlatform] = useState('all');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useQueryState('sort', parseAsStringLiteral(sortKeys).withDefault('default'));
  const [sortDirection, setSortDirection] = useQueryState('dir', parseAsStringLiteral(sortDirections).withDefault('asc'));
  const likes = useStyleGalleryLikes(Object.fromEntries(examples.map((example) => [example.id, example.likeCount])));
  const sortLabels: Record<SortKey, string> = {
    default: labels.sortDefault,
    date: labels.sortImportedAt,
    id: labels.sortImageId,
    examples: labels.sortExampleCount,
    likes: labels.sortLikeCount,
  };
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' }),
    [locale],
  );
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const matches = examples.filter((example) => {
      const matchesPlatform = platform === 'all' || example.model === platform;
      const matchesQuery =
        !normalizedQuery || `${example.sourceTitle} ${example.note ?? ''}`.toLowerCase().includes(normalizedQuery);
      return matchesPlatform && matchesQuery;
    });
    const sorted = [...matches];
    if (sortKey !== 'default') {
      sorted.sort((a, b) => {
        if (sortKey === 'id') return a.id.localeCompare(b.id);
        if (sortKey === 'examples') return a.sourceExampleCount - b.sourceExampleCount || a.id.localeCompare(b.id);
        if (sortKey === 'likes') return likes.getCount(a.id) - likes.getCount(b.id) || a.id.localeCompare(b.id);
        return a.uploadedAt.localeCompare(b.uploadedAt) || a.id.localeCompare(b.id);
      });
    }
    return sortDirection === 'desc' ? sorted.reverse() : sorted;
  }, [examples, likes, platform, query, sortDirection, sortKey]);
  const lightboxImages = useMemo(
    () => filtered.map((example) => ({ src: example.src, alt: `${example.sourceTitle} ${example.model}` })),
    [filtered],
  );
  const { hasMore, loadMore, loadMoreRef, visibleItems } = useProgressiveList(filtered, {
    initialCount: INITIAL_EXAMPLE_COUNT,
    batchSize: EXAMPLE_BATCH_SIZE,
    resetKey: `${platform}\u0000${query.trim().toLowerCase()}\u0000${sortKey}\u0000${sortDirection}`,
  });

  function openLightbox(example: StyleGalleryExampleOverviewItem) {
    const currentIndex = Math.max(
      0,
      filtered.findIndex((candidate) => candidate.src === example.src),
    );
    openModal('imageLightbox', {
      src: example.src,
      alt: `${example.sourceTitle} ${example.model}`,
      images: lightboxImages,
      currentIndex,
    });
  }

  return (
    <section className="space-y-5" aria-label="Generated example overview">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background/80 p-4 shadow-sm">
        <label className="relative min-w-64 flex-1 md:min-w-full">
          <Icon icon="ri:search-line" className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={labels.searchPlaceholder}
            className="h-10 w-full rounded-md border border-border bg-background pr-3 pl-9 text-sm outline-none focus:border-primary"
          />
        </label>
        <label className="sr-only" htmlFor="example-platform-filter">
          {labels.platform}
        </label>
        <div className="relative">
          <select
            id="example-platform-filter"
            value={platform}
            onChange={(event) => setPlatform(event.currentTarget.value)}
            className="h-10 appearance-none rounded-md border border-border bg-background pr-8 pl-3 text-sm outline-none focus:border-primary"
          >
            <option value="all">{labels.allPlatforms}</option>
            {STYLE_GALLERY_PLATFORMS.map((item) => (
              <option key={item.slug} value={item.label}>
                {item.label}
              </option>
            ))}
          </select>
          <Icon
            icon="ri:arrow-down-s-line"
            className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
          />
        </div>
        <span className="text-muted-foreground text-sm tabular-nums">
          {filtered.length} / {examples.length}
        </span>
        <label className="sr-only" htmlFor="example-sort">
          {labels.sortItems}
        </label>
        <div className="relative min-w-44">
          <select
            id="example-sort"
            value={sortKey}
            onChange={(event) => setSortKey(event.currentTarget.value as SortKey).catch(reportUrlStateError)}
            className="h-10 w-full appearance-none rounded-md border border-border bg-background pr-8 pl-3 text-sm outline-none focus:border-primary"
          >
            {sortKeys.map((key) => (
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
          onClick={() => setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc')).catch(reportUrlStateError)}
          title={sortDirection === 'asc' ? labels.sortAscending : labels.sortDescending}
          aria-label={sortDirection === 'asc' ? labels.sortAscending : labels.sortDescending}
          className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
        >
          <Icon icon={sortDirection === 'asc' ? 'ri:sort-asc' : 'ri:sort-desc'} className="size-4" />
        </button>
      </div>

      {filtered.length ? (
        <>
          <div className="grid grid-cols-4 items-stretch gap-4 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
            {visibleItems.map((example, index) => (
              <figure
                key={example.id}
                className="relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => openLightbox(example)}
                  className="group block w-full cursor-zoom-in overflow-hidden bg-muted text-left"
                >
                  <img
                    src={example.src}
                    alt={`${example.sourceTitle} ${example.model}`}
                    width={4}
                    height={5}
                    loading={index < EAGER_EXAMPLE_COUNT ? 'eager' : 'lazy'}
                    fetchPriority={index < 4 ? 'high' : 'auto'}
                    decoding="async"
                    className="aspect-[4/5] w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                  />
                </button>
                <StyleGalleryLikeButton
                  exampleId={example.id}
                  controller={likes}
                  labels={labels.likes}
                  className="absolute top-2 right-2 z-10"
                />
                <figcaption className="flex flex-1 flex-col gap-3 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-full bg-sky-50 px-2 py-1 font-semibold text-sky-600 text-xs dark:bg-sky-950/50 dark:text-sky-200">
                      {example.model || labels.otherPlatform}
                    </span>
                    {example.uploadedAt && (
                      <time dateTime={example.uploadedAt} className="text-muted-foreground text-xs">
                        {dateFormatter.format(new Date(example.uploadedAt))}
                      </time>
                    )}
                  </div>
                  {example.note && <p className="line-clamp-2 text-muted-foreground text-xs leading-5">{example.note}</p>}
                  <a
                    href={`${galleryBasePath}/${example.sourceSlug}`}
                    data-astro-prefetch="false"
                    className="mt-auto flex items-center gap-2 border-border border-t pt-3 text-sm transition hover:text-primary"
                  >
                    <img
                      src={example.sourceImage}
                      alt={example.sourceImageAlt ?? example.sourceTitle}
                      width={36}
                      height={36}
                      loading="lazy"
                      decoding="async"
                      className="size-9 shrink-0 rounded-md object-cover"
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{example.sourceTitle}</span>
                    <Icon icon="ri:arrow-right-s-line" className="size-4 shrink-0" />
                  </a>
                </figcaption>
              </figure>
            ))}
          </div>
          {hasMore && (
            <div ref={loadMoreRef} className="flex justify-center pt-2">
              <button
                type="button"
                onClick={loadMore}
                className="rounded-md border border-border bg-background px-4 py-2 font-medium text-muted-foreground text-sm transition hover:border-primary/40 hover:text-foreground"
              >
                {labels.loadMore}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="flex min-h-52 items-center justify-center rounded-lg border border-border border-dashed text-muted-foreground text-sm">
          {labels.noMatches}
        </div>
      )}
    </section>
  );
}

/** 为总览交互提供 URL 状态上下文，并将渲染异常限制在当前 Gallery 区域。 */
export default function StyleGalleryExamplesOverview(props: Props) {
  return (
    <ErrorBoundary FallbackComponent={InlineErrorFallback}>
      <NuqsAdapter>
        <StyleGalleryExamplesOverviewContent {...props} />
      </NuqsAdapter>
    </ErrorBoundary>
  );
}
