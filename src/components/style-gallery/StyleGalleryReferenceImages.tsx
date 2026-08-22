import { ErrorBoundary, InlineErrorFallback } from '@components/common';
import { rememberLoadedStyleGalleryImage } from '@lib/style-gallery-image-client';
import {
  createStyleGallerySourceLightboxData,
  getStyleGalleryLightboxElementId,
  locateStyleGalleryElement,
  type StyleGalleryLightboxCopyLabels,
} from '@lib/style-gallery-lightbox-actions';
import { loadStyleGalleryPromptChoices } from '@lib/style-gallery-prompt-client';
import { getSelectedStyleGalleryPrompt } from '@lib/style-gallery-prompt-selection';
import { openModal } from '@store/modal';
import { useRef } from 'react';
import type { StyleGalleryImageRef } from '@/types/style-gallery';

interface StyleGalleryReferenceImagesProps {
  images: StyleGalleryImageRef[];
  itemSlug: string;
  prompt: string;
  promptCount: number;
  promptRevision: string;
  openImageLabel: string;
  referenceImageLabel: string;
  lightboxCopyLabels: StyleGalleryLightboxCopyLabels;
}

/**
 * 详情页参考原图。单击图片进入通用 lightbox；多图 item 的左右导航只覆盖当前 item 的参考图，
 * 复制动作在执行时读取详情页最近选择的 prompt，不携带生成示例专属的点赞或删除权限。
 */
function StyleGalleryReferenceImagesContent({
  images,
  itemSlug,
  prompt,
  promptCount,
  promptRevision,
  openImageLabel,
  referenceImageLabel,
  lightboxCopyLabels,
}: StyleGalleryReferenceImagesProps) {
  // 详情页展示的就是高清原图，成功加载后无需在 Lightbox 中换一条签名 URL 再下载一次。
  const loadedSourceImages = useRef(new Set<string>());
  const getReferenceImageLabel = (index: number) => referenceImageLabel.replace('{index}', String(index + 1));

  function openReferenceImage(currentIndex: number) {
    const lightboxItems = images.map((image, index) => ({
      id: `${image.imageHash}:${index}`,
      src: image.sourceImage,
      previewSrc: image.sourceImage,
      sourceLoaded: loadedSourceImages.current.has(image.sourceImage),
      alt: image.sourceImageAlt ?? getReferenceImageLabel(index),
      getPrompt: () => getSelectedStyleGalleryPrompt(itemSlug) ?? prompt,
      promptOptions:
        promptCount > 1
          ? { promptCount, getPrompts: () => loadStyleGalleryPromptChoices(itemSlug, promptRevision) }
          : undefined,
      locate: () => locateStyleGalleryElement(getStyleGalleryLightboxElementId('detail-source', `${itemSlug}-${index}`)),
    }));
    openModal(
      'imageLightbox',
      createStyleGallerySourceLightboxData(lightboxItems, lightboxItems[currentIndex].id, lightboxCopyLabels),
    );
  }

  return (
    <div className={`grid gap-3 ${images.length > 1 ? 'grid-cols-2 md:grid-cols-1' : 'grid-cols-1'}`}>
      {images.map((image, index) => {
        const indexedLabel = getReferenceImageLabel(index);
        const alt = image.sourceImageAlt ?? indexedLabel;
        return (
          <figure
            key={`${image.imageHash}:${index}`}
            id={getStyleGalleryLightboxElementId('detail-source', `${itemSlug}-${index}`)}
            tabIndex={-1}
            className="overflow-hidden rounded-md bg-rose-50 dark:bg-gray-900"
          >
            <button
              type="button"
              onClick={() => openReferenceImage(index)}
              className="group block w-full cursor-zoom-in overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
              aria-label={`${openImageLabel}: ${alt}`}
              title={openImageLabel}
            >
              <img
                ref={(sourceImage) =>
                  rememberLoadedStyleGalleryImage(loadedSourceImages.current, image.sourceImage, sourceImage)
                }
                src={image.sourceImage}
                alt={alt}
                loading={index === 0 ? 'eager' : 'lazy'}
                fetchPriority={index === 0 ? 'high' : 'auto'}
                decoding="async"
                onLoad={(event) =>
                  rememberLoadedStyleGalleryImage(loadedSourceImages.current, image.sourceImage, event.currentTarget)
                }
                className="max-h-[68vh] w-full object-contain transition duration-200 group-hover:scale-[1.01]"
              />
            </button>
            {images.length > 1 && (
              <figcaption className="flex items-center justify-between gap-2 px-3 py-2 text-gray-500 text-xs dark:text-gray-300">
                <span className="font-bold">{indexedLabel}</span>
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

/** 参考图交互异常仅替换当前图片区域，避免影响详情页 prompt 与 Sub-gallery。 */
export default function StyleGalleryReferenceImages(props: StyleGalleryReferenceImagesProps) {
  return (
    <ErrorBoundary FallbackComponent={InlineErrorFallback}>
      <StyleGalleryReferenceImagesContent {...props} />
    </ErrorBoundary>
  );
}
