import type { ReactNode } from 'react';

/** Shared sub-gallery fan geometry: only three layers, with transforms that never change layout. */
export default function GalleryImageStack({
  images,
  onOpen,
  label,
  badge,
}: {
  images: { key: string; content: ReactNode }[];
  onOpen: () => void;
  label: string;
  badge: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className="gallery-source-stack relative block aspect-[4/5] w-full overflow-hidden bg-muted/40 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-[-2px]"
    >
      {images
        .slice(0, 3)
        .reverse()
        .map((image, index, layers) => (
          <div
            key={image.key}
            data-layer={layers.length - index - 1}
            className="gallery-stack-layer absolute inset-x-[14%] top-[10%] h-[78%] overflow-hidden rounded-xl border-4 border-background bg-background shadow-md"
          >
            {image.content}
          </div>
        ))}
      {badge}
    </button>
  );
}
