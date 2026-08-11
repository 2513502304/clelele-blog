import { useCollectionPagination } from '@hooks/useCollectionPagination';
import { Icon } from '@iconify/react';
import { groupStyleGalleryPromptsByModel } from '@lib/style-gallery-prompt-groups';
import { useMemo, useRef, useState } from 'react';
import { CollectionPaginationSettings, CollectionPaginator } from '../collection/CollectionPagination';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';

export interface StyleGalleryBrowserItem {
  slug: string;
  title: string;
  prompt: string;
  additionalPrompts: string[];
  promptCount: number;
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
  tags: string[];
  modelTargets: string[];
  galleryBasePath: string;
  dateLocale: string;
  labels: StyleGalleryBrowserLabels;
}

export interface StyleGalleryBrowserLabels {
  searchPlaceholder: string;
  allTags: string;
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
  noMatches: string;
}

type SortKey = 'default' | 'date' | 'id' | 'examples' | 'likes';
type SortDirection = 'asc' | 'desc';
interface PromptChoice {
  id: string;
  prompt: string;
  model?: string;
  importedAt: string;
}

interface PromptPickerState {
  item: StyleGalleryBrowserItem;
  prompts: PromptChoice[] | null;
  failed: boolean;
}
// 桌面端固定三列：前两行主动加载，但只让首行占用高网络优先级。
const EAGER_CARD_COUNT = 6;
const HIGH_PRIORITY_CARD_COUNT = 3;

function normalize(value: string) {
  return value.toLowerCase().trim();
}

/**
 * Gallery 主预览页：在 catalog 的全部 prompt 文本上搜索，再执行标签筛选、排序和本地分页。
 * 单 prompt 复制不读取详情；多 prompt 只在用户打开选择器时按需请求一次并缓存在浏览器内。
 */
