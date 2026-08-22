/**
 * Unified Modal State Management
 *
 * Consolidates all modal/drawer/dialog state into a single store.
 * This replaces the scattered state in ui.ts for better state coordination.
 *
 * Features:
 * - Single active modal at a time (prevents stacking conflicts)
 * - Automatic body scroll lock
 * - Computed helpers for convenience
 * - Type-safe modal data
 */

import type { StyleGalleryPromptChoice } from '@lib/style-gallery-prompt-client';
import { atom, computed } from 'nanostores';

/**
 * Code fullscreen data
 */
export interface CodeBlockData {
  code: string;
  codeHTML: string;
  language: string;
  preClassName: string;
  preStyle: string;
  codeClassName: string;
}

/**
 * Unified diagram fullscreen data (mermaid + infographic)
 */
export interface DiagramFullscreenData {
  diagramType: 'mermaid' | 'infographic';
  svg: string;
  source: string;
}

/**
 * Image lightbox data
 */
export interface ImageLightboxLikeMutationResult {
  liked: boolean;
  likeCount: number;
}

/** 可选的 Gallery 点赞动作；普通文章图片不提供该字段，保持原有 lightbox 行为。 */
export interface ImageLightboxLikeAction {
  exampleId: string;
  liked: boolean;
  likeCount: number;
  pending: boolean;
  authEnabled: boolean;
  viewerAuthenticated: boolean;
  labels: {
    like: string;
    unlike: string;
    loginRequired: string;
    unavailable: string;
  };
  toggle: () => Promise<ImageLightboxLikeMutationResult | null>;
}

export type ImageLightboxLikeState = Pick<
  ImageLightboxLikeAction,
  'liked' | 'likeCount' | 'pending' | 'authEnabled' | 'viewerAuthenticated'
>;

/** 按需取得要复制的文本；总览页可延迟加载 prompt，避免扩大首屏数据。 */
export interface ImageLightboxCopyAction {
  label: string;
  copiedLabel: string;
  failedLabel: string;
  getText: () => string | Promise<string>;
  /** 仅多 Prompt Gallery 图片提供；普通图片与单 Prompt 继续走快速复制。 */
  promptCount?: number;
  getPrompts?: () => Promise<StyleGalleryPromptChoice[]>;
}

/** 可选的受保护删除动作；调用方负责 API 鉴权与业务状态同步。 */
export interface ImageLightboxDeleteAction {
  imageId: string;
  label: string;
  deletingLabel: string;
  failedLabel: string;
  unavailableLabel: string;
  confirmMessage: string;
  enabled: boolean;
  run: () => Promise<boolean>;
}

/** 用户主动要求离开 lightbox 并定位到页面中的当前图片；默认关闭不会执行。 */
export interface ImageLightboxLocateAction {
  run: () => void;
}

export interface ImageLightboxImage {
  id?: string;
  src: string;
  /** 批量签名得到的 HF 直连地址；保留 src 作为下载地址和签名失败回退。 */
  resolvedSrc?: string;
  /** 已在触发页面显示过的低成本预览图；高清原图加载完成前用于避免空白等待。 */
  previewSrc?: string;
  alt: string;
  like?: ImageLightboxLikeAction;
  copy?: ImageLightboxCopyAction;
  delete?: ImageLightboxDeleteAction;
  locate?: ImageLightboxLocateAction;
}

export interface ImageLightboxData {
  src: string;
  alt: string;
  images: ImageLightboxImage[];
  currentIndex: number;
}

export type ModalType = 'drawer' | 'search' | 'codeFullscreen' | 'diagramFullscreen' | 'imageLightbox' | null;

export interface ModalState {
  type: ModalType;
  data?: CodeBlockData | DiagramFullscreenData | ImageLightboxData | null;
}

/**
 * Single source of truth for modal state
 */
export const $activeModal = atom<ModalState>({ type: null });

// Computed helpers for convenience
export const $isDrawerOpen = computed($activeModal, (m) => m.type === 'drawer');
export const $isSearchOpen = computed($activeModal, (m) => m.type === 'search');
export const $codeFullscreenData = computed($activeModal, (m) =>
  m.type === 'codeFullscreen' ? (m.data as CodeBlockData) : null,
);
export const $diagramFullscreenData = computed($activeModal, (m) =>
  m.type === 'diagramFullscreen' ? (m.data as DiagramFullscreenData) : null,
);
export const $imageLightboxData = computed($activeModal, (m) =>
  m.type === 'imageLightbox' ? (m.data as ImageLightboxData) : null,
);
export const $isAnyModalOpen = computed($activeModal, (m) => m.type !== null);

/**
 * Open a modal with optional data
 */
export function openModal<T extends ModalType>(
  type: T,
  data?: T extends 'codeFullscreen'
    ? CodeBlockData
    : T extends 'diagramFullscreen'
      ? DiagramFullscreenData
      : T extends 'imageLightbox'
        ? ImageLightboxData
        : never,
): void {
  $activeModal.set({ type, data });
  if (type && typeof document !== 'undefined') {
    document.body.style.overflow = 'hidden';
  }
}

/**
 * Close the currently active modal
 */
export function closeModal(): void {
  if (typeof document !== 'undefined') {
    document.body.style.overflow = '';
  }
  $activeModal.set({ type: null });
}

