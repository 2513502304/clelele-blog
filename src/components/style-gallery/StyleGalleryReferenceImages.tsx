import { createStyleGallerySourceLightboxData, type StyleGalleryLightboxCopyLabels } from '@lib/style-gallery-lightbox-actions';
import { getSelectedStyleGalleryPrompt } from '@lib/style-gallery-prompt-selection';
import { openModal } from '@store/modal';
import type { StyleGalleryImageRef } from '@/types/style-gallery';

interface StyleGalleryReferenceImagesProps {
  images: StyleGalleryImageRef[];
  itemSlug: string;
  title: string;
  prompt: string;
  openImageLabel: string;
  lightboxCopyLabels: StyleGalleryLightboxCopyLabels;
}

/**
 * 详情页参考原图。单击图片进入通用 lightbox；多图 item 的左右导航只覆盖当前 item 的参考图，
 * 复制动作在执行时读取详情页最近选择的 prompt，不携带生成示例专属的点赞或删除权限。
 */
export default function StyleGalleryReferenceImages({
  images,
  itemSlug,
  title,
  prompt,
  openImageLabel,
  lightboxCopyLabels,
}: StyleGalleryReferenceImagesProps) {
  function openReferenceImage(currentIndex: number) {
    const lightboxItems = images.map((image, index) => ({
      id: `${image.imageHash}:${index}`,
      src: image.sourceImage,
      previewSrc: image.sourceImage,
      alt: image.sourceImageAlt ?? `${title} reference image ${index + 1}`,
      getPrompt: () => getSelectedStyleGalleryPrompt(itemSlug) ?? prompt,
    }));
    openModal(
      'imageLightbox',
      createStyleGallerySourceLightboxData(lightboxItems, lightboxItems[currentIndex].id, lightboxCopyLabels),
    );
  }

  return (
    <div className={`grid gap-3 ${images.length > 1 ? 'grid-cols-2 md:grid-cols-1' : 'grid-cols-1'}`}>
      {images.map((image, index) => {
        const alt = image.sourceImageAlt ?? `${title} reference image ${index + 1}`;
        return (
          <figure key={`${image.imageHash}:${index}`} className="overflow-hidden rounded-md bg-rose-50 dark:bg-gray-900">
            <button
              type="button"
              onClick={() => openReferenceImage(index)}
              className="group block w-full cursor-zoom-in overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
              aria-label={`${openImageLabel}: ${alt}`}
              title={openImageLabel}
            >
              <img
                src={image.sourceImage}
                alt={alt}
                loading={index === 0 ? 'eager' : 'lazy'}
                fetchPriority={index === 0 ? 'high' : 'auto'}
                decoding="async"
                className="max-h-[68vh] w-full object-contain transition duration-200 group-hover:scale-[1.01]"
              />
            </button>
            {images.length > 1 && (
              <figcaption className="flex items-center justify-between gap-2 px-3 py-2 text-gray-500 text-xs dark:text-gray-300">
                <span className="font-bold">Reference {index + 1}</span>
                <span className="truncate font-mono" title={image.imageHash}>
                  {image.imageHash.slice(0, 12)}
                </span>
              </figcaption>
            )}
          </figure>
        );
      })}
    </div>
  );
}
