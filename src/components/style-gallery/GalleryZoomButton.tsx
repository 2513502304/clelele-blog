import { Icon } from '@iconify/react';

/** Only this explicit control warms an original; the larger image remains click-to-open. */
export default function GalleryZoomButton({
  source,
  title,
  locale,
  onOpen,
}: {
  source: string;
  title: string;
  locale: string;
  onOpen: () => void;
}) {
  const label = locale.startsWith('zh') ? '放大图片' : locale.startsWith('ja') ? '画像を拡大' : 'Enlarge image';
  return (
    <button
      type="button"
      onClick={onOpen}
      data-gallery-original={source}
      aria-label={`${label}: ${title}`}
      title={label}
      className="glass-image-action absolute top-2 right-2 z-10 flex size-9 cursor-zoom-in items-center justify-center rounded-lg text-white transition hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
    >
      <Icon icon="ri:zoom-in-line" className="size-4" />
    </button>
  );
}
