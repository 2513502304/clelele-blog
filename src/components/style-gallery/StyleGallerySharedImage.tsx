import {
  getReusableStyleGalleryImageUrl,
  invalidateStyleGalleryImageUrl,
  isStyleGalleryImageUrlLoaded,
  rememberLoadedStyleGalleryImage,
  subscribeStyleGalleryImageSource,
} from '@lib/style-gallery-image-client';
import { type ImgHTMLAttributes, useCallback, useEffect, useState } from 'react';
import type { StyleGalleryImageDimensions } from '@/types/style-gallery';

interface StyleGallerySharedImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onLoad' | 'onError'> {
  source: string;
  loadedSources: Set<string>;
  alt: string;
  dimensions?: StyleGalleryImageDimensions;
  naturalAspect?: boolean;
}

/**
 * Reuse the exact loaded URL when a card hands its image to Lightbox. Thumbnail
 * sources have their own cache identity: loading one must never mark its original
 * as decoded. Completed images retain their URL when refreshed signatures arrive.
 */
export default function StyleGallerySharedImage({
  source,
  loadedSources,
  alt,
  dimensions,
  naturalAspect,
  ...imageProps
}: StyleGallerySharedImageProps) {
  const [subscribedUrl, setSubscribedUrl] = useState<{ source: string; url: string } | null>(null);
  const [fallbackSource, setFallbackSource] = useState<string | null>(null);
  const reusableUrl = getReusableStyleGalleryImageUrl(source, loadedSources.has(source));
  // 状态必须与 canonical source 绑定。虚拟列表复用 React 节点时，旧 source 的 URL 不能短暂提交到新图片，
  // 否则 callback ref 会把旧 URL 错误登记为新 source 已加载。
  const renderedUrl =
    fallbackSource === source ? source : subscribedUrl?.source === source ? subscribedUrl.url : (reusableUrl ?? source);

  useEffect(() => {
    return subscribeStyleGalleryImageSource(source, (loadedUrl) => {
      setSubscribedUrl((current) => {
        const currentUrl = current?.source === source ? current.url : renderedUrl;
        return isStyleGalleryImageUrlLoaded(currentUrl) ? current : { source, url: loadedUrl };
      });
    });
  }, [renderedUrl, source]);

  const remember = useCallback(
    (image: HTMLImageElement | null) => rememberLoadedStyleGalleryImage(loadedSources, source, image, renderedUrl),
    [loadedSources, renderedUrl, source],
  );

  return (
    <img
      {...imageProps}
      style={
        naturalAspect
          ? {
              ...imageProps.style,
              display: 'block',
              width: '100%',
              height: 'auto',
              aspectRatio: dimensions ? `${dimensions.width} / ${dimensions.height}` : '4 / 5',
              objectFit: 'contain',
              transform: 'none',
            }
          : imageProps.style
      }
      width={naturalAspect ? (dimensions?.width ?? 4) : imageProps.width}
      height={naturalAspect ? (dimensions?.height ?? 5) : imageProps.height}
      ref={remember}
      src={renderedUrl}
      alt={alt}
      onLoad={(event) => remember(event.currentTarget)}
      onError={() => {
        if (renderedUrl === source) return;
        invalidateStyleGalleryImageUrl(source);
        setFallbackSource(source);
      }}
    />
  );
}
