import { Icon } from '@iconify/react';
import { STYLE_GALLERY_PLATFORMS } from '@lib/style-gallery-platforms';
import { openModal } from '@store/modal';
import { useMemo, useState } from 'react';
import type { StyleGalleryExampleOverviewItem } from '@/types/style-gallery';

interface Props {
  examples: StyleGalleryExampleOverviewItem[];
  galleryBasePath: string;
  labels: StyleGalleryExamplesOverviewLabels;
}

export interface StyleGalleryExamplesOverviewLabels {
  searchPlaceholder: string;
  platform: string;
  allPlatforms: string;
  otherPlatform: string;
  noMatches: string;
}

export default function StyleGalleryExamplesOverview({ examples, galleryBasePath, labels }: Props) {
  const [platform, setPlatform] = useState('all');
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return examples.filter((example) => {
      const matchesPlatform = platform === 'all' || example.model === platform;
      const matchesQuery =
        !normalizedQuery || `${example.sourceTitle} ${example.note ?? ''}`.toLowerCase().includes(normalizedQuery);
      return matchesPlatform && matchesQuery;
    });
  }, [examples, platform, query]);
  const lightboxImages = useMemo(
    () => filtered.map((example) => ({ src: example.src, alt: `${example.sourceTitle} ${example.model}` })),
    [filtered],
  );

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
      </div>

      {filtered.length ? (
        <div className="columns-4 gap-4 md:columns-1 lg:columns-2 xl:columns-3">
          {filtered.map((example) => (
            <figure
              key={`${example.sourceSlug}-${example.src}`}
              className="mb-4 break-inside-avoid overflow-hidden rounded-lg border border-border bg-background shadow-sm"
            >
              <button
                type="button"
                onClick={() => openLightbox(example)}
                className="group block w-full cursor-zoom-in overflow-hidden text-left"
              >
                <img
                  src={example.src}
                  alt={`${example.sourceTitle} ${example.model}`}
                  loading="lazy"
                  className="aspect-[4/5] w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                />
              </button>
              <figcaption className="space-y-3 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full bg-sky-50 px-2 py-1 font-semibold text-sky-600 text-xs dark:bg-sky-950/50 dark:text-sky-200">
                    {example.model || labels.otherPlatform}
                  </span>
                  {example.uploadedAt && (
                    <time className="text-muted-foreground text-xs">{new Date(example.uploadedAt).toLocaleDateString()}</time>
                  )}
                </div>
                {example.note && <p className="text-muted-foreground text-xs leading-5">{example.note}</p>}
                <a
                  href={`${galleryBasePath}/${example.sourceSlug}`}
                  data-astro-prefetch="false"
                  className="flex items-center gap-2 border-border border-t pt-3 text-sm transition hover:text-primary"
                >
                  <img
                    src={example.sourceImage}
                    alt={example.sourceImageAlt ?? example.sourceTitle}
                    loading="lazy"
                    className="size-9 shrink-0 rounded-md object-cover"
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{example.sourceTitle}</span>
                  <Icon icon="ri:arrow-right-s-line" className="size-4 shrink-0" />
                </a>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div className="flex min-h-52 items-center justify-center rounded-lg border border-border border-dashed text-muted-foreground text-sm">
          {labels.noMatches}
        </div>
      )}
    </section>
  );
}
