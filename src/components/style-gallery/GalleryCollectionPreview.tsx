import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@components/ui/dialog';
import { useStore } from '@nanostores/react';
import { $imageLightboxData, closeModal, openModal } from '@store/modal';
import { useEffect, useId, useRef, useState } from 'react';
import GalleryImageStack from './GalleryImageStack';

interface PreviewImage {
  src: string;
  thumbnail?: string;
  alt?: string;
}

/** Use the sub-gallery fan and shared lightbox. Only active originals load in the viewer;
 * owned blob URLs live as long as the draft and never revoke remote sources.
 */
export default function GalleryCollectionPreview({
  files,
  images,
  locale,
  label,
  onRemove,
}: {
  files?: File[];
  images?: PreviewImage[];
  locale: string;
  label?: string;
  onRemove?: (file: File) => void;
}) {
  const [urls, setUrls] = useState<string[]>([]);
  const zh = locale.startsWith('zh');
  const ownerId = useId();
  const [active, setActive] = useState<number | null>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLDivElement | null>(null);
  const viewer = useStore($imageLightboxData);
  const [opened, setOpened] = useState(false);
  const localUrls = useRef(new Map<File, string>());
  useEffect(() => {
    const retained = new Set(files ?? []);
    for (const [file, url] of localUrls.current) {
      if (!retained.has(file)) {
        URL.revokeObjectURL(url);
        localUrls.current.delete(file);
      }
    }
    const next = files
      ? files.map((file) => {
          let url = localUrls.current.get(file);
          if (!url) {
            url = URL.createObjectURL(file);
            localUrls.current.set(file, url);
          }
          return url;
        })
      : (images ?? []).map((image) => image.src);
    setUrls(next);
  }, [files, images]);
  useEffect(() => {
    const owned = localUrls.current;
    return () => {
      if ($imageLightboxData.get()?.ownerId === ownerId) closeModal();
      for (const url of owned.values()) URL.revokeObjectURL(url);
      owned.clear();
    };
  }, [ownerId]);
  function preview(index: number) {
    setActive(index);
  }
  useEffect(() => {
    if (active === null || !portalRoot || opened) return;
    openModal('imageLightbox', {
      src: urls[active],
      alt: files?.[active]?.name ?? images?.[active]?.alt ?? '',
      currentIndex: active,
      previewOnly: true,
      portalRoot,
      ownerId,
      prefetch: { preloadAhead: 0, nextBatchThreshold: 0 },
      images: urls.map((src, i) => ({
        id: src,
        src,
        previewSrc: images?.[i]?.thumbnail,
        alt: files?.[i]?.name ?? images?.[i]?.alt ?? '',
        ...(files?.[i] && onRemove
          ? {
              delete: {
                imageId: src,
                label: zh ? '移除当前图片' : 'Remove current image',
                deletingLabel: zh ? '正在移除' : 'Removing',
                failedLabel: zh ? '移除失败' : 'Unable to remove',
                unavailableLabel: '',
                enabled: true,
                confirmMessage: zh
                  ? '从本次收藏中移除这张图片？原文件不会被删除。'
                  : 'Remove this image from the collection draft? The original file will not be deleted.',
                // Capture File identity rather than an index: later removals shift the remaining positions.
                run: async () => {
                  onRemove(files[i]);
                  return true;
                },
              },
            }
          : {}),
      })),
    });
    setOpened(true);
  }, [active, portalRoot, opened, urls, files, images, ownerId, onRemove, zh]);
  useEffect(() => {
    if (opened && viewer?.ownerId !== ownerId) {
      setActive(null);
      setOpened(false);
    }
  }, [viewer, opened, ownerId]);
  if (!urls.length) return null;
  return (
    <div className="space-y-3">
      <div className="mx-auto w-full max-w-sm overflow-hidden rounded-2xl border border-border">
        <GalleryImageStack
          onOpen={() => preview(0)}
          label={zh ? `预览 ${urls.length} 张${label ?? '参考图片'}` : `Preview ${urls.length} ${label ?? 'reference images'}`}
          images={urls.slice(0, 3).map((url, i) => ({
            key: url,
            content: (
              <img src={images?.[i]?.thumbnail ?? url} alt="" draggable={false} className="block size-full object-cover" />
            ),
          }))}
          badge={
            <span className="absolute right-3 bottom-3 rounded-full bg-black/65 px-3 py-1.5 text-white text-xs backdrop-blur-sm">
              {urls.length} {zh ? '张 · 点击预览' : 'images · Preview'}
            </span>
          }
        />
      </div>
      {/* The shared viewer portals inside a real nested Radix scope. Do not toggle the
          parent modal mode: Radix would remount its children and revoke draft blob URLs. */}
      <Dialog
        open={active !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeModal();
            setActive(null);
            setOpened(false);
          }
        }}
      >
        <DialogContent
          stableScroll
          showClose={false}
          ref={setPortalRoot}
          style={{ top: 0, left: 0, translate: 'none' }}
          className="z-[60] h-dvh w-screen max-w-none overflow-hidden rounded-none border-0 bg-black p-0"
          overlayClassName="z-[60] bg-black/90"
        >
          <DialogTitle className="sr-only">
            {zh ? `${label ?? '参考图片'}预览` : `${label ?? 'Reference image'} preview`}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {zh ? '缩放、旋转或切换图片，关闭后继续编辑。' : 'Zoom, rotate or switch images; close to continue editing.'}
          </DialogDescription>
        </DialogContent>
      </Dialog>
    </div>
  );
}
