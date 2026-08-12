import type { ImageLightboxCopyAction, ImageLightboxData, ImageLightboxDeleteAction } from '@store/modal';

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

let promptCatalogPromise: Promise<Map<string, string>> | null = null;
const MUTATION_ATTEMPTS = 3;
const MUTATION_TIMEOUT_MS = 30_000;

/** Sub-gallery 总览首次复制时才读取 catalog；同一页面生命周期内所有图片共享结果。 */
export async function loadStyleGalleryPrompt(sourceSlug: string): Promise<string> {
  if (!promptCatalogPromise) {
    promptCatalogPromise = fetch('/api/style-gallery/catalog', { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        const catalog = (await response.json()) as { items?: Array<{ slug: string; prompt: string }> };
        return new Map((catalog.items ?? []).map((item) => [item.slug, item.prompt]));
      })
      .catch((error) => {
        promptCatalogPromise = null;
        throw error;
      });
  }
  const prompt = (await promptCatalogPromise).get(sourceSlug);
  if (!prompt) throw new Error(`Style prompt not found: ${sourceSlug}`);
  return prompt;
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
): ImageLightboxCopyAction {
  return {
    label: labels.copyPrompt,
    copiedLabel: labels.copiedPrompt,
    failedLabel: labels.copyFailed,
    getText,
  };
}

export interface StyleGallerySourceLightboxItem {
  id: string;
  src: string;
  previewSrc?: string;
  alt: string;
  getPrompt: () => string | Promise<string>;
}

/**
 * 为参考原图构造统一 lightbox 导航数据。高清原图加载完成前可以复用触发页缓存的 `previewSrc`；
 * 刻意不附加点赞与删除动作，避免把生成示例的业务权限误用于父 item。
 */
export function createStyleGallerySourceLightboxData(
  items: readonly StyleGallerySourceLightboxItem[],
  currentId: string,
  labels: StyleGalleryLightboxCopyLabels,
): ImageLightboxData {
  if (items.length === 0) throw new Error('Style Gallery source lightbox requires at least one image.');
  const images = items.map((item) => ({
    id: item.id,
    src: item.src,
    previewSrc: item.previewSrc,
    alt: item.alt,
    copy: createStyleGalleryCopyAction(item.getPrompt, labels),
  }));
  const currentIndex = Math.max(
    0,
    images.findIndex((image) => image.id === currentId),
  );
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
