import {
  getReusableStyleGalleryImageUrl,
  invalidateStyleGalleryImageUrl,
  isStyleGalleryImageUrlLoaded,
  rememberLoadedStyleGalleryImage,
  subscribeStyleGalleryImageSource,
} from '@lib/style-gallery-image-client';
import { type ImgHTMLAttributes, useCallback, useEffect, useState } from 'react';

interface StyleGallerySharedImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onLoad' | 'onError'> {
  source: string;
  loadedSources: Set<string>;
  alt: string;
}

/**
 * Sub-gallery 卡片与 Lightbox 的共享图片入口。后台预加载某个签名 URL 后，仅尚未完成加载的卡片
 * 切换到该地址；已经显示完成的卡片保持原 URL，避免为了统一地址反而触发一次重复加载。
 */
export default function StyleGallerySharedImage({ source, loadedSources, alt, ...imageProps }: StyleGallerySharedImageProps) {
  const [renderedUrl, setRenderedUrl] = useState(() => getReusableStyleGalleryImageUrl(source, false) ?? source);

  useEffect(() => {
    setRenderedUrl(getReusableStyleGalleryImageUrl(source, loadedSources.has(source)) ?? source);
    return subscribeStyleGalleryImageSource(source, (loadedUrl) => {
      setRenderedUrl((current) => (isStyleGalleryImageUrlLoaded(current) ? current : loadedUrl));
    });
  }, [loadedSources, source]);

  const remember = useCallback(
    (image: HTMLImageElement | null) => rememberLoadedStyleGalleryImage(loadedSources, source, image, renderedUrl),
    [loadedSources, renderedUrl, source],
  );

  return (
    <img
      {...imageProps}
      ref={remember}
      src={renderedUrl}
      alt={alt}
      onLoad={(event) => remember(event.currentTarget)}
      onError={() => {
        if (renderedUrl === source) return;
        invalidateStyleGalleryImageUrl(source);
        setRenderedUrl(source);
      }}
    />
  );
}
