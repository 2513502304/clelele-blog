import { ErrorBoundary, InlineErrorFallback } from '@components/common';
import StyleGalleryDateRangeFilter from '@components/style-gallery/StyleGalleryDateRangeFilter';
import StyleGalleryVisualFilter, {
  type StyleGalleryVisualFilterLabels,
} from '@components/style-gallery/StyleGalleryVisualFilter';
import { Icon } from '@iconify/react';
import { createStyleGalleryDateRangeMatcher, getStyleGalleryDateKey } from '@lib/style-gallery-date-range';
import type { StyleGalleryDateRangeLabels } from '@lib/style-gallery-date-range-labels';
import { createStyleGalleryExampleQueryMatcher } from '@lib/style-gallery-example-search';
import { getReusableStyleGalleryImageUrl } from '@lib/style-gallery-image-client';
import { getStyleGalleryExampleThumbnailSource } from '@lib/style-gallery-image-key';
import {
  createStyleGalleryCopyAction,
  createStyleGalleryDeleteAction,
  deleteStyleGalleryExample,
  getStyleGalleryLightboxElementId,
  locateStyleGalleryElement,
  type StyleGalleryLightboxActionLabels,
} from '@lib/style-gallery-lightbox-actions';
import { STYLE_GALLERY_EXAMPLE_LIGHTBOX_PREFETCH } from '@lib/style-gallery-lightbox-prefetch';
import { getStyleGalleryManagementToken, STYLE_GALLERY_TOKEN_CHANGED_EVENT } from '@lib/style-gallery-management-token';
import { STYLE_GALLERY_PLATFORMS } from '@lib/style-gallery-platforms';
import { loadStyleGalleryDefaultPrompt, loadStyleGalleryPromptChoices } from '@lib/style-gallery-prompt-client';
import { loadStyleGalleryPromptSearchIndex } from '@lib/style-gallery-prompt-search-client';
import {
  getStyleGalleryDefaultSortDirection,
  STYLE_GALLERY_SORT_DIRECTIONS,
  STYLE_GALLERY_SORT_KEYS,
  type StyleGallerySortKey,
} from '@lib/style-gallery-sort';
import { galleryTagMatches, normalizeGalleryTag } from '@lib/style-gallery-tags';
import { useGalleryTags } from '@store/gallery-tags';
import { openModal } from '@store/modal';
import { parseAsBoolean, parseAsString, parseAsStringLiteral, useQueryState, useQueryStates } from 'nuqs';
import { NuqsAdapter } from 'nuqs/adapters/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProgressiveList } from '@/hooks/useProgressiveList';
import { getStyleGallerySourceCards, getStyleGallerySourceHash } from '@/lib/style-gallery-source-groups';
import type { StyleGalleryExampleOverviewItem } from '@/types/style-gallery';
import StyleGalleryGrid, { StyleGalleryLayoutToggle, useStyleGalleryLayout } from './StyleGalleryGrid';
import {
  createStyleGalleryLightboxLikeAction,
  StyleGalleryLikeButton,
  type StyleGalleryLikeLabels,
  useStyleGalleryLikes,
} from './StyleGalleryLikeButton';
import StyleGallerySharedImage from './StyleGallerySharedImage';
import StyleGallerySourceStack from './StyleGallerySourceStack';
import { useGalleryTagSelection } from './StyleGalleryTagSelection';
import { GalleryTagEditor, GalleryTagFilter, GalleryTagPills } from './StyleGalleryTags';

interface Props {
  examples: StyleGalleryExampleOverviewItem[];
  galleryBasePath: string;
  locale: string;
  labels: StyleGalleryExamplesOverviewLabels;
  uploadsEnabled: boolean;
  lightboxActionLabels: StyleGalleryLightboxActionLabels;
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
  refreshLikeSort: string;
  sortAscending: string;
  sortDescending: string;
  likes: StyleGalleryLikeLabels;
  dateRange: StyleGalleryDateRangeLabels;
  visualFilter: StyleGalleryVisualFilterLabels;
}

