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
