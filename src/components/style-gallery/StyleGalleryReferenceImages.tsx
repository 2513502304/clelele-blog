import { ErrorBoundary, InlineErrorFallback } from '@components/common';
import { Icon } from '@iconify/react';
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
import { GalleryTagEditor, GalleryTagPills } from './StyleGalleryTags';

interface StyleGalleryReferenceImagesProps {
  images: StyleGalleryImageRef[];
  locale: string;
  basePath: string;
  importedAt: string;
  exampleCount: number;
  likeCount: number;
  exampleCountLabel: string;
  likeCountLabel: string;
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
  locale,
  basePath,
  importedAt,
  exampleCount,
  likeCount,
  exampleCountLabel,
  likeCountLabel,
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
      gallerySourceSlug: itemSlug,
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
      <GalleryTagEditor locale={locale} />
      {images.map((image, index) => {
        const indexedLabel = getReferenceImageLabel(index);
        const alt = image.sourceImageAlt ?? indexedLabel;
        return (
          <figure
            key={`${image.imageHash}:${index}`}
            id={getStyleGalleryLightboxElementId('detail-source', `${itemSlug}-${index}`)}
            tabIndex={-1}
            className="relative w-full min-w-0 overflow-hidden rounded-md bg-rose-50 dark:bg-gray-900"
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
                className="block h-auto w-full"
                width={image.dimensions?.width}
                height={image.dimensions?.height}
              />
            </button>
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2">
              <span className="glass-image-action rounded-lg px-2 py-1 font-mono text-white text-xs" title={image.imageHash}>
                {image.imageHash.slice(0, 12)}
                {images.length > 1 ? ` · ${index + 1}/${images.length}` : ''}
              </span>
              <time className="glass-image-action whitespace-nowrap rounded-lg px-2 py-1 text-white text-xs">{importedAt}</time>
            </div>
            <GalleryTagPills slug={itemSlug} locale={locale} basePath={basePath} overlay editable maxVisible={12} />
            <div className="pointer-events-none absolute right-2 bottom-2 flex items-center gap-1.5">
              <span
                className="gallery-image-badge inline-flex items-center gap-1 rounded-md bg-gray-950/80 px-2 py-1 font-bold text-white text-xs backdrop-blur-sm"
                title={exampleCountLabel}
              >
                <Icon icon="ri:image-2-fill" className="size-3" />
                {exampleCount}
              </span>
              <span
                className="gallery-image-badge inline-flex items-center gap-1 rounded-md bg-rose-500/90 px-2 py-1 font-bold text-white text-xs backdrop-blur-sm"
                title={likeCountLabel}
              >
                <Icon icon="ri:heart-3-fill" className="size-3" />
                {likeCount}
              </span>
            </div>
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
