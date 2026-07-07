import { Icon } from '@iconify/react';
import { useMemo, useRef, useState } from 'react';

export interface StyleGalleryBrowserItem {
  slug: string;
  title: string;
  description?: string;
  date: string;
  sourceImage: string;
  thumbnailImage?: string;
  sourceImageAlt?: string;
  imageHash: string;
  imageCount: number;
  tags: string[];
  modelTargets: string[];
  exampleCount: number;
}

interface StyleGalleryBrowserProps {
  items: StyleGalleryBrowserItem[];
  tags: string[];
  galleryBasePath: string;
}

type SortMode = 'latest' | 'title' | 'examples';

const sortLabels: Record<SortMode, string> = {
  latest: 'Latest',
  title: 'Title',
  examples: 'Examples',
};

function normalize(value: string) {
  return value.toLowerCase().trim();
}

export default function StyleGalleryBrowser({ items, tags, galleryBasePath }: StyleGalleryBrowserProps) {
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string>('all');
  const [sortMode, setSortMode] = useState<SortMode>('latest');
  const [copyingSlug, setCopyingSlug] = useState<string | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const [copyErrorSlug, setCopyErrorSlug] = useState<string | null>(null);
  const promptCache = useRef(new Map<string, string>());

  const visibleItems = useMemo(() => {
    const q = normalize(query);
    const filtered = items.filter((item) => {
      const matchesTag = activeTag === 'all' || item.tags.includes(activeTag);
      const searchable = [item.title, item.description, ...item.tags, ...item.modelTargets].filter(Boolean).join(' ');
      const matchesQuery = !q || normalize(searchable).includes(q);
      return matchesTag && matchesQuery;
    });

    return [...filtered].sort((a, b) => {
      if (sortMode === 'title') return a.title.localeCompare(b.title);
      if (sortMode === 'examples') return b.exampleCount - a.exampleCount || b.date.localeCompare(a.date);
      return b.date.localeCompare(a.date);
    });
  }, [activeTag, items, query, sortMode]);

  async function copyPrompt(slug: string) {
    setCopyingSlug(slug);
    setCopyErrorSlug(null);
    try {
      let prompt = promptCache.current.get(slug);
      if (!prompt) {
        const response = await fetch(`/image-style-prompt-gallery/prompts/${slug}.json`);
        if (!response.ok) throw new Error(`Prompt request failed with ${response.status}`);
        const data = (await response.json()) as { prompt?: string };
        if (!data.prompt) throw new Error('Prompt response is empty');
        prompt = data.prompt;
        promptCache.current.set(slug, prompt);
      }
      await navigator.clipboard.writeText(prompt);
      setCopiedSlug(slug);
      window.setTimeout(() => setCopiedSlug((current) => (current === slug ? null : current)), 1800);
    } catch {
      setCopyErrorSlug(slug);
      window.setTimeout(() => setCopyErrorSlug((current) => (current === slug ? null : current)), 2400);
    } finally {
      setCopyingSlug((current) => (current === slug ? null : current));
    }
  }

  return (
    <section className="space-y-6" aria-label="Image style prompt gallery browser">
      <div className="rounded-lg border border-rose-100 bg-white/75 p-4 shadow-sm dark:border-rose-950/60 dark:bg-gray-950/60">
        <div className="grid grid-cols-[1fr_auto] items-center gap-3 md:grid-cols-1">
          <label className="relative block">
            <Icon icon="ri:search-line" className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-rose-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search prompt, tag, model..."
              className="h-11 w-full rounded-lg border border-rose-100 bg-white pr-3 pl-10 text-sm outline-none transition focus:border-rose-300 focus:ring-4 focus:ring-rose-100 dark:border-gray-800 dark:bg-gray-900 dark:focus:border-rose-700 dark:focus:ring-rose-950"
            />
          </label>
          <div className="flex h-11 rounded-lg border border-rose-100 bg-rose-50/70 p-1 dark:border-gray-800 dark:bg-gray-900">
            {(Object.keys(sortLabels) as SortMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setSortMode(mode)}
                className={`min-w-[5.5rem] rounded-md px-3 font-bold text-xs transition ${
                  sortMode === mode
                    ? 'bg-white text-rose-600 shadow-sm dark:bg-gray-800 dark:text-rose-200'
                    : 'text-gray-500 hover:text-rose-500 dark:text-gray-400'
                }`}
              >
                {sortLabels[mode]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {['all', ...tags].map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setActiveTag(tag)}
              className={`rounded-full border px-3 py-1.5 font-bold text-xs transition ${
                activeTag === tag
                  ? 'border-rose-300 bg-rose-500 text-white shadow-sm'
                  : 'border-rose-100 bg-white text-gray-500 hover:border-rose-200 hover:text-rose-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300'
              }`}
            >
              {tag === 'all' ? 'All' : tag}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 md:grid-cols-1 xl:grid-cols-2">
        {visibleItems.map((item) => (
          <article
            key={item.slug}
            className="group overflow-hidden rounded-lg border border-rose-100 bg-white shadow-sm transition hover:-translate-y-1 hover:border-rose-200 hover:shadow-lg dark:border-gray-800 dark:bg-gray-950"
          >
            <a
              href={`${galleryBasePath}/${item.slug}`}
              data-astro-prefetch="false"
              className="block aspect-[4/5] overflow-hidden bg-rose-50 dark:bg-gray-900"
            >
              <img
                src={item.thumbnailImage ?? item.sourceImage}
                alt={item.sourceImageAlt ?? item.title}
                loading="lazy"
                className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
              />
            </a>
            <div className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <a href={`${galleryBasePath}/${item.slug}`} data-astro-prefetch="false" className="min-w-0">
                  <h2 className="line-clamp-1 font-bold text-gray-900 text-lg transition group-hover:text-rose-600 dark:text-white">
                    {item.title}
                  </h2>
                </a>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="rounded-full bg-rose-50 px-2 py-1 font-bold text-[11px] text-rose-500 dark:bg-rose-950/50 dark:text-rose-200">
                    {new Date(item.date).toLocaleDateString()}
                  </span>
                  {item.imageCount > 1 && (
                    <span className="rounded-full bg-sky-50 px-2 py-1 font-bold text-[11px] text-sky-600 dark:bg-sky-950/50 dark:text-sky-200">
                      {item.imageCount} images
                    </span>
                  )}
                </div>
              </div>
              <p className="line-clamp-4 min-h-22 text-pretty text-gray-600 text-sm leading-6 dark:text-gray-300">
                {item.description}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {item.modelTargets.slice(0, 4).map((target) => (
                  <span
                    key={target}
                    className="rounded-full bg-sky-50 px-2 py-1 font-semibold text-[11px] text-sky-600 dark:bg-sky-950/50 dark:text-sky-200"
                  >
                    {target}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => copyPrompt(item.slug)}
                  disabled={copyingSlug === item.slug}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-rose-100 bg-white px-3 font-bold text-gray-700 text-sm transition hover:border-rose-200 hover:text-rose-600 disabled:cursor-wait disabled:opacity-70 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-rose-800 dark:hover:text-rose-200"
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
                  {copyErrorSlug === item.slug
                    ? 'Retry'
                    : copiedSlug === item.slug
                      ? 'Copied'
                      : copyingSlug === item.slug
                        ? 'Copying'
                        : 'Copy'}
                </button>
                <a
                  href={`${galleryBasePath}/${item.slug}`}
                  data-astro-prefetch="false"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-gray-950 px-3 font-bold text-sm text-white transition hover:bg-rose-600 dark:bg-white dark:text-gray-950 dark:hover:bg-rose-200"
                >
                  <Icon icon="ri:gallery-view-2" className="size-4" />
                  View
                </a>
              </div>
            </div>
          </article>
        ))}
      </div>

      {visibleItems.length === 0 && (
        <div className="rounded-lg border border-rose-200 border-dashed bg-white/70 p-10 text-center text-gray-500 dark:border-gray-800 dark:bg-gray-950/50">
          No style prompts match the current filters.
        </div>
      )}
    </section>
  );
}