const INITIAL_EXAMPLE_COUNT = 24;
const EXAMPLE_BATCH_SIZE = 24;
// 与 Gallery 主预览保持一致：桌面端前两行主动加载，只有首行使用高网络优先级。
const EAGER_EXAMPLE_COUNT = 8;
const HIGH_PRIORITY_EXAMPLE_COUNT = 4;
const EMPTY_SOURCE_SEARCH_INDEX: Readonly<Record<string, string>> = Object.freeze({});

function reportUrlStateError(error: unknown) {
  console.error('Failed to update sub-gallery overview URL state:', error);
}

/**
 * 跨 item 的 Sub-gallery 总览。数据来自轻量示例索引，并采用预留图片比例的卡片与渐进挂载，
 * 因此慢图片只会在预留区域内补齐，不会把已经显示的卡片重新排位。
 */
function StyleGalleryExamplesOverviewContent({
  examples: initialExamples,
  galleryBasePath,
  locale,
  labels,
  uploadsEnabled,
  lightboxActionLabels,
}: Props) {
  const [layout, setLayout] = useStyleGalleryLayout();
  const masonry = layout === 'masonry';
  const [grouped, setGrouped] = useQueryState('grouped', parseAsBoolean.withDefault(true));
  const sourceThumbnails = useRef(new Map<string, string>());
  const groupLabel = locale.startsWith('zh')
    ? '同源折叠'
    : locale.startsWith('ja')
      ? '同じ元画像をまとめる'
      : 'Group by source';
  const [examples, setExamples] = useState(initialExamples);
  // 不放进 state：加载完成只影响下一次打开 Lightbox，不应让数千张卡片重新渲染。
  const loadedExampleSources = useRef(new Set<string>());
  const loadedExampleThumbnails = useRef(new Set<string>());
  const [uploadToken, setUploadToken] = useState('');
  const [platform, setPlatform] = useQueryState('platform', parseAsString.withDefault('all'));
  const [query, setQuery] = useQueryState('q', parseAsString.withDefault(''));
  const { index: tagIndex, status: tagStatus } = useGalleryTags();
  const [tag, setTag] = useQueryState('tag', parseAsString.withDefault(''));
  const tagQuery = query.trim().startsWith('#');
  const [{ sort: sortKey, dir: sortDirection }, setSortState] = useQueryStates({
    sort: parseAsStringLiteral(STYLE_GALLERY_SORT_KEYS).withDefault('default'),
    dir: parseAsStringLiteral(STYLE_GALLERY_SORT_DIRECTIONS).withDefault('asc'),
  });
  const [{ from: dateFrom, to: dateTo }, setDateRange] = useQueryStates({
    from: parseAsString.withDefault(''),
    to: parseAsString.withDefault(''),
  });
  const likes = useStyleGalleryLikes(Object.fromEntries(examples.map((example) => [example.id, example.likeCount])));
  const [visualMatches, setVisualMatches] = useState<Set<string> | null>(null);
  const [visualRevision, setVisualRevision] = useState(0);
  const [sourceSearchIndex, setSourceSearchIndex] = useState<Record<string, string> | null>(null);
  const [searchIndexStatus, setSearchIndexStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  useEffect(() => {
    const syncToken = () => setUploadToken(getStyleGalleryManagementToken());
    syncToken();
    window.addEventListener(STYLE_GALLERY_TOKEN_CHANGED_EVENT, syncToken);
    return () => window.removeEventListener(STYLE_GALLERY_TOKEN_CHANGED_EVENT, syncToken);
  }, []);
  // 点赞计数实时更新，但排序快照由用户主动刷新，避免连续浏览或 popup 点赞时网格在背景中跳位。
  const [likeSortCounts, setLikeSortCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(examples.map((example) => [example.id, example.likeCount])),
  );
  const sortLabels: Record<StyleGallerySortKey, string> = {
    default: labels.sortDefault,
    date: labels.sortImportedAt,
    id: labels.sortImageId,
    examples: labels.sortExampleCount,
    likes: labels.sortLikeCount,
  };
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        timeZone: 'Asia/Shanghai',
      }),
    [locale],
  );
  const availableDateKeys = useMemo(
    () => [
      ...new Set(
        examples.map((example) => getStyleGalleryDateKey(example.uploadedAt)).filter((date): date is string => date !== null),
      ),
    ],
    [examples],
  );
  const matchesDateRange = useMemo(
    () => createStyleGalleryDateRangeMatcher({ from: dateFrom, to: dateTo }),
    [dateFrom, dateTo],
  );
  const ensureSearchIndex = useCallback(async () => {
    if (sourceSearchIndex || searchIndexStatus === 'loading') return;
    setSearchIndexStatus('loading');
    try {
      setSourceSearchIndex(await loadStyleGalleryPromptSearchIndex());
      setSearchIndexStatus('ready');
    } catch (error) {
      console.error('Failed to load the Sub-gallery prompt search index:', error);
      setSearchIndexStatus('failed');
    }
  }, [searchIndexStatus, sourceSearchIndex]);
  useEffect(() => {
    if (!tagQuery && query.trim() && searchIndexStatus === 'idle') void ensureSearchIndex();
  }, [ensureSearchIndex, query, searchIndexStatus, tagQuery]);
  const matchesTextQuery = useMemo(
    () => createStyleGalleryExampleQueryMatcher(sourceSearchIndex ?? EMPTY_SOURCE_SEARCH_INDEX, query),
    [query, sourceSearchIndex],
  );
  const filtered = useMemo(() => {
    const matches = examples.filter((example) => {
      const sourceTags = tagIndex.items[example.sourceSlug] ?? [];
      if (tag && !sourceTags.includes(normalizeGalleryTag(tag))) return false;
      const matchesPlatform = platform === 'all' || example.model === platform;
      const matchesDate = matchesDateRange(example.uploadedAt);
      return (
        matchesPlatform &&
        (tagQuery ? galleryTagMatches(sourceTags, query) : matchesTextQuery(example)) &&
        matchesDate &&
        (visualMatches === null || visualMatches.has(example.id))
      );
    });
    const sorted = [...matches];
    if (sortKey !== 'default') {
      sorted.sort((a, b) => {
        if (sortKey === 'id') return a.id.localeCompare(b.id);
        if (sortKey === 'examples') return a.sourceExampleCount - b.sourceExampleCount || a.id.localeCompare(b.id);
        if (sortKey === 'likes') return (likeSortCounts[a.id] ?? 0) - (likeSortCounts[b.id] ?? 0) || a.id.localeCompare(b.id);
        return a.uploadedAt.localeCompare(b.uploadedAt) || a.id.localeCompare(b.id);
      });
    }
    return sortDirection === 'desc' ? sorted.reverse() : sorted;
  }, [
    tagIndex,
    tag,
    tagQuery,
    query,
    examples,
    likeSortCounts,
    matchesDateRange,
    matchesTextQuery,
    platform,
    sortDirection,
    sortKey,
    visualMatches,
  ]);
  const hasPendingLikeSort =
    sortKey === 'likes' && examples.some((example) => (likeSortCounts[example.id] ?? 0) !== likes.getCount(example.id));
  const deleteOverviewExample = useCallback(
    async (sourceSlug: string, exampleId: string) => {
      const token = uploadToken.trim();
      if (!uploadsEnabled || !token) return false;
      await deleteStyleGalleryExample(sourceSlug, exampleId, token);
      setExamples((current) => current.filter((example) => example.id !== exampleId));
      return true;
    },
    [uploadToken, uploadsEnabled],
  );
  const sourceCards = useMemo(() => getStyleGallerySourceCards(filtered, grouped), [filtered, grouped]);
  function rememberSourceThumbnail(slug: string, image: HTMLImageElement | null) {
    if (image?.complete && image.naturalWidth > 0) sourceThumbnails.current.set(slug, image.currentSrc || image.src);
  }
  function openLightbox(example: StyleGalleryExampleOverviewItem, navigation = filtered) {
    // 仅在用户打开 popup 时构造导航动作；点赞状态更新不再重复映射数千个未打开的示例。
    const lightboxImages = navigation.map((candidate) => ({
      id: candidate.id,
      gallerySourceSlug: candidate.sourceSlug,
      generationPrompt: candidate.note,
      src: candidate.src,
      dimensions: candidate.dimensions,
      resolvedSrc: getReusableStyleGalleryImageUrl(candidate.src, loadedExampleSources.current.has(candidate.src)),
      previewSrc:
        getReusableStyleGalleryImageUrl(
          getStyleGalleryExampleThumbnailSource(candidate.src),
          loadedExampleThumbnails.current.has(getStyleGalleryExampleThumbnailSource(candidate.src)),
        ) ?? (grouped ? getStyleGalleryExampleThumbnailSource(candidate.src) : undefined),
      alt: `${candidate.sourceTitle} ${candidate.model}`,
      source: {
        hash: getStyleGallerySourceHash(candidate),
        href: `${galleryBasePath}/${candidate.sourceSlug}`,
        thumbnail: sourceThumbnails.current.get(candidate.sourceSlug),
      },
      like: createStyleGalleryLightboxLikeAction(candidate.id, likes, labels.likes),
      copy: createStyleGalleryCopyAction(
        () => loadStyleGalleryDefaultPrompt(candidate.sourceSlug, candidate.sourcePromptRevision),
        lightboxActionLabels,
        candidate.sourcePromptCount > 1
          ? {
              promptCount: candidate.sourcePromptCount,
              getPrompts: () => loadStyleGalleryPromptChoices(candidate.sourceSlug, candidate.sourcePromptRevision),
            }
          : undefined,
      ),
      delete: createStyleGalleryDeleteAction(
        candidate.id,
        `${candidate.sourceTitle} ${candidate.model}`,
        uploadsEnabled && Boolean(uploadToken.trim()),
        () => deleteOverviewExample(candidate.sourceSlug, candidate.id),
        lightboxActionLabels,
      ),
      locate: {
        run: () => {
          const targetIndex = sourceCards.findIndex(
            (card) => card.example.id === candidate.id || card.stack?.some((item) => item.id === candidate.id),
          );
          revealThrough(targetIndex);
          locateStyleGalleryElement(
            getStyleGalleryLightboxElementId('overview-example', sourceCards[targetIndex]?.example.id ?? candidate.id),
          );
        },
      },
    }));
    const currentIndex = Math.max(
      0,
      navigation.findIndex((candidate) => candidate.id === example.id),
    );
    openModal('imageLightbox', {
      src: example.src,
      alt: `${example.sourceTitle} ${example.model}`,
      images: lightboxImages,
      currentIndex,
      prefetch: STYLE_GALLERY_EXAMPLE_LIGHTBOX_PREFETCH,
    });
  }
  const { hasMore, loadMore, loadMoreRef, revealThrough, visibleItems } = useProgressiveList(sourceCards, {
    initialCount: INITIAL_EXAMPLE_COUNT,
    batchSize: EXAMPLE_BATCH_SIZE,
    resetKey: `${tag}\u0000${platform}\u0000${query.trim().toLowerCase()}\u0000${dateFrom}\u0000${dateTo}\u0000${sortKey}\u0000${sortDirection}\u0000${visualRevision}`,
  });

  function refreshLikeSortCounts() {
    setLikeSortCounts(Object.fromEntries(examples.map((example) => [example.id, likes.getCount(example.id)])));
  }

  function changeSortKey(nextSortKey: StyleGallerySortKey) {
    if (nextSortKey === 'likes') refreshLikeSortCounts();
    void setSortState({ sort: nextSortKey, dir: getStyleGalleryDefaultSortDirection(nextSortKey) }).catch(reportUrlStateError);
  }

  function toggleSortDirection() {
    if (sortKey === 'likes') refreshLikeSortCounts();
    setSortState({ dir: sortDirection === 'asc' ? 'desc' : 'asc' }).catch(reportUrlStateError);
  }

  const tagSelection = useGalleryTagSelection(
    filtered.map((item) => item.sourceSlug),
    locale,
    (Boolean(query.trim()) &&
      ((!tagQuery && (searchIndexStatus === 'idle' || searchIndexStatus === 'loading')) ||
        (tagQuery && tagStatus !== 'ready'))) ||
      (Boolean(tag) && tagStatus !== 'ready'),
  );

  return (
    <section ref={tagSelection.rootRef} className="space-y-5" aria-label="Generated example overview">
      {tagSelection.overlays}
      <GalleryTagEditor locale={locale} />
      <div className="glass-surface glass-toolbar p-4">
        <label className="relative block w-full">
          <Icon icon="ri:search-line" className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            aria-busy={searchIndexStatus === 'loading'}
            onFocus={() => {
              if (query.trim() && !tagQuery) void ensureSearchIndex();
            }}
            onChange={(event) => setQuery(event.currentTarget.value).catch(reportUrlStateError)}
            placeholder={labels.searchPlaceholder}
            className="h-10 w-full rounded-md border border-border bg-background pr-9 pl-9 text-sm outline-none focus:border-primary"
          />
          {searchIndexStatus === 'loading' && (
            <Icon
              icon="ri:loader-4-line"
              className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground motion-safe:animate-spin"
            />
          )}
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-border border-t pt-3">
          <StyleGalleryVisualFilter
            scope="example"
            labels={labels.visualFilter}
            onResults={(matches) => {
              setVisualMatches(matches);
              setVisualRevision((revision) => revision + 1);
            }}
          />
          <label className="sr-only" htmlFor="example-platform-filter">
            {labels.platform}
          </label>
          <div className="relative">
            <select
              id="example-platform-filter"
              value={platform}
              onChange={(event) => setPlatform(event.currentTarget.value).catch(reportUrlStateError)}
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
          <StyleGalleryDateRangeFilter
            value={{ from: dateFrom, to: dateTo }}
            locale={locale}
            labels={labels.dateRange}
            availableDateKeys={availableDateKeys}
            onApply={(range) => void setDateRange(range).catch(reportUrlStateError)}
          />
          <GalleryTagFilter
            value={tag}
            onChange={(value) => {
              void setTag(value).catch(reportUrlStateError);
            }}
            locale={locale}
          />
        </div>
        <div className="gallery-display-toolbar mt-3 flex flex-wrap items-center justify-between gap-2 border-border border-t pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <StyleGalleryLayoutToggle
              masonry={masonry}
              locale={locale}
              onChange={() => void setLayout(masonry ? 'grid' : 'masonry').catch(reportUrlStateError)}
            />
            <button
              type="button"
              aria-pressed={grouped}
              onClick={() => {
                void setGrouped(!grouped).catch(reportUrlStateError);
              }}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm transition hover:border-primary/40 aria-pressed:border-primary aria-pressed:text-primary"
            >
              <Icon icon="ri:stack-line" className="size-4" />
              {groupLabel}
            </button>
            <span className="shrink-0 text-muted-foreground text-sm tabular-nums">
              {filtered.length} / {examples.length}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="example-sort">
              {labels.sortItems}
            </label>
            <div className="relative min-w-44">
              <select
                id="example-sort"
                value={sortKey}
                onChange={(event) => changeSortKey(event.currentTarget.value as StyleGallerySortKey)}
                className="h-10 w-full appearance-none rounded-md border border-border bg-background pr-8 pl-3 text-sm outline-none focus:border-primary"
              >
                {STYLE_GALLERY_SORT_KEYS.map((key) => (
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
            {hasPendingLikeSort && (
              <button
                type="button"
                onClick={refreshLikeSortCounts}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 font-medium text-rose-600 text-sm transition hover:border-rose-300 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
              >
                <Icon icon="ri:refresh-line" className="size-4" />
                {labels.refreshLikeSort}
              </button>
            )}
            <button
              type="button"
              onClick={toggleSortDirection}
              title={sortDirection === 'asc' ? labels.sortAscending : labels.sortDescending}
              aria-label={sortDirection === 'asc' ? labels.sortAscending : labels.sortDescending}
              className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
            >
              <Icon icon={sortDirection === 'asc' ? 'ri:sort-asc' : 'ri:sort-desc'} className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {tagSelection.toolbar}
      {filtered.length ? (
        <>
          <StyleGalleryGrid masonry={masonry}>
            {visibleItems.map(({ example, stack }, index) => (
              <figure
                key={example.id}
                data-gallery-selection-id={example.sourceSlug}
                data-selected={tagSelection.selected.has(example.sourceSlug)}
                id={getStyleGalleryLightboxElementId('overview-example', example.id)}
                data-source-slug={example.sourceSlug}
                data-source-stack={stack ? 'true' : undefined}
                tabIndex={-1}
                className="flex w-full min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
              >
                <div className="relative">
                  {stack ? (
                    <StyleGallerySourceStack
                      examples={stack}
                      likeCount={stack.reduce((total, member) => total + likes.getCount(member.id), 0)}
                      likesLabel={
                        locale.startsWith('zh')
                          ? '组内点赞总数'
                          : locale.startsWith('ja')
                            ? 'グループのいいね合計'
                            : 'Total group likes'
                      }
                      loadedSources={loadedExampleThumbnails.current}
                      onOpen={() => openLightbox(example, stack)}
                      label={`${getStyleGallerySourceHash(example)} · ${stack.length}`}
                      eager={index < EAGER_EXAMPLE_COUNT}
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => openLightbox(example)}
                        className="group block w-full cursor-zoom-in overflow-hidden bg-muted text-left"
                      >
                        <StyleGallerySharedImage
                          source={example.src}
                          dimensions={example.dimensions}
                          naturalAspect={masonry}
                          loadedSources={loadedExampleSources.current}
                          alt={`${example.sourceTitle} ${example.model}`}
                          width={4}
                          height={5}
                          loading={index < EAGER_EXAMPLE_COUNT ? 'eager' : 'lazy'}
                          fetchPriority={index < HIGH_PRIORITY_EXAMPLE_COUNT ? 'high' : 'auto'}
                          decoding="async"
                          className="aspect-[4/5] w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                        />
                      </button>
                      <StyleGalleryLikeButton
                        exampleId={example.id}
                        controller={likes}
                        labels={labels.likes}
                        className="gallery-image-badge absolute right-2 bottom-2 z-10"
                      />
                    </>
                  )}
                  {tagSelection.checkbox(example.sourceSlug)}
                  <GalleryTagPills
                    slug={example.sourceSlug}
                    locale={locale}
                    basePath={galleryBasePath}
                    overlay
                    editable
                    onSelect={(value) => {
                      void setTag(value).catch(reportUrlStateError);
                    }}
                  />
                </div>
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
                  {example.note && <p className="line-clamp-3 text-muted-foreground text-xs leading-5">{example.note}</p>}
                  <a
                    href={`${galleryBasePath}/${example.sourceSlug}`}
                    data-astro-prefetch="false"
                    className="mt-auto flex items-center gap-2 border-border border-t pt-3 text-sm transition hover:text-primary"
                  >
                    <img
                      src={example.sourceImage}
                      ref={(image) => rememberSourceThumbnail(example.sourceSlug, image)}
                      onLoad={(event) => rememberSourceThumbnail(example.sourceSlug, event.currentTarget)}
                      alt={example.sourceImageAlt ?? example.sourceTitle}
                      width={36}
                      height={36}
                      loading="lazy"
                      decoding="async"
                      className="size-9 shrink-0 rounded-md object-cover"
                    />
                    <span className="min-w-0 flex-1 font-medium tabular-nums">{getStyleGallerySourceHash(example)}</span>
                    <Icon icon="ri:arrow-right-s-line" className="size-4 shrink-0" />
                  </a>
                </figcaption>
              </figure>
            ))}
          </StyleGalleryGrid>
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