/**
 * Toggle a modal (open if closed, close if open)
 */
export function toggleModal(type: ModalType): void {
  if ($activeModal.get().type === type) {
    closeModal();
  } else {
    openModal(type);
  }
}

// Convenience functions for specific modals
export const openDrawer = () => openModal('drawer');
export const closeDrawer = () => closeModal();
export const toggleDrawer = () => toggleModal('drawer');

export const openSearch = () => openModal('search');
export const closeSearch = () => closeModal();
export const toggleSearch = () => toggleModal('search');

export const openCodeFullscreen = (data: CodeBlockData) => openModal('codeFullscreen', data);
export const closeCodeFullscreen = () => closeModal();

/**
 * Navigate between images in the lightbox without re-triggering scroll lock.
 * Directly mutates the atom to avoid openModal/closeModal side effects.
 */
export function navigateImage(direction: 1 | -1): boolean {
  const modal = $activeModal.get();
  if (modal.type !== 'imageLightbox') return false;
  const data = modal.data as ImageLightboxData;
  const newIndex = data.currentIndex + direction;
  if (newIndex < 0 || newIndex >= data.images.length) return false;
  const target = data.images[newIndex];
  $activeModal.set({
    type: 'imageLightbox',
    data: { ...data, src: target.src, alt: target.alt, currentIndex: newIndex },
  });
  return true;
}

/** 批量签名完成后一次更新对应导航项，避免逐张 set 导致 lightbox 连续重渲染。 */
export function updateImageLightboxResolvedSources(resolved: Readonly<Record<string, string>>): boolean {
  const modal = $activeModal.get();
  if (modal.type !== 'imageLightbox') return false;
  const data = modal.data as ImageLightboxData;
  let changed = false;
  const images = data.images.map((image) => {
    const resolvedSrc = resolved[image.src];
    if (!resolvedSrc || resolvedSrc === image.resolvedSrc) return image;
    changed = true;
    return { ...image, resolvedSrc };
  });
  if (!changed) return false;
  $activeModal.set({ type: 'imageLightbox', data: { ...data, images } });
  return true;
}

/**
 * 删除异步完成时按稳定 ID 移除对应图片。用户若已切换到其他图片，则保持当前视觉焦点；
 * 删除当前图片时优先显示其后一张，删除最后一张后回退到前一张。
 */
export function removeImageFromLightbox(imageId: string): boolean {
  const modal = $activeModal.get();
  if (modal.type !== 'imageLightbox') return false;
  const data = modal.data as ImageLightboxData;
  const removedIndex = data.images.findIndex((image) => image.id === imageId);
  if (removedIndex === -1) return false;

  const currentImage = data.images[data.currentIndex];
  const images = data.images.filter((image) => image.id !== imageId);
  if (images.length === 0) {
    closeModal();
    return true;
  }

  const retainedCurrentIndex = currentImage.id === imageId ? -1 : images.findIndex((image) => image.id === currentImage.id);
  const currentIndex = retainedCurrentIndex >= 0 ? retainedCurrentIndex : Math.min(removedIndex, images.length - 1);
  const target = images[currentIndex];
  $activeModal.set({
    type: 'imageLightbox',
    data: { ...data, src: target.src, alt: target.alt, images, currentIndex },
  });
  return true;
}

/**
 * 将 popup 内的乐观点赞状态同步回导航数组。
 * 这样切换图片再返回时仍能看到最新状态，同时不要求通用 lightbox 订阅 Gallery 的 React state。
 */
export function updateImageLightboxLike(exampleId: string, update: Partial<ImageLightboxLikeState>): boolean {
  const modal = $activeModal.get();
  if (modal.type !== 'imageLightbox') return false;
  const data = modal.data as ImageLightboxData;
  let changed = false;
  const images = data.images.map((image) => {
    if (image.like?.exampleId !== exampleId) return image;
    changed = true;
    return { ...image, like: { ...image.like, ...update } };
  });
  if (!changed) return false;
  $activeModal.set({ type: 'imageLightbox', data: { ...data, images } });
  return true;
}

/**
 * 用一次数组遍历将 Gallery controller 的最新状态同步到已打开的 lightbox。
 * 认证 hydration 和卡片发起的 mutation 都发生在 modal 之外，不能依赖打开时保存的状态快照。
 */
export function syncImageLightboxLikes(resolve: (exampleId: string) => ImageLightboxLikeState): boolean {
  const modal = $activeModal.get();
  if (modal.type !== 'imageLightbox') return false;
  const data = modal.data as ImageLightboxData;
  let changed = false;
  const images = data.images.map((image) => {
    if (!image.like) return image;
    const next = resolve(image.like.exampleId);
    if (
      image.like.liked === next.liked &&
      image.like.likeCount === next.likeCount &&
      image.like.pending === next.pending &&
      image.like.authEnabled === next.authEnabled &&
      image.like.viewerAuthenticated === next.viewerAuthenticated
    ) {
      return image;
    }
    changed = true;
    return { ...image, like: { ...image.like, ...next } };
  });
  if (!changed) return false;
  $activeModal.set({ type: 'imageLightbox', data: { ...data, images } });
  return true;
}
