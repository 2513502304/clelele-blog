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
 * Sub-gallery 卡片与 Lightbox 的共享原图入口。两处展示的是同一 example URL，因此卡片一旦加载完成，
 * Lightbox 新建 DOM 节点时也必须沿用全局 loaded 状态，不能因节点短暂 `complete === false` 重新转圈。
 * 后台预加载签名 URL 时，仅尚未完成加载的卡片切换地址；已经显示的卡片保持原 URL，避免重复加载。
 *
 * Gallery 预览页与 Sub-gallery 都直接显示高清原图，因此共享这条契约；只有密集图片矩阵有意先展示
 * thumb，再在 Lightbox 中渐进加载高清 source。不要把矩阵策略反向扩散到三列卡片页面。
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
