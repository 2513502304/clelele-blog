import { ErrorBoundary, InlineErrorFallback } from '@components/common';
import StyleGalleryDateRangeFilter from '@components/style-gallery/StyleGalleryDateRangeFilter';
import StyleGalleryVisualFilter, {
  type StyleGalleryVisualFilterLabels,
} from '@components/style-gallery/StyleGalleryVisualFilter';
import { Icon } from '@iconify/react';
import { createStyleGalleryDateRangeMatcher, getStyleGalleryDateKey } from '@lib/style-gallery-date-range';
import type { StyleGalleryDateRangeLabels } from '@lib/style-gallery-date-range-labels';
import {
  createStyleGallerySourceLightboxData,
  getStyleGalleryLightboxElementId,
  locateStyleGalleryElement,
  type StyleGalleryLightboxCopyLabels,
} from '@lib/style-gallery-lightbox-actions';
import {
  getCachedStyleGalleryPromptChoices,
  loadStyleGalleryDefaultPrompt,
  loadStyleGalleryPromptChoices,
  type StyleGalleryPromptChoice,
} from '@lib/style-gallery-prompt-client';
import { getStyleGalleryPromptCacheKey, getStyleGalleryPromptChooserKey } from '@lib/style-gallery-prompt-groups';
import { loadStyleGalleryPromptSearchIndex } from '@lib/style-gallery-prompt-search-client';
import { getSelectedStyleGalleryPrompt } from '@lib/style-gallery-prompt-selection';
import {
  getStyleGalleryDefaultSortDirection,
  STYLE_GALLERY_SORT_DIRECTIONS,
  STYLE_GALLERY_SORT_KEYS,
  type StyleGallerySortKey,
} from '@lib/style-gallery-sort';
import { openModal } from '@store/modal';
import { useReducedMotion } from 'motion/react';
import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { NuqsAdapter } from 'nuqs/adapters/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProgressiveList } from '@/hooks/useProgressiveList';
import type { StyleGalleryImageDimensions } from '@/types/style-gallery';
import { Dialog, DialogContent } from '../ui/dialog';
import StyleGalleryGrid, { StyleGalleryLayoutToggle, useStyleGalleryLayout } from './StyleGalleryGrid';
import { StyleGalleryPromptChooser } from './StyleGalleryPromptChooser';
import StyleGallerySharedImage from './StyleGallerySharedImage';

export interface StyleGalleryBrowserItem {
  dimensions?: StyleGalleryImageDimensions;
  slug: string;
  title: string;
  promptExcerpt: string;
  promptCount: number;
  promptRevision: string;
  date: string;
  sourceImage: string;
  thumbnailImage?: string;
  sourceImageAlt?: string;
  imageHash: string;
  imageCount: number;
  exampleCount: number;
  likeCount: number;
}

interface StyleGalleryBrowserProps {
  items: StyleGalleryBrowserItem[];
  galleryBasePath: string;
  locale: string;
  labels: StyleGalleryBrowserLabels;
  lightboxCopyLabels: StyleGalleryLightboxCopyLabels;
}

export interface StyleGalleryBrowserLabels {
  searchPlaceholder: string;
  sortItems: string;
  sortDefault: string;
  sortImportedAt: string;
  sortImageId: string;
  sortExampleCount: string;
  sortLikeCount: string;
  sortAscending: string;
  sortDescending: string;
  imageCount: string;
  exampleCount: string;
  likeCount: string;
  copy: string;
  copied: string;
  copyRetry: string;
  promptOption: string;
  promptModelUnknown: string;
  promptChooserTitle: string;
  promptChooserDescription: string;
  promptLoading: string;
  promptLoadFailed: string;
  view: string;
  loadMore: string;
  noMatches: string;
  openImage: string;
  dateRange: StyleGalleryDateRangeLabels;
  visualFilter: StyleGalleryVisualFilterLabels;
}

