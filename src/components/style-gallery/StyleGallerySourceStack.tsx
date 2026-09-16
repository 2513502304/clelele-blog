import { Icon } from '@iconify/react';
import { getStyleGalleryExampleThumbnailSource } from '@lib/style-gallery-image-key';
import type { StyleGalleryExampleOverviewItem } from '@/types/style-gallery';
import GalleryImageStack from './GalleryImageStack';
import StyleGallerySharedImage from './StyleGallerySharedImage';

/** Three decorative layers represent any group size; hover changes transforms, never masonry geometry. */
export default function StyleGallerySourceStack({
  examples,
  likeCount,
  likesLabel,
  loadedSources,
  onOpen,
  label,
  eager,
}: {
  examples: StyleGalleryExampleOverviewItem[];
  likeCount: number;
  likesLabel: string;
  loadedSources: Set<string>;
  onOpen: () => void;
  label: string;
  eager: boolean;
}) {
  return (
    <GalleryImageStack
      onOpen={onOpen}
      label={`${label} · ${likesLabel}: ${likeCount}`}
      images={examples.slice(0, 3).map((example) => ({
        key: example.id,
        content: (
          <StyleGallerySharedImage
            source={getStyleGalleryExampleThumbnailSource(example.src)}
            loadedSources={loadedSources}
            alt=""
            aria-hidden="true"
            loading={eager ? 'eager' : 'lazy'}
            width={4}
            height={5}
            className="block size-full object-cover"
          />
        ),
      }))}
      badge={
        <span className="absolute right-2 bottom-2 flex items-center gap-2 text-xs tabular-nums">
          <span className="gallery-image-badge flex items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-1 text-white backdrop-blur-sm">
            <Icon icon="ri:stack-line" />
            {examples.length}
          </span>
          <span
            data-group-likes={likeCount}
            title={likesLabel}
            className="gallery-image-badge flex items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-1 text-white backdrop-blur-sm"
          >
            <Icon icon="ri:heart-fill" className="text-rose-400" />
            <span className="sr-only">{likesLabel}: </span>
            {likeCount}
          </span>
        </span>
      }
    />
  );
}
