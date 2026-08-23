import type { ImageLightboxCopyAction, ImageLightboxData, ImageLightboxDeleteAction } from '@store/modal';
import { getReusableStyleGalleryImageUrl } from './style-gallery-image-client';
import type { StyleGalleryPromptChoice } from './style-gallery-prompt-client';

export const STYLE_GALLERY_UPLOAD_TOKEN_STORAGE_KEY = 'style-gallery-upload-token';

export interface StyleGalleryLightboxCopyLabels {
  copyPrompt: string;
  copiedPrompt: string;
  copyFailed: string;
}

export interface StyleGalleryLightboxActionLabels extends StyleGalleryLightboxCopyLabels {
  deleteImage: string;
  deletingImage: string;
  deleteFailed: string;
  deleteRequiresToken: string;
  deleteConfirm: string;
}

const MUTATION_ATTEMPTS = 3;
const MUTATION_TIMEOUT_MS = 30_000;
const locateHighlightAnimations = new WeakMap<HTMLElement, Animation>();

/**
 * 用不参与布局的双层阴影标记 lightbox 返回目标：内层描边负责在密集矩阵中定位，外层柔光扩大
 * 视觉搜索范围。动画快速出现后保留一段稳定可见期，再缓慢淡出；减少动态效果时不做脉冲，但仍
 * 留出足够识别时间。阴影不会改变网格尺寸，也不会让相邻卡片发生位移。
 */
function highlightLocatedElement(element: HTMLElement): void {
  locateHighlightAnimations.get(element)?.cancel();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const glow = '0 0 0 4px rgb(244 63 94 / 0.96), 0 0 40px 16px rgb(244 63 94 / 0.44)';
  const clear = '0 0 0 0 rgb(244 63 94 / 0), 0 0 0 0 rgb(244 63 94 / 0)';
  const animation = element.animate(
    reduceMotion
      ? [{ boxShadow: glow }, { boxShadow: clear }]
      : [
          { boxShadow: clear, offset: 0 },
          { boxShadow: glow, offset: 0.08 },
          { boxShadow: glow, offset: 0.68 },
          { boxShadow: '0 0 0 3px rgb(244 63 94 / 0.78), 0 0 28px 10px rgb(244 63 94 / 0.3)', offset: 0.84 },
          { boxShadow: clear, offset: 1 },
        ],
    {
      delay: reduceMotion ? 0 : 120,
      duration: reduceMotion ? 2_400 : 4_200,
      easing: 'ease-out',
    },
  );
  locateHighlightAnimations.set(element, animation);
  animation.onfinish = () => {
    if (locateHighlightAnimations.get(element) === animation) locateHighlightAnimations.delete(element);
  };
}

/** Popup 删除与详情页批量操作使用相同 API 和 bearer token；每次重试都有独立超时。 */
export async function deleteStyleGalleryExample(sourceSlug: string, exampleId: string, token: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MUTATION_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`/api/style-gallery/examples/${sourceSlug}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids: [exampleId] }),
        signal: AbortSignal.timeout(MUTATION_TIMEOUT_MS),
      });
      if (response.ok) return;
      const message = (await response.text()) || `Delete failed with ${response.status}`;
      if (response.status !== 408 && response.status !== 429 && response.status < 500) throw new Error(message);
      lastError = new Error(message);
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof TypeError ||
        (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name)) ||
        (error instanceof Error && /(?:408|429|5\d\d)/.test(error.message));
      if (!retryable) throw error;
    }
    if (attempt < MUTATION_ATTEMPTS) {
      await new Promise((resolve) => window.setTimeout(resolve, 400 * 2 ** (attempt - 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Failed to delete generated example.');
}

/** 为任意 Gallery 图片构造可复制完整 prompt 的 lightbox 动作。 */
export function createStyleGalleryCopyAction(
  getText: () => string | Promise<string>,
  labels: StyleGalleryLightboxCopyLabels,
  promptOptions?: { promptCount: number; getPrompts: () => Promise<StyleGalleryPromptChoice[]> },
): ImageLightboxCopyAction {
  return {
    label: labels.copyPrompt,
    copiedLabel: labels.copiedPrompt,
    failedLabel: labels.copyFailed,
    getText,
    ...promptOptions,
  };
}

export interface StyleGallerySourceLightboxItem {
  id: string;
  src: string;
  previewSrc?: string;
  /** 触发 Lightbox 前，该高清 src 已在页面中完成加载，可直接复用浏览器图片缓存。 */
  sourceLoaded?: boolean;
  alt: string;
  getPrompt: () => string | Promise<string>;
  locate?: () => void;
  promptOptions?: { promptCount: number; getPrompts: () => Promise<StyleGalleryPromptChoice[]> };
}

/**
 * 等 React 挂载目标分页或渐进批次，再滚动到卡片并短暂聚焦；慢设备上也不会只赌两个渲染帧。
 * 高亮在 DOM 目标出现后才启动，因此分页切换、渐进加载和 smooth scroll 不会让反馈落到旧位置。
 */
export function locateStyleGalleryElement(elementId: string): void {
  const maxFrames = 30;
  function locate(frame: number) {
    const element = document.getElementById(elementId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (element instanceof HTMLElement) {
        element.focus({ preventScroll: true });
        highlightLocatedElement(element);
      }
      return;
    }
    if (frame < maxFrames) window.requestAnimationFrame(() => locate(frame + 1));
  }
  window.requestAnimationFrame(() => locate(1));
}

export function getStyleGalleryLightboxElementId(scope: string, id: string): string {
  return `style-gallery-${scope}-${id.replace(/[^a-z0-9_-]/gi, '-')}`;
}

/**
 * 为参考原图构造统一 lightbox 导航数据。已加载的高清图和会话内签名地址直接复用；只有未加载
 * 项才进入批量签名。`previewSrc` 仍负责缩略图到高清图的过渡，并且父 item 不附加点赞与删除动作。
 */
export function createStyleGallerySourceLightboxData(
  items: readonly StyleGallerySourceLightboxItem[],
  currentId: string,
  labels: StyleGalleryLightboxCopyLabels,
): ImageLightboxData {
  if (items.length === 0) throw new Error('Style Gallery source lightbox requires at least one image.');
  const currentIndex = Math.max(
    0,
    items.findIndex((item) => item.id === currentId),
  );
  const images = items.map((item) => ({
    id: item.id,
    src: item.src,
    // 已签名缓存优先；每张确认加载完成的高清图都可复用 canonical URL，未加载项继续批量签名。
    resolvedSrc: getReusableStyleGalleryImageUrl(item.src, Boolean(item.sourceLoaded)),
    previewSrc: item.previewSrc,
    alt: item.alt,
    copy: createStyleGalleryCopyAction(item.getPrompt, labels, item.promptOptions),
    locate: item.locate ? { run: item.locate } : undefined,
  }));
  const current = images[currentIndex];
  return { src: current.src, alt: current.alt, images, currentIndex };
}

/** 复用详情页权限与确认文案，构造单张示例图的 lightbox 删除动作。 */
export function createStyleGalleryDeleteAction(
  imageId: string,
  imageName: string,
  enabled: boolean,
  run: () => Promise<boolean>,
  labels: StyleGalleryLightboxActionLabels,
): ImageLightboxDeleteAction {
  return {
    imageId,
    label: labels.deleteImage,
    deletingLabel: labels.deletingImage,
    failedLabel: labels.deleteFailed,
    unavailableLabel: labels.deleteRequiresToken,
    confirmMessage: labels.deleteConfirm.replace('{name}', imageName),
    enabled,
    run,
  };
}
