import { Icon } from '@iconify/react';
import { useReducedMotion } from 'motion/react';
import type { StyleGalleryExampleOverviewItem } from '@/types/style-gallery';
import StyleGallerySharedImage from './StyleGallerySharedImage';

/** Three decorative layers represent any group size; hover changes transforms, never masonry geometry. */
export default function StyleGallerySourceStack({
  examples,
  loadedSources,
  onOpen,
  label,
  eager,
}: {
  examples: StyleGalleryExampleOverviewItem[];
  loadedSources: Set<string>;
  onOpen: () => void;
  label: string;
  eager: boolean;
}) {
  const shouldReduceMotion = useReducedMotion();
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      data-reduced-motion={shouldReduceMotion ? 'true' : undefined}
      className="gallery-source-stack relative block aspect-[4/5] w-full overflow-hidden bg-muted/40 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-[-2px]"
    >
      {examples
        .slice(0, 3)
        .reverse()
        .map((example, index, layers) => (
          <div
            key={example.id}
            className="gallery-stack-layer absolute inset-x-[14%] top-[10%] h-[78%] overflow-hidden rounded-xl border-4 border-background bg-background shadow-md"
            data-layer={layers.length - index - 1}
          >
            <StyleGallerySharedImage
              source={example.src}
              loadedSources={loadedSources}
              alt=""
              aria-hidden="true"
              loading={eager ? 'eager' : 'lazy'}
              width={4}
              height={5}
              className="block size-full object-cover"
            />
          </div>
        ))}
      <span className="absolute right-3 bottom-3 flex items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-1 text-white text-xs backdrop-blur-sm">
        <Icon icon="ri:stack-line" />
        {examples.length}
      </span>
    </button>
  );
}