export default function StyleGalleryBrowser({
  items,
  tags,
  modelTargets,
  galleryBasePath,
  dateLocale,
  labels,
}: StyleGalleryBrowserProps) {
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('default');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const [copyErrorSlug, setCopyErrorSlug] = useState<string | null>(null);
  const [promptPicker, setPromptPicker] = useState<PromptPickerState | null>(null);
  const promptCache = useRef(new Map<string, PromptChoice[]>());
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(dateLocale, { timeZone: 'Asia/Shanghai' }), [dateLocale]);
  const promptGroups = useMemo(() => groupStyleGalleryPromptsByModel(promptPicker?.prompts ?? []), [promptPicker?.prompts]);
  const sortLabels: Record<SortKey, string> = {
    default: labels.sortDefault,
    date: labels.sortImportedAt,
    id: labels.sortImageId,
    examples: labels.sortExampleCount,
    likes: labels.sortLikeCount,
  };

  const filteredItems = useMemo(() => {
    const q = normalize(query);
    const filtered = items.filter((item) => {
      const matchesTag = activeTag === 'all' || tags.includes(activeTag);
      const searchable = [item.title, item.prompt, ...item.additionalPrompts, ...tags, ...modelTargets]
        .filter(Boolean)
        .join(' ');
      const matchesQuery = !q || normalize(searchable).includes(q);
      return matchesTag && matchesQuery;
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
  }, [activeTag, items, modelTargets, query, sortDirection, sortKey, tags]);
  const { currentPage, isPaginated, pageSize, setCurrentPage, setIsPaginated, setPageSize, totalPages, visibleItems } =
    useCollectionPagination(filteredItems, 'style-gallery-pagination-settings');

  function handleQueryChange(value: string) {
    setQuery(value);
    setCurrentPage(1);
  }

  function handleTagChange(tag: string) {
    setActiveTag(tag);
    setCurrentPage(1);
  }

  function handleSortChange(key: SortKey) {
    setSortKey(key);
    setCurrentPage(1);
  }

  function toggleSortDirection() {
    setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    setCurrentPage(1);
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
      await copyPromptText(item, item.prompt);
      return;
    }

    const cached = promptCache.current.get(item.slug);
    setPromptPicker({ item, prompts: cached ?? null, failed: false });
    if (cached) return;
    try {
      const response = await fetch(`/api/style-gallery/prompts/${encodeURIComponent(item.slug)}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`Prompt request failed with HTTP ${response.status}.`);
      const data = (await response.json()) as { prompts?: PromptChoice[] };
      if (!data.prompts?.length) throw new Error('Prompt response was empty.');
      promptCache.current.set(item.slug, data.prompts);
      setPromptPicker((current) =>
        current?.item.slug === item.slug ? { ...current, prompts: data.prompts ?? [], failed: false } : current,
      );
    } catch {
      setPromptPicker((current) => (current?.item.slug === item.slug ? { ...current, prompts: null, failed: true } : current));
    }
  }

  async function copySelectedPrompt(prompt: PromptChoice) {
    if (!promptPicker) return;
    if (await copyPromptText(promptPicker.item, prompt.prompt)) setPromptPicker(null);
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
              placeholder={labels.searchPlaceholder}
              className="h-11 w-full rounded-lg border border-rose-100 bg-white pr-3 pl-10 text-sm outline-none transition focus:border-rose-300 focus:ring-4 focus:ring-rose-100 dark:border-gray-800 dark:bg-gray-900 dark:focus:border-rose-700 dark:focus:ring-rose-950"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {['all', ...tags].map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => handleTagChange(tag)}
              className={`rounded-full border px-3 py-1.5 font-bold text-xs transition ${
                activeTag === tag
                  ? 'border-rose-300 bg-rose-500 text-white shadow-sm'
                  : 'border-rose-100 bg-white text-gray-500 hover:border-rose-200 hover:text-rose-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300'
              }`}
            >
              {tag === 'all' ? labels.allTags : tag}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-rose-100 border-t pt-4 dark:border-gray-800">
          <CollectionPaginationSettings
            isPaginated={isPaginated}
            pageSize={pageSize}
            onModeChange={setIsPaginated}
            onPageSizeChange={setPageSize}
          />
          <div className="flex gap-2">
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
                onChange={(event) => handleSortChange(event.currentTarget.value as SortKey)}
                className="h-9 appearance-none rounded-md border border-border bg-background pr-8 pl-8 text-sm outline-none transition-colors hover:border-primary/40 focus:border-primary"
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
              onClick={toggleSortDirection}
              className="flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <Icon icon={sortDirection === 'asc' ? 'ri:sort-asc' : 'ri:sort-desc'} className="size-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 [@media(min-width:769px)]:grid-cols-2 [@media(min-width:993px)]:grid-cols-3">
        {visibleItems.map((item, index) => (
          <article
            key={item.slug}
            className="group overflow-hidden rounded-lg border border-rose-100 bg-white shadow-sm transition hover:-translate-y-1 hover:border-rose-200 hover:shadow-lg dark:border-gray-800 dark:bg-gray-950"
          >
            <a
              href={`${galleryBasePath}/${item.slug}`}
              data-astro-prefetch="false"
              className="relative block aspect-[4/5] overflow-hidden bg-rose-50 dark:bg-gray-900"
            >
              <img
                src={item.thumbnailImage ?? item.sourceImage}
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
            <div className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <a
                  href={`${galleryBasePath}/${item.slug}`}
                  data-astro-prefetch="false"
                  className="min-w-0"
                  aria-label={item.title}
                  title={item.title}
                >
                  <h2 className="line-clamp-1 font-bold text-gray-900 text-lg transition group-hover:text-rose-600 dark:text-white">
                    {item.imageHash.slice(0, 12)}
                  </h2>
                </a>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="rounded-full bg-rose-50 px-2 py-1 font-bold text-[11px] text-rose-500 dark:bg-rose-950/50 dark:text-rose-200">
                    {dateFormatter.format(new Date(item.date))}
                  </span>
                  {item.imageCount > 1 && (
                    <span className="rounded-full bg-sky-50 px-2 py-1 font-bold text-[11px] text-sky-600 dark:bg-sky-950/50 dark:text-sky-200">
                      {labels.imageCount.replace('{count}', String(item.imageCount))}
                    </span>
                  )}
                </div>
              </div>
              <p className="line-clamp-3 min-h-18 text-pretty text-gray-600 text-sm leading-6 dark:text-gray-300">
                {item.prompt}
              </p>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => copyPrompt(item)}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-rose-100 bg-white px-3 font-bold text-gray-700 text-sm transition hover:border-rose-200 hover:text-rose-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-rose-800 dark:hover:text-rose-200"
                  aria-label={`Copy prompt for ${item.title}`}
                  title="Copy prompt"
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
                  {copyErrorSlug === item.slug ? labels.copyRetry : copiedSlug === item.slug ? labels.copied : labels.copy}
                  {item.promptCount > 1 && copyErrorSlug !== item.slug && copiedSlug !== item.slug && (
                    <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-500 dark:bg-rose-950/50 dark:text-rose-200">
                      ×{item.promptCount}
                    </span>
                  )}
                </button>
                <a
                  href={`${galleryBasePath}/${item.slug}`}
                  data-astro-prefetch="false"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-gray-950 px-3 font-bold text-sm text-white transition hover:bg-rose-600 dark:bg-white dark:text-gray-950 dark:hover:bg-rose-200"
                >
                  <Icon icon="ri:gallery-view-2" className="size-4" />
                  {labels.view}
                </a>
              </div>
            </div>
          </article>
        ))}
      </div>

      {visibleItems.length === 0 && (
        <div className="rounded-lg border border-rose-200 border-dashed bg-white/70 p-10 text-center text-gray-500 dark:border-gray-800 dark:bg-gray-950/50">
          {labels.noMatches}
        </div>
      )}

      {isPaginated && <CollectionPaginator currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />}

      <Dialog open={Boolean(promptPicker)} onOpenChange={(open) => !open && setPromptPicker(null)}>
        <DialogContent
          className="max-h-[min(80vh,44rem)] max-w-2xl overflow-hidden p-0"
          overlayClassName="bg-black/55 backdrop-blur-sm"
        >
          <DialogHeader className="border-border border-b px-6 pt-6 pr-14 pb-4">
            <DialogTitle>{labels.promptChooserTitle}</DialogTitle>
            <DialogDescription>{labels.promptChooserDescription}</DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto px-4 pb-5">
            {!promptPicker?.prompts && !promptPicker?.failed && (
              <div className="flex min-h-32 items-center justify-center gap-2 text-muted-foreground text-sm">
                <Icon icon="ri:loader-4-line" className="size-4 animate-spin" />
                {labels.promptLoading}
              </div>
            )}
            {promptPicker?.failed && (
              <button
                type="button"
                onClick={() => copyPrompt(promptPicker.item)}
                className="flex min-h-32 w-full items-center justify-center gap-2 text-rose-500 text-sm"
              >
                <Icon icon="ri:refresh-line" className="size-4" />
                {labels.promptLoadFailed}
              </button>
            )}
            {promptPicker?.prompts && (
              <div className="space-y-5 pt-4">
                {promptGroups.map((group) => (
                  <section key={group.model ?? '__unknown__'} aria-label={group.model ?? labels.promptModelUnknown}>
                    <div className="mb-2 flex items-center gap-2 px-1">
                      <span className="truncate font-bold text-sm">{group.model ?? labels.promptModelUnknown}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
                        ×{group.prompts.length}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {group.prompts.map(({ prompt, modelIndex }) => (
                        <button
                          key={prompt.id}
                          type="button"
                          onClick={() => copySelectedPrompt(prompt)}
                          className="group/prompt w-full rounded-lg border border-border bg-background p-4 text-left transition hover:border-rose-300 hover:bg-rose-50/50 dark:hover:border-rose-800 dark:hover:bg-rose-950/20"
                        >
                          <span className="font-bold text-sm">
                            {labels.promptOption.replace('{index}', String(modelIndex))}
                          </span>
                          <span className="mt-2 line-clamp-3 block text-muted-foreground text-sm leading-6">
                            {prompt.prompt}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