interface PromptPickerState {
  item: StyleGalleryBrowserItem;
  prompts: StyleGalleryPromptChoice[] | null;
  failed: boolean;
}
// 桌面端四列：前两行主动加载，但只让首行占用高网络优先级。
const EAGER_CARD_COUNT = 8;
const HIGH_PRIORITY_CARD_COUNT = 4;
const INITIAL_CARD_COUNT = 24;
const CARD_BATCH_SIZE = 24;

function normalize(value: string) {
  return value.toLowerCase().trim();
}

function reportUrlStateError(error: unknown) {
  console.error('Failed to update style gallery URL state:', error);
}

function createPromptPickerState(
  item: StyleGalleryBrowserItem,
  prompts: StyleGalleryPromptChoice[] | null,
  failed = false,
): PromptPickerState {
  return { item, prompts, failed };
}

/**
 * Gallery 主预览页：普通浏览只接收轻量 Catalog，用户开始搜索后再加载完整 prompt 索引。
 * 复制从详情接口读取完整文本；只有多 prompt 候选值得在 hover/focus 时提前请求并缓存。
 */
function StyleGalleryBrowserContent({ items, galleryBasePath, locale, labels, lightboxCopyLabels }: StyleGalleryBrowserProps) {
  const shouldReduceMotion = useReducedMotion();
  const [query, setQuery] = useState('');
  const [{ sort: sortKey, dir: sortDirection }, setSortState] = useQueryStates({
    sort: parseAsStringLiteral(STYLE_GALLERY_SORT_KEYS).withDefault('default'),
    dir: parseAsStringLiteral(STYLE_GALLERY_SORT_DIRECTIONS).withDefault('asc'),
  });
  const [{ from: dateFrom, to: dateTo }, setDateRange] = useQueryStates({
    from: parseAsString.withDefault(''),
    to: parseAsString.withDefault(''),
  });
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const [copyErrorSlug, setCopyErrorSlug] = useState<string | null>(null);
  const [promptPicker, setPromptPicker] = useState<PromptPickerState | null>(null);
  const [visualMatches, setVisualMatches] = useState<Set<string> | null>(null);
  const [visualRevision, setVisualRevision] = useState(0);
  const [promptSearchIndex, setPromptSearchIndex] = useState<Record<string, string> | null>(null);
  const [promptSearchStatus, setPromptSearchStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [layout, setLayout] = useStyleGalleryLayout();
  const masonry = layout === 'masonry';
  const loadedSourceImages = useRef(new Set<string>()).current;
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Shanghai' }), [locale]);
  const sortLabels: Record<StyleGallerySortKey, string> = {
    default: labels.sortDefault,
    date: labels.sortImportedAt,
    id: labels.sortImageId,
    examples: labels.sortExampleCount,
    likes: labels.sortLikeCount,
  };
  const availableDateKeys = useMemo(
    () => [...new Set(items.map((item) => getStyleGalleryDateKey(item.date)).filter((date): date is string => date !== null))],
    [items],
  );
  const matchesDateRange = useMemo(
    () => createStyleGalleryDateRangeMatcher({ from: dateFrom, to: dateTo }),
    [dateFrom, dateTo],
  );

  const ensurePromptSearchIndex = useCallback(async () => {
    if (promptSearchIndex || promptSearchStatus === 'loading') return;
    setPromptSearchStatus('loading');
    try {
      setPromptSearchIndex(await loadStyleGalleryPromptSearchIndex());
      setPromptSearchStatus('ready');
    } catch (error) {
      console.error('[style-gallery] Failed to load the prompt search index.', error);
      setPromptSearchStatus('failed');
    }
  }, [promptSearchIndex, promptSearchStatus]);

  useEffect(() => {
    if (query.trim() && promptSearchStatus === 'idle') void ensurePromptSearchIndex();
  }, [ensurePromptSearchIndex, promptSearchStatus, query]);

  const filteredItems = useMemo(() => {
    const q = normalize(query);
    const filtered = items.filter((item) => {
      const localSearchable = [item.title, item.imageHash, item.slug].filter(Boolean).join(' ');
      const matchesQuery =
        !q ||
        normalize(localSearchable).includes(q) ||
        (promptSearchIndex ? promptSearchIndex[item.slug]?.includes(q) : promptSearchStatus !== 'failed');
      const matchesDate = matchesDateRange(item.date);
      const matchesVisual = visualMatches === null || visualMatches.has(item.slug);
      return matchesQuery && matchesDate && matchesVisual;
    });

    const sorted = [...filtered];
    if (sortKey !== 'default') {
      sorted.sort((a, b) => {
        if (sortKey === 'id') return a.imageHash.localeCompare(b.imageHash);
        if (sortKey === 'examples') return a.exampleCount - b.exampleCount || a.date.localeCompare(b.date);
        if (sortKey === 'likes') return a.likeCount - b.likeCount || a.date.localeCompare(b.date);
        return a.date.localeCompare(b.date);
      });
    }
    return sortDirection === 'desc' ? sorted.reverse() : sorted;
  }, [items, matchesDateRange, promptSearchIndex, promptSearchStatus, query, sortDirection, sortKey, visualMatches]);
  const { hasMore, loadMore, loadMoreRef, revealThrough, visibleItems } = useProgressiveList(filteredItems, {
    initialCount: INITIAL_CARD_COUNT,
    batchSize: CARD_BATCH_SIZE,
    // “全部显示”仍必须按滚动渐进挂载；全量 Catalog 在客户端不等于一次创建全部图片节点。
    resetKey: `${query.trim().toLowerCase()}\u0000${dateFrom}\u0000${dateTo}\u0000${sortKey}\u0000${sortDirection}\u0000${visualRevision}`,
  });

  /** 复用 hover 预取与点击请求，避免同一 item 在请求尚未完成时重复访问 Vercel/HF。 */
  const loadPromptChoices = useCallback(
    (item: StyleGalleryBrowserItem) => loadStyleGalleryPromptChoices(item.slug, item.promptRevision),
    [],
  );

  const prefetchPromptChoices = useCallback(
    (item: StyleGalleryBrowserItem) => {
      // 单 prompt 的复制本身只需一次按需读取；仅候选选择器值得在 hover/focus 时提前准备。
      // 否则用户滚动经过大量卡片会制造无意义的详情请求，反向增加 Vercel Function CPU。
      if (item.promptCount > 1) void loadPromptChoices(item).catch(() => undefined);
    },
    [loadPromptChoices],
  );

  useEffect(() => {
    const candidates = visibleItems.slice(0, EAGER_CARD_COUNT).filter((item) => item.promptCount > 1);
    // React island 已在浏览器空闲时 hydration；再让首屏布局稳定一帧后预取最多两行的多 prompt 元数据。
    const timer = window.setTimeout(() => {
      for (const item of candidates) prefetchPromptChoices(item);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [prefetchPromptChoices, visibleItems]);

  function handleQueryChange(value: string) {
    setQuery(value);
  }

  function handleSortChange(key: StyleGallerySortKey) {
    void setSortState({ sort: key, dir: getStyleGalleryDefaultSortDirection(key) }).catch(reportUrlStateError);
  }

  function toggleSortDirection() {
    void setSortState({ dir: sortDirection === 'asc' ? 'desc' : 'asc' }).catch(reportUrlStateError);
  }

  function openSourceLightbox(item: StyleGalleryBrowserItem) {
    const data = createStyleGallerySourceLightboxData(
      filteredItems.map((candidate) => ({
        id: candidate.slug,
        src: candidate.sourceImage,
        sourceLoaded: loadedSourceImages.has(candidate.sourceImage),
        previewSrc: candidate.sourceImage,
        alt: candidate.sourceImageAlt ?? candidate.title,
        getPrompt: () =>
          getSelectedStyleGalleryPrompt(candidate.slug) ??
          loadStyleGalleryDefaultPrompt(candidate.slug, candidate.promptRevision),
        promptOptions:
          candidate.promptCount > 1
            ? {
                promptCount: candidate.promptCount,
                getPrompts: () => loadStyleGalleryPromptChoices(candidate.slug, candidate.promptRevision),
              }
            : undefined,
        locate: () => {
          const targetIndex = filteredItems.findIndex((entry) => entry.slug === candidate.slug);
          revealThrough(targetIndex);
          locateStyleGalleryElement(getStyleGalleryLightboxElementId('preview-source', candidate.slug));
        },
      })),
      item.slug,
      lightboxCopyLabels,
    );
    openModal('imageLightbox', data);
  }

  async function copyPromptText(item: StyleGalleryBrowserItem, prompt: string): Promise<boolean> {
    setCopyErrorSlug(null);
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedSlug(item.slug);
      window.setTimeout(() => setCopiedSlug((current) => (current === item.slug ? null : current)), 1800);
      return true;
    } catch {
      setCopyErrorSlug(item.slug);
      window.setTimeout(() => setCopyErrorSlug((current) => (current === item.slug ? null : current)), 2400);
      return false;
    }
  }

  async function copyPrompt(item: StyleGalleryBrowserItem) {
    if (item.promptCount <= 1) {
      try {
        await copyPromptText(item, await loadStyleGalleryDefaultPrompt(item.slug, item.promptRevision));
      } catch {
        setCopyErrorSlug(item.slug);
        window.setTimeout(() => setCopyErrorSlug((current) => (current === item.slug ? null : current)), 2400);
      }
      return;
    }

    const cacheKey = getStyleGalleryPromptCacheKey(item.slug, item.promptRevision);
    const cached = getCachedStyleGalleryPromptChoices(item.slug, item.promptRevision);
    setPromptPicker(createPromptPickerState(item, cached ?? null));
    if (cached) return;
    try {
      const prompts = await loadPromptChoices(item);
      setPromptPicker((current) =>
        current && getStyleGalleryPromptCacheKey(current.item.slug, current.item.promptRevision) === cacheKey
          ? createPromptPickerState(item, prompts)
          : current,
      );
    } catch {
      setPromptPicker((current) =>
        current && getStyleGalleryPromptCacheKey(current.item.slug, current.item.promptRevision) === cacheKey
          ? createPromptPickerState(item, null, true)
          : current,
      );
    }
  }

  async function copySelectedPrompt(prompt: StyleGalleryPromptChoice): Promise<boolean> {
    if (!promptPicker) return false;
    return copyPromptText(promptPicker.item, prompt.prompt);
  }

  return (
    <section className="space-y-6" aria-label="Image style prompt gallery browser">
      <div className="rounded-lg border border-rose-100 bg-white/75 p-4 shadow-sm dark:border-rose-950/60 dark:bg-gray-950/60">
        <div>
          <label className="relative block">
            <Icon icon="ri:search-line" className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-rose-400" />
            <input
              value={query}
              onChange={(event) => handleQueryChange(event.currentTarget.value)}
              onFocus={() => void ensurePromptSearchIndex()}
              placeholder={labels.searchPlaceholder}
              className="h-11 w-full rounded-lg border border-rose-100 bg-white pr-3 pl-10 text-sm outline-none transition focus:border-rose-300 focus:ring-4 focus:ring-rose-100 dark:border-gray-800 dark:bg-gray-900 dark:focus:border-rose-700 dark:focus:ring-rose-950"
            />
          </label>
        </div>

        {/* 三个 Gallery 工具栏保持同一信息顺序：筛选与实时结果数在左，排序在右；不能因删减控件把整组筛选推到右侧。 */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-rose-100 border-t pt-4 dark:border-gray-800">
          <StyleGalleryVisualFilter
            scope="source"
            labels={labels.visualFilter}
            triggerClassName="h-10"
            onResults={(matches) => {
              setVisualMatches(matches);
              setVisualRevision((revision) => revision + 1);
            }}
          />
          <StyleGalleryDateRangeFilter
            value={{ from: dateFrom, to: dateTo }}
            locale={locale}
            labels={labels.dateRange}
            availableDateKeys={availableDateKeys}
            triggerClassName="h-10"
            onApply={(range) => {
              void setDateRange(range).catch(reportUrlStateError);
            }}
          />
          <StyleGalleryLayoutToggle
            masonry={masonry}
            locale={locale}
            onChange={() => void setLayout(masonry ? 'grid' : 'masonry').catch(reportUrlStateError)}
          />
          <span className="shrink-0 text-muted-foreground text-sm tabular-nums">
            {filteredItems.length} / {items.length}
          </span>
          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <label htmlFor="style-gallery-sort" className="sr-only">
              {labels.sortItems}
            </label>
            <div className="relative">
              <Icon
                icon="ri:sort-alphabet-asc"
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <select
                id="style-gallery-sort"
                value={sortKey}
                onChange={(event) => handleSortChange(event.currentTarget.value as StyleGallerySortKey)}
                className="h-10 appearance-none rounded-md border border-border bg-background pr-8 pl-8 text-sm outline-none transition-colors hover:border-primary/40 focus:border-primary"
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
            <button
              type="button"
              title={sortDirection === 'asc' ? labels.sortAscending : labels.sortDescending}
              aria-label={sortDirection === 'asc' ? labels.sortAscending : labels.sortDescending}
              onClick={toggleSortDirection}
              className="flex size-10 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <Icon icon={sortDirection === 'asc' ? 'ri:sort-asc' : 'ri:sort-desc'} className="size-4" />
            </button>
          </div>
        </div>
      </div>

      <StyleGalleryGrid masonry={masonry}>
        {visibleItems.map((item, index) => (
          <article
            key={item.slug}
            id={getStyleGalleryLightboxElementId('preview-source', item.slug)}
            tabIndex={-1}
            onPointerEnter={() => prefetchPromptChoices(item)}
            onFocusCapture={() => prefetchPromptChoices(item)}
            className="group overflow-hidden rounded-lg border border-rose-100 bg-white shadow-sm transition hover:-translate-y-1 hover:border-rose-200 hover:shadow-lg dark:border-gray-800 dark:bg-gray-950"
          >
            <div className={`relative overflow-hidden bg-rose-50 dark:bg-gray-900 ${masonry ? '' : 'aspect-[4/5]'}`}>
              <a href={`${galleryBasePath}/${item.slug}`} data-astro-prefetch="false" className="block h-full w-full">
                <StyleGallerySharedImage
                  source={item.sourceImage}
                  dimensions={item.dimensions}
                  naturalAspect={masonry}
                  loadedSources={loadedSourceImages}
                  alt={item.sourceImageAlt ?? item.title}
                  width={4}
                  height={5}
                  loading={index < EAGER_CARD_COUNT ? 'eager' : 'lazy'}
                  fetchPriority={index < HIGH_PRIORITY_CARD_COUNT ? 'high' : 'auto'}
                  decoding="async"
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                />
                <span className="absolute right-2 bottom-2 flex items-center gap-1.5">
                  <span className="inline-flex min-w-8 items-center justify-center gap-1 rounded-md bg-gray-950/80 px-2 py-1 font-bold text-[11px] text-white tabular-nums shadow-sm backdrop-blur-sm">
                    <Icon icon="ri:image-2-fill" className="size-3" />
                    <span className="sr-only">{labels.exampleCount.replace('{count}', String(item.exampleCount))}</span>
                    <span aria-hidden="true">{item.exampleCount}</span>
                  </span>
                  <span className="inline-flex min-w-8 items-center justify-center gap-1 rounded-md bg-rose-500/90 px-2 py-1 font-bold text-[11px] text-white tabular-nums shadow-sm backdrop-blur-sm">
                    <Icon icon="ri:heart-3-fill" className="size-3" />
                    <span className="sr-only">{labels.likeCount.replace('{count}', String(item.likeCount))}</span>
                    <span aria-hidden="true">{item.likeCount}</span>
                  </span>
                </span>
              </a>
              <button
                type="button"
                onClick={() => openSourceLightbox(item)}
                className="absolute top-2 left-2 z-10 flex size-9 cursor-zoom-in items-center justify-center rounded-md border border-white/20 bg-black/50 text-white shadow-sm backdrop-blur-sm transition hover:scale-105 hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                aria-label={`${labels.openImage}: ${item.title}`}
                title={labels.openImage}
              >
                <Icon icon="ri:zoom-in-line" className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => copyPrompt(item)}
                onPointerDown={() => prefetchPromptChoices(item)}
                className="absolute top-2 right-2 z-10 flex size-9 items-center justify-center rounded-md border border-white/20 bg-black/50 text-white shadow-sm backdrop-blur-sm transition hover:scale-105 hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                aria-label={`${copyErrorSlug === item.slug ? labels.copyRetry : copiedSlug === item.slug ? labels.copied : labels.copy}: ${item.title}`}
                title={copyErrorSlug === item.slug ? labels.copyRetry : copiedSlug === item.slug ? labels.copied : labels.copy}
              >
                <Icon
                  icon={
                    copyErrorSlug === item.slug
                      ? 'ri:error-warning-line'
                      : copiedSlug === item.slug
                        ? 'ri:check-line'
                        : 'ri:file-copy-line'
                  }
                  className="size-4"
                />
              </button>
            </div>
            <div className="space-y-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <a
                  href={`${galleryBasePath}/${item.slug}`}
                  data-astro-prefetch="false"
                  className="min-w-0"
                  aria-label={item.title}
                  title={item.title}
                >
                  <h2 className="line-clamp-1 font-semibold text-base text-gray-900 leading-6 transition group-hover:text-rose-600 dark:text-white">
                    {item.imageHash.slice(0, 12)}
                  </h2>
                </a>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 font-medium text-[11px] text-rose-500 tabular-nums dark:bg-rose-950/50 dark:text-rose-200">
                    {dateFormatter.format(new Date(item.date))}
                  </span>
                  {item.imageCount > 1 && (
                    <span className="rounded-full bg-sky-50 px-2 py-0.5 font-medium text-[11px] text-sky-600 dark:bg-sky-950/50 dark:text-sky-200">
                      {labels.imageCount.replace('{count}', String(item.imageCount))}
                    </span>
                  )}
                </div>
              </div>
              <p className="line-clamp-3 text-pretty text-gray-600 text-sm leading-5 dark:text-gray-300">
                {item.promptExcerpt}
              </p>
            </div>
          </article>
        ))}
      </StyleGalleryGrid>

      {visibleItems.length === 0 && (
        <div className="rounded-lg border border-rose-200 border-dashed bg-white/70 p-10 text-center text-gray-500 dark:border-gray-800 dark:bg-gray-950/50">
          {labels.noMatches}
        </div>
      )}

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

      <Dialog open={Boolean(promptPicker)} onOpenChange={(open) => !open && setPromptPicker(null)}>
        <DialogContent
          stableScroll
          className="flex max-h-[min(80dvh,44rem)] max-w-2xl flex-col gap-0 overflow-hidden bg-white p-0 dark:bg-gray-950"
          overlayClassName="bg-black/65"
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            setPromptPicker(null);
          }}
          onPointerDownOutside={(event) => {
            event.preventDefault();
            setPromptPicker(null);
          }}
        >
          {promptPicker && (
            <StyleGalleryPromptChooser
              key={getStyleGalleryPromptChooserKey(
                getStyleGalleryPromptCacheKey(promptPicker.item.slug, promptPicker.item.promptRevision),
                promptPicker.prompts,
                promptPicker.failed,
              )}
              prompts={promptPicker.prompts}
              failed={promptPicker.failed}
              labels={{
                title: labels.promptChooserTitle,
                description: labels.promptChooserDescription,
                promptOption: labels.promptOption,
                unknownModel: labels.promptModelUnknown,
                loading: labels.promptLoading,
                loadFailed: labels.promptLoadFailed,
                copy: labels.copy,
                copied: labels.copied,
              }}
              onRetry={() => void copyPrompt(promptPicker.item)}
              onCopy={copySelectedPrompt}
              reduceMotion={shouldReduceMotion}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** 将渐进列表和 prompt 选择器的渲染异常限制在 Gallery 主交互区。 */
export default function StyleGalleryBrowser(props: StyleGalleryBrowserProps) {
  return (
    <ErrorBoundary FallbackComponent={InlineErrorFallback}>
      <NuqsAdapter>
        <StyleGalleryBrowserContent {...props} />
      </NuqsAdapter>
    </ErrorBoundary>
  );
}
