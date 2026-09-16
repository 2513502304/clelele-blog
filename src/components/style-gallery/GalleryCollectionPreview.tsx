import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@components/ui/dialog';
import { useZoomPan } from '@hooks/useZoomPan';
import { Icon } from '@iconify/react';
import { useEffect, useState } from 'react';

interface PreviewImage {
  src: string;
  thumbnail?: string;
  alt?: string;
}

/** A bounded stack and viewing-only lightbox; local files never trigger network writes.
 * Closing this nested viewer must preserve the parent draft and its html scroll lock.
 * Remote stacks use thumbnails; only the active original is mounted, regardless of group size.
 */
export default function GalleryCollectionPreview({
  files,
  images,
  locale,
}: {
  files?: File[];
  images?: PreviewImage[];
  locale: string;
}) {
  const [urls, setUrls] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const { containerRef, state, reset, zoomTo } = useZoomPan(index !== null);
  const zh = locale.startsWith('zh');
  useEffect(() => {
    const next = files ? files.map((file) => URL.createObjectURL(file)) : (images ?? []).map((image) => image.src);
    setUrls(next);
    setIndex(null);
    return () =>
      next.forEach((url) => {
        if (files) URL.revokeObjectURL(url);
      });
  }, [files, images]);
  function select(next: number) {
    reset();
    setLoaded(null);
    setIndex(next);
  }
  if (!urls.length) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => select(0)}
        aria-label={zh ? `预览 ${urls.length} 张参考图片` : `Preview ${urls.length} reference images`}
        className="group relative mx-auto block h-44 w-56 rounded-xl focus-visible:outline-2 focus-visible:outline-primary"
      >
        {urls
          .slice(0, 3)
          .reverse()
          .map((url, reverseIndex) => {
            const layer = Math.min(urls.length, 3) - 1 - reverseIndex;
            return (
              <img
                key={url}
                src={images?.[layer]?.thumbnail ?? url}
                alt=""
                draggable={false}
                className={`absolute inset-x-6 top-2 h-36 w-40 rounded-xl border-2 border-background bg-muted object-contain shadow-md transition-transform duration-300 motion-reduce:transition-none ${layer === 2 ? 'translate-x-3 rotate-6 group-hover:translate-x-6 group-hover:rotate-12' : layer === 1 ? '-translate-x-2 -rotate-3 group-hover:-translate-x-6 group-hover:-rotate-12' : ''}`}
              />
            );
          })}
        <span className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full bg-foreground/85 px-3 py-1 text-background text-xs">
          {urls.length} {zh ? '张 · 点击预览' : 'images · Preview'}
        </span>
      </button>
      <Dialog
        open={index !== null}
        onOpenChange={(open) => {
          if (!open) setIndex(null);
        }}
      >
        <DialogContent
          stableScroll
          className="z-[60] h-[90dvh] w-[calc(100%-2rem)] max-w-6xl overflow-hidden border-white/15 bg-black p-0 text-white"
          overlayClassName="z-[60] bg-black/90"
        >
          <DialogTitle className="sr-only">{zh ? '参考图片预览' : 'Reference image preview'}</DialogTitle>
          <DialogDescription className="sr-only">
            {zh ? '滚轮缩放、拖动查看；左右切换图片。' : 'Scroll to zoom, drag to pan; switch with the arrows.'}
          </DialogDescription>
          {/* biome-ignore lint/a11y/useSemanticElements: shared zoom/pan hook owns an HTMLDivElement viewport; keyboard zoom is provided. */}
          <div
            role="button"
            tabIndex={0}
            aria-label={zh ? '缩放图片' : 'Zoom image'}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                state.scale > 1 ? reset() : zoomTo(2);
              }
              if (event.key === 'ArrowRight' && index !== null && index < urls.length - 1) select(index + 1);
              if (event.key === 'ArrowLeft' && index !== null && index > 0) select(index - 1);
            }}
            ref={containerRef}
            className="absolute inset-0 touch-none overflow-hidden"
            onDoubleClick={() => (state.scale > 1 ? reset() : zoomTo(2))}
          >
            {index !== null && images?.[index]?.thumbnail && loaded !== urls[index] && (
              <img src={images[index].thumbnail} alt="" className="absolute inset-0 h-full w-full object-contain p-8 pb-16" />
            )}
            {index !== null && urls[index] && (
              <img
                src={urls[index]}
                alt={files?.[index]?.name ?? images?.[index]?.alt ?? ''}
                onLoad={() => setLoaded(urls[index])}
                draggable={false}
                className="h-full w-full select-none object-contain p-8 pb-16"
                style={{
                  opacity: images?.[index]?.thumbnail && loaded !== urls[index] ? 0 : 1,
                  transform: `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`,
                }}
              />
            )}
          </div>
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-4 rounded-full bg-white/10 px-3 py-2 text-sm backdrop-blur">
            <button
              type="button"
              aria-label={zh ? '上一张' : 'Previous image'}
              disabled={index === 0}
              onClick={() => select((index ?? 0) - 1)}
              className="rounded-full p-2 disabled:opacity-30"
            >
              <Icon icon="ri:arrow-left-s-line" />
            </button>
            <span>
              {(index ?? 0) + 1} / {urls.length}
            </span>
            <button
              type="button"
              aria-label={zh ? '下一张' : 'Next image'}
              disabled={index === urls.length - 1}
              onClick={() => select((index ?? 0) + 1)}
              className="rounded-full p-2 disabled:opacity-30"
            >
              <Icon icon="ri:arrow-right-s-line" />
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
