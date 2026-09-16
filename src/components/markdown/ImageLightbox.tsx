/**
 * React image lightbox with zoom/pan support.
 * Replaces the vanilla DOM lightbox in image-enhancer.ts (~400 lines).
 *
 * Uses shared useZoomPan hook, Floating UI for dismiss behavior, and Motion animations.
 * Listens for 'open-image-lightbox' custom events dispatched by image-enhancer.ts.
 */

import { ErrorBoundary, InlineErrorFallback } from '@components/common';
import { FloatingFocusManager, FloatingPortal, useDismiss, useFloating, useInteractions, useRole } from '@floating-ui/react';
import { useBackdropClickDismiss } from '@hooks/useBackdropClickDismiss';
import { useKeyboardShortcut } from '@hooks/useKeyboardShortcut';
import { useLightboxImageDownload } from '@hooks/useLightboxImageDownload';
import { useTranslation } from '@hooks/useTranslation';
import { useZoomPan } from '@hooks/useZoomPan';
import { Icon } from '@iconify/react';
import { createImageLightboxDownloadAction } from '@lib/image-lightbox-download';
import { getLive2DFocusNodes, isLive2DOwnedTarget } from '@lib/live2d/focus-scope';
import {
  getReusableStyleGalleryImageUrl,
  invalidateStyleGalleryImageUrl,
  isStyleGalleryImageUrlLoaded,
  markStyleGalleryImageUrlLoaded,
  preloadStyleGalleryImages,
  resolveStyleGalleryImageUrls,
} from '@lib/style-gallery-image-client';
import { createLightboxPrefetchPlan } from '@lib/style-gallery-lightbox-prefetch';
import { canConsumeLightboxWheel } from '@lib/style-gallery-lightbox-wheel';
import type { StyleGalleryPromptChoice } from '@lib/style-gallery-prompt-client';
import { getStyleGalleryPromptChooserKey } from '@lib/style-gallery-prompt-groups';
import { useStore } from '@nanostores/react';
import {
  $imageLightboxData,
  clearImageLightboxResolvedSource,
  closeModal,
  type ImageLightboxData,
  type ImageLightboxImage,
  navigateImage,
  openModal,
  removeImageFromLightbox,
  updateImageLightboxResolvedSources,
} from '@store/modal';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleGalleryPromptChooser } from '../style-gallery/StyleGalleryPromptChooser';
import { GalleryLightboxTags } from '../style-gallery/StyleGalleryTags';
import { Dialog, DialogContent } from '../ui/dialog';
import { LightboxLikeButton, NavButton, ToolbarButton, ToolbarLink, ZoomHint } from './ImageLightboxControls';

const ZOOM_SENSITIVITY_STORAGE_KEY = 'image-lightbox-zoom-sensitivity';
const DEFAULT_ZOOM_SENSITIVITY = 0.55;
const MIN_ZOOM_SENSITIVITY = 0.25;
const MAX_ZOOM_SENSITIVITY = 1.25;

interface LightboxImageStageProps {
  image: ImageLightboxImage;
  shouldReduceMotion: boolean | null;
  onResolvedSourceFailure: (source: string) => void;
  onSourceSettled: (imageKey: string) => void;
  imageKey: string;
}

/**
 * 每个导航目标拥有独立加载生命周期。父级以当前图片键重建该组件，可同时阻止浏览器保留上一张位图，
 * 并隔离已经卸载图片的迟到 load/decode 回调，避免快速切换时错误显示后续图片为已加载。
 */
function LightboxImageStage({
  image,
  imageKey,
  shouldReduceMotion,
  onResolvedSourceFailure,
  onSourceSettled,
}: LightboxImageStageProps) {
  const { t } = useTranslation();
  // 批量签名完成不能把正在下载的 canonical 图片中途换址；只有当前签名 URL 明确失败时，才在同一
  // Stage 内主动降级到 canonical 302 路径。导航到其他图片仍由 imageKey 重建完整加载生命周期。
  const [sourceSrc, setSourceSrc] = useState(
    () => image.resolvedSrc ?? getReusableStyleGalleryImageUrl(image.src, false) ?? image.src,
  );
  const previewSrc = image.previewSrc !== sourceSrc ? image.previewSrc : undefined;
  const [sourceWasLoaded] = useState(() => isStyleGalleryImageUrlLoaded(sourceSrc));
  // 页面卡片已经成功绘制过同一 URL 时，Lightbox 必须立即复用该事实，不能把后台重复 decode
  // 误报成“正在加载高清原图”。新节点仍会在后台确认 decode；只有冷 URL 才展示 loading 状态。
  const [sourceState, setSourceState] = useState<'loading' | 'decoding' | 'loaded' | 'failed'>(
    sourceWasLoaded ? 'loaded' : 'loading',
  );
  const download = useLightboxImageDownload(sourceSrc);
  const [previewFailed, setPreviewFailed] = useState(false);
  const decodeStartedRef = useRef(false);
  const settledRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const settleSource = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    onSourceSettled(imageKey);
  }, [imageKey, onSourceSettled]);

  useEffect(() => {
    // 热 URL 无需等待新 DOM 节点重复 decode 才能启动相邻图片预取。
    if (sourceWasLoaded) settleSource();
  }, [settleSource, sourceWasLoaded]);

  const finishSourceLoad = useCallback(
    async (element: HTMLImageElement) => {
      // 热缓存命中时 callback ref 与 load 事件可能在同一轮都触发，只允许一个 decode 任务。
      if (decodeStartedRef.current) return;
      decodeStartedRef.current = true;
      if (!sourceWasLoaded) setSourceState('decoding');
      try {
        await element.decode();
      } catch {
        // 部分浏览器会在图片已经可绘制时拒绝重复 decode；naturalWidth 才是最终可用性判断。
      }
      if (!mountedRef.current) return;
      if (element.naturalWidth > 0) {
        markStyleGalleryImageUrlLoaded(sourceSrc, image.src);
        setSourceState('loaded');
        settleSource();
      } else {
        setSourceState('failed');
        settleSource();
      }
    },
    [image.src, settleSource, sourceSrc, sourceWasLoaded],
  );

  const sourceRef = useCallback(
    (element: HTMLImageElement | null) => {
      // 内存/HTTP 缓存命中时 load 可能早于 React effect；ref 与 onLoad 双路径保持和页面卡片一致。
      if (!element) return;
      if (element.complete && element.naturalWidth > 0) void finishSourceLoad(element);
    },
    [finishSourceLoad],
  );

  // The preview can be smaller than the viewport (especially landscape images).
  // Reserve the original's fitted bounds so replacing it never changes image size.
  const dimensions = image.dimensions;
  const stageSize =
    dimensions && dimensions.width > 0 && dimensions.height > 0
      ? {
          width: `min(${dimensions.width}px, 96vw, ${(92 * dimensions.width) / dimensions.height}dvh)`,
          height: `min(${dimensions.height}px, ${(96 * dimensions.height) / dimensions.width}vw, 92dvh)`,
        }
      : undefined;
  const imageSize = stageSize ? { width: '100%', height: '100%', minWidth: 0, minHeight: 0 } : undefined;
  const isLoading = sourceState === 'loading' || sourceState === 'decoding';
  const hasPreview = Boolean(previewSrc) && !previewFailed;
  const hasVisibleImage = hasPreview || sourceState === 'loaded';
  const downloadPercent = download.progress?.total
    ? Math.min(100, Math.floor((download.progress.received / download.progress.total) * 100))
    : undefined;

  return (
    <div className="relative grid place-items-center" style={stageSize} aria-busy={isLoading}>
      {hasPreview && (
        <motion.img
          src={previewSrc}
          style={imageSize}
          alt=""
          aria-hidden="true"
          loading="eager"
          decoding="async"
          className="col-start-1 row-start-1 max-h-[92dvh] max-w-[96vw] rounded-lg object-contain shadow-2xl"
          initial={{ opacity: 1 }}
          animate={{ opacity: sourceState === 'loaded' ? 0 : 1 }}
          transition={{ opacity: { duration: shouldReduceMotion ? 0 : 0.18 } }}
          onError={() => setPreviewFailed(true)}
          draggable={false}
        />
      )}
      <motion.img
        ref={sourceRef}
        src={download.src}
        style={imageSize}
        alt={image.alt}
        loading="eager"
        fetchPriority="high"
        decoding="async"
        className="col-start-1 row-start-1 max-h-[92dvh] max-w-[96vw] rounded-lg object-contain shadow-2xl"
        // 同一 URL 已在卡片或预加载器中绘制过时，首帧直接可见；不要先提交 opacity: 0 再等 Motion 下一帧。
        initial={sourceWasLoaded ? false : { opacity: 0 }}
        animate={{ opacity: sourceState === 'loaded' ? 1 : 0 }}
        // 热缓存命中后仍等待本节点确认可绘制，但不再人为增加 200ms 淡入延迟。
        transition={{ opacity: { duration: shouldReduceMotion || sourceWasLoaded ? 0 : 0.2 } }}
        onLoad={(event) => void finishSourceLoad(event.currentTarget)}
        onError={() => {
          if (image.resolvedSrc && sourceSrc === image.resolvedSrc) {
            // 直连签名持续失败时本次 popup 不再重签；页面缓存的 canonical URL 失败则允许改走签名恢复。
            if (image.resolvedSrc !== image.src) {
              onResolvedSourceFailure(image.src);
              decodeStartedRef.current = false;
              settledRef.current = false;
              setSourceState(isStyleGalleryImageUrlLoaded(image.src) ? 'loaded' : 'loading');
              setSourceSrc(image.src);
            } else {
              // resolvedSrc 与 canonical 相同时不存在下一层回退，必须结束 loading，避免永久透明转圈。
              setSourceState('failed');
              settleSource();
            }
            invalidateStyleGalleryImageUrl(image.src);
            clearImageLightboxResolvedSource(image.src, image.resolvedSrc);
            return;
          }
          setSourceState('failed');
          settleSource();
        }}
        draggable={false}
      />
      {isLoading && (
        <div
          className={`pointer-events-none z-10 w-72 max-w-[70vw] rounded-xl border border-white/10 bg-zinc-900/80 p-4 text-white shadow-xl backdrop-blur-xl ${
            hasVisibleImage ? 'absolute bottom-3 left-1/2 -translate-x-1/2' : 'col-start-1 row-start-1'
          }`}
        >
          <div className="flex items-center justify-between gap-3 text-xs">
            <output>{t('image.loadingOriginal')}</output>
            {downloadPercent !== undefined && <span className="tabular-nums">{downloadPercent}%</span>}
          </div>
          <p className="mt-1.5 text-[11px] text-white/60 tabular-nums">
            {sourceState === 'decoding' || download.src?.startsWith('blob:')
              ? t('image.decoding')
              : download.progress
                ? `${(download.progress.received / 1_000_000).toFixed(1)} MB${download.progress.total ? ` / ${(download.progress.total / 1_000_000).toFixed(1)} MB` : ''}`
                : t('image.downloading')}
          </p>
          <div
            role="progressbar"
            aria-label={t('image.loadingOriginal')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={downloadPercent}
            className="mt-3 h-1 overflow-hidden rounded-full bg-white/15"
          >
            <motion.div
              className="h-full rounded-full bg-rose-400"
              style={{ width: downloadPercent !== undefined ? `${downloadPercent}%` : '30%' }}
              initial={false}
              animate={{ x: downloadPercent !== undefined || shouldReduceMotion ? 0 : ['-100%', '335%'] }}
              transition={{
                duration: 1.4,
                repeat: downloadPercent !== undefined || shouldReduceMotion ? 0 : Infinity,
                ease: 'easeInOut',
              }}
            />
          </div>
        </div>
      )}
      {sourceState === 'failed' && (
        <div
          className={`pointer-events-none flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-rose-200 text-xs backdrop-blur-sm ${
            hasPreview ? 'absolute bottom-3 left-1/2 -translate-x-1/2' : 'col-start-1 row-start-1'
          }`}
          role="alert"
        >
          <Icon icon="ri:error-warning-line" className="size-4" />
          <span>{t('image.loadFailed')}</span>
        </div>
      )}
    </div>
  );
}

export default function ImageLightbox() {
  const { t, locale } = useTranslation();
  const shouldReduceMotion = useReducedMotion();
  const data = useStore($imageLightboxData);
  const isOpen = data !== null;
  const currentImage = data?.images[data.currentIndex];
  const currentLike = currentImage?.like;
  const currentCopy = currentImage?.copy;
  const currentDelete = currentImage?.delete;
  const currentLocate = currentImage?.locate;
  const downloadAction = currentImage && !data?.previewOnly ? createImageLightboxDownloadAction(currentImage.src) : null;
  const currentImageKey = currentImage?.id ?? `${data?.currentIndex ?? 0}:${currentImage?.src ?? ''}`;
  const [rotation, setRotation] = useState(0);
  const [zoomSensitivity, setZoomSensitivity] = useState(DEFAULT_ZOOM_SENSITIVITY);
  const [showSensitivity, setShowSensitivity] = useState(false);
  const [copyState, setCopyState] = useState<{ key: string; status: 'copying' | 'copied' | 'failed' } | null>(null);
  const [promptPicker, setPromptPicker] = useState<{
    key: string;
    prompts: StyleGalleryPromptChoice[] | null;
    failed: boolean;
  } | null>(null);
  const [deleteState, setDeleteState] = useState<{ key: string; status: 'deleting' | 'failed' } | null>(null);
  const [settledImageKey, setSettledImageKey] = useState<string | null>(null);
  const currentCopyStatus = copyState?.key === currentImageKey ? copyState.status : null;
  const currentDeleteStatus = deleteState?.key === currentImageKey ? deleteState.status : null;
  const copyAttemptRef = useRef(0);
  const promptAttemptRef = useRef(0);
  const deleteAttemptRef = useRef(0);
  const copyTimerRef = useRef(0);
  const deleteTimerRef = useRef(0);
  // 同一 popup 会话内，签名 URL 失败后回退 canonical 302 路径；关闭再打开时才允许重新尝试。
  const failedResolvedSourcesRef = useRef(new Set<string>());

  const { containerRef, state, reset, zoomTo, zoomLevel } = useZoomPan(isOpen && !promptPicker, { zoomSensitivity });

  const handleResolvedSourceFailure = useCallback((source: string) => {
    failedResolvedSourcesRef.current.add(source);
  }, []);

  // Use a ref so the outsidePress callback always reads the latest scale
  const scaleRef = useRef(state.scale);
  scaleRef.current = state.scale;

  const handleResetAll = useCallback(() => {
    reset();
    setRotation(0);
  }, [reset]);

  const dismissFromBackdrop = useCallback(() => {
    reset();
    closeModal();
  }, [reset]);

  const handleLocate = useCallback(() => {
    if (!currentLocate) return;
    reset();
    closeModal();
    currentLocate.run();
  }, [currentLocate, reset]);
  const backdropPointerHandlers = useBackdropClickDismiss(dismissFromBackdrop);

  const handleZoomIn = useCallback(() => {
    if (!isLive2DOwnedTarget(document.activeElement)) zoomTo(scaleRef.current * 1.5);
  }, [zoomTo]);
  const handleZoomOut = useCallback(() => {
    if (!isLive2DOwnedTarget(document.activeElement)) zoomTo(scaleRef.current / 1.5);
  }, [zoomTo]);
  const handleRotate = useCallback(() => {
    if (!isLive2DOwnedTarget(document.activeElement)) setRotation((r) => (r + 90) % 360);
  }, []);
  const handleResetShortcut = useCallback(() => {
    if (!isLive2DOwnedTarget(document.activeElement)) handleResetAll();
  }, [handleResetAll]);

  const handleLike = useCallback(async () => {
    if (!currentLike || !currentLike.authEnabled || currentLike.pending) return;
    // Gallery action 统一负责 OAuth 跳转、乐观状态、失败回滚和持久化，避免 popup 再执行一遍相同更新。
    await currentLike.toggle();
  }, [currentLike]);

  const handleCopy = useCallback(async () => {
    if (!currentCopy) return;
    const key = currentImageKey;
    if (currentCopy.promptCount && currentCopy.promptCount > 1 && currentCopy.getPrompts) {
      const attempt = ++promptAttemptRef.current;
      setPromptPicker({ key, prompts: null, failed: false });
      try {
        const prompts = await currentCopy.getPrompts();
        if (promptAttemptRef.current === attempt) setPromptPicker({ key, prompts, failed: false });
      } catch (error) {
        console.error('[image-lightbox] Failed to load prompt choices.', error);
        if (promptAttemptRef.current === attempt) setPromptPicker({ key, prompts: null, failed: true });
      }
      return;
    }
    const attempt = ++copyAttemptRef.current;
    window.clearTimeout(copyTimerRef.current);
    setCopyState({ key, status: 'copying' });
    try {
      await navigator.clipboard.writeText(await currentCopy.getText());
      setCopyState({ key, status: 'copied' });
    } catch (error) {
      console.error('[image-lightbox] Failed to copy contextual text.', error);
      setCopyState({ key, status: 'failed' });
    }
    copyTimerRef.current = window.setTimeout(() => {
      if (copyAttemptRef.current === attempt) setCopyState(null);
    }, 2000);
  }, [currentCopy, currentImageKey]);

  const copyPromptChoice = useCallback(async (prompt: StyleGalleryPromptChoice): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(prompt.prompt);
      return true;
    } catch (error) {
      console.error('[image-lightbox] Failed to copy selected prompt.', error);
      return false;
    }
  }, []);

  const handleDelete = useCallback(async () => {
    if (!currentDelete?.enabled || !window.confirm(currentDelete.confirmMessage)) return;
    const key = currentImageKey;
    const attempt = ++deleteAttemptRef.current;
    window.clearTimeout(deleteTimerRef.current);
    setDeleteState({ key, status: 'deleting' });
    try {
      if (await currentDelete.run()) {
        removeImageFromLightbox(currentDelete.imageId);
        window.clearTimeout(deleteTimerRef.current);
        setDeleteState(null);
        reset();
        setRotation(0);
        return;
      }
      setDeleteState({ key, status: 'failed' });
    } catch (error) {
      console.error('[image-lightbox] Failed to delete the current image.', error);
      setDeleteState({ key, status: 'failed' });
    }
    deleteTimerRef.current = window.setTimeout(() => {
      if (deleteAttemptRef.current === attempt) setDeleteState(null);
    }, 2400);
  }, [currentDelete, currentImageKey, reset]);

  const isDeleting = deleteState?.status === 'deleting';

  const navigateTo = useCallback(
    (dir: 1 | -1) => {
      if (isLive2DOwnedTarget(document.activeElement)) return;
      if (isDeleting) return;
      if (!navigateImage(dir)) return;
      reset();
      setRotation(0);
    },
    [isDeleting, reset],
  );

  // Keyboard shortcuts for navigation
  useKeyboardShortcut({
    key: 'ArrowLeft',
    handler: () => navigateTo(-1),
    enabled: isOpen && !promptPicker,
    ignoreInputs: false,
    preventDefault: false,
  });

  useKeyboardShortcut({
    key: 'ArrowRight',
    handler: () => navigateTo(1),
    enabled: isOpen && !promptPicker,
    ignoreInputs: false,
    preventDefault: false,
  });

  // Keyboard shortcuts for zoom/rotate
  useKeyboardShortcut({
    key: '=',
    handler: handleZoomIn,
    enabled: isOpen && !promptPicker,
    ignoreInputs: false,
    preventDefault: false,
  });
  useKeyboardShortcut({
    key: '+',
    handler: handleZoomIn,
    enabled: isOpen && !promptPicker,
    ignoreInputs: false,
    preventDefault: false,
  });
  useKeyboardShortcut({
    key: '-',
    handler: handleZoomOut,
    enabled: isOpen && !promptPicker,
    ignoreInputs: false,
    preventDefault: false,
  });
  useKeyboardShortcut({
    key: 'r',
    handler: handleRotate,
    enabled: isOpen && !promptPicker,
    ignoreInputs: false,
    preventDefault: false,
  });
  useKeyboardShortcut({
    key: '0',
    handler: handleResetShortcut,
    enabled: isOpen && !promptPicker,
    ignoreInputs: false,
    preventDefault: false,
  });

  const { refs, context } = useFloating({
    open: isOpen,
    onOpenChange: (open) => {
      if (!open) closeModal();
    },
  });
  // Floating content covers the viewport, so background dismissal is handled by the image viewport's exact click target.
  const dismiss = useDismiss(context, { outsidePress: false });
  const role = useRole(context, { role: 'dialog' });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  // Listen for custom events from image-enhancer
  useEffect(() => {
    const handleOpen = (e: CustomEvent<ImageLightboxData>) => {
      openModal('imageLightbox', e.detail);
    };

    window.addEventListener('open-image-lightbox', handleOpen as EventListener);
    return () => window.removeEventListener('open-image-lightbox', handleOpen as EventListener);
  }, []);

  useEffect(() => {
    const stored = Number.parseFloat(localStorage.getItem(ZOOM_SENSITIVITY_STORAGE_KEY) ?? '');
    if (Number.isFinite(stored)) {
      setZoomSensitivity(Math.min(MAX_ZOOM_SENSITIVITY, Math.max(MIN_ZOOM_SENSITIVITY, stored)));
    }
  }, []);

  // Close on page navigation
  useEffect(() => {
    const close = () => closeModal();
    document.addEventListener('astro:before-preparation', close);
    return () => document.removeEventListener('astro:before-preparation', close);
  }, []);

  // Reset zoom, rotation, and image state when opening/closing
  useEffect(() => {
    copyAttemptRef.current += 1;
    promptAttemptRef.current += 1;
    deleteAttemptRef.current += 1;
    window.clearTimeout(copyTimerRef.current);
    window.clearTimeout(deleteTimerRef.current);
    if (isOpen) {
      failedResolvedSourcesRef.current.clear();
      reset();
      setRotation(0);
      setShowSensitivity(false);
      setCopyState(null);
      setPromptPicker(null);
      setDeleteState(null);
    } else {
      // 同一图片关闭后再次打开时也必须重新等待当前 Stage settled，不能沿用上次 popup 的门闩。
      setSettledImageKey(null);
    }
    return () => {
      window.clearTimeout(copyTimerRef.current);
      window.clearTimeout(deleteTimerRef.current);
    };
  }, [isOpen, reset]);

  useEffect(() => {
    if (!promptPicker) return;
    // Floating UI 与 Radix 都监听 Escape；在 window capture 阶段消费事件，避免一次按键同时关闭内外两层。
    const closePromptPicker = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setPromptPicker(null);
    };
    window.addEventListener('keydown', closePromptPicker, true);
    return () => window.removeEventListener('keydown', closePromptPicker, true);
  }, [promptPicker]);

  const previousImage = data?.images[data.currentIndex - 1];
  const nextImage = data?.images[data.currentIndex + 1];
  const previousPreviewSrc = previousImage?.previewSrc !== previousImage?.src ? previousImage?.previewSrc : undefined;
  const nextPreviewSrc = nextImage?.previewSrc !== nextImage?.src ? nextImage?.previewSrc : undefined;

  // 只预取相邻项已经提供的低成本预览图；不主动请求高清原图，避免为了导航手感增加大图带宽。
  useEffect(() => {
    for (const previewSrc of [previousPreviewSrc, nextPreviewSrc]) {
      if (!previewSrc) continue;
      const preload = new Image();
      preload.decoding = 'async';
      preload.src = previewSrc;
    }
  }, [nextPreviewSrc, previousPreviewSrc]);

  const prefetchPlan = useMemo(
    () =>
      createLightboxPrefetchPlan(
        data?.images.length ?? 0,
        data?.currentIndex ?? -1,
        undefined,
        data?.prefetch?.preloadAhead,
        data?.prefetch?.nextBatchThreshold,
      ),
    [data?.currentIndex, data?.images.length, data?.prefetch?.nextBatchThreshold, data?.prefetch?.preloadAhead],
  );
  const unresolvedSignSources = useMemo(
    () =>
      prefetchPlan.signIndexes
        .map((index) => (index === data?.currentIndex ? undefined : data?.images[index]))
        .filter((image): image is ImageLightboxImage =>
          Boolean(image && !image.resolvedSrc && !failedResolvedSourcesRef.current.has(image.src)),
        )
        .map((image) => image.src),
    [data?.currentIndex, data?.images, prefetchPlan.signIndexes],
  );
  const unresolvedSignKey = unresolvedSignSources.join('\n');

  /**
   * 预签名只请求没有 `resolvedSrc` 的导航项。调用页面会把真实加载完成的 canonical URL 也写入
   * `resolvedSrc`，这是刻意的浏览器缓存复用标记，不能在这里强制换成新签名 URL。其余未渲染图片
   * 仍按窗口批量签名，因此当前图片复用与后续键盘导航预取可以同时成立。
   */
  useEffect(() => {
    if (!unresolvedSignKey) return;
    let active = true;
    void resolveStyleGalleryImageUrls(unresolvedSignSources)
      .then((resolved) => {
        if (!active) return;
        const usable = Object.fromEntries(
          Object.entries(resolved).filter(([source]) => !failedResolvedSourcesRef.current.has(source)),
        );
        updateImageLightboxResolvedSources(usable);
      })
      .catch((error) => console.warn('[image-lightbox] Failed to pre-sign navigation window.', error));
    return () => {
      active = false;
    };
  }, [unresolvedSignKey, unresolvedSignSources]);

  const preloadImages = useMemo(
    () =>
      prefetchPlan.preloadIndexes
        .map((index) => data?.images[index])
        .filter((image): image is ImageLightboxImage => Boolean(image?.resolvedSrc))
        .map((image, index) => ({
          source: image.src,
          url: image.resolvedSrc as string,
          priority: index < 6 ? ('high' as const) : ('auto' as const),
        })),
    [data?.images, prefetchPlan.preloadIndexes],
  );
  const preloadKey = preloadImages.map(({ source, url }) => `${source}\u0000${url}`).join('\n');

  // 签名可以提前批量完成，但邻图解码必须等当前图 settled 后再开始；否则高清图并发 decode 会抢占
  // 当前图片并挤压浏览器的解码缓存。每次导航时 image key 会自动关闭上一轮预载门闩。
  useEffect(() => {
    if (!preloadKey || settledImageKey !== currentImageKey) return;
    void preloadStyleGalleryImages(preloadImages);
  }, [currentImageKey, preloadImages, preloadKey, settledImageKey]);

  const updateZoomSensitivity = (value: number) => {
    const next = Math.min(MAX_ZOOM_SENSITIVITY, Math.max(MIN_ZOOM_SENSITIVITY, value));
    setZoomSensitivity(next);
    try {
      localStorage.setItem(ZOOM_SENSITIVITY_STORAGE_KEY, next.toString());
    } catch (error) {
      // 隐私模式或存储配额不足时仍保留本次会话中的灵敏度，不阻断 lightbox 操作。
      console.warn('[image-lightbox] Failed to persist zoom sensitivity.', error);
    }
  };

  // Lightbox 接管页面滚轮，但显式标记的嵌套面板仍可消费自己的滚动，且不会在边界穿透到底层页面。
  useEffect(() => {
    if (!isOpen) return;
    const prevent = (event: WheelEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const scrollRegion = target?.closest<HTMLElement>('[data-lightbox-scroll-region]');
      if (scrollRegion && canConsumeLightboxWheel(scrollRegion, event.deltaY)) return;
      event.preventDefault();
    };
    document.addEventListener('wheel', prevent, { passive: false });
    return () => document.removeEventListener('wheel', prevent);
  }, [isOpen]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (state.scale > 1.05) {
      reset();
      setRotation(0);
    } else {
      zoomTo(2, e.clientX, e.clientY);
    }
  };

  if (!data || !currentImage) return null;

  return (
    <FloatingPortal root={data.portalRoot}>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            data-image-lightbox
            className="pointer-events-auto fixed inset-0 z-60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Backdrop */}
            <div className="fixed inset-0 bg-black/90 backdrop-blur-sm" />
            {/* Content */}
            <FloatingFocusManager context={context} getInsideElements={getLive2DFocusNodes} disabled={Boolean(promptPicker)}>
              <div ref={refs.setFloating} className="fixed inset-0 flex items-center justify-center" {...getFloatingProps()}>
                {/* Toolbar: vertical right on desktop, horizontal top on tablet */}
                <motion.div
                  className="absolute tablet:top-4 top-1/2 right-4 tablet:right-auto tablet:left-1/2 z-10 flex tablet:w-[calc(100vw-2rem)] tablet:max-w-sm tablet:-translate-x-1/2 -translate-y-1/2 tablet:translate-y-0 tablet:flex-row flex-col tablet:flex-wrap items-center tablet:justify-center gap-1 rounded-2xl bg-black/50 p-1.5 backdrop-blur-sm"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2, delay: 0.1 }}
                >
                  <ToolbarButton
                    icon="ri:zoom-in-line"
                    label={t('image.zoomIn')}
                    onClick={handleZoomIn}
                    disabled={state.scale >= 4.9}
                  />
                  <motion.button
                    type="button"
                    onClick={handleResetAll}
                    className="flex size-10 shrink-0 items-center justify-center rounded-full text-white/60 text-xs tabular-nums transition-colors hover:bg-white/15 hover:text-white/80"
                    whileTap={{ scale: 0.85 }}
                    aria-label={t('image.resetZoomRotate')}
                  >
                    {zoomLevel}
                  </motion.button>
                  <ToolbarButton
                    icon="ri:zoom-out-line"
                    label={t('image.zoomOut')}
                    onClick={handleZoomOut}
                    disabled={state.scale <= 0.55}
                  />
                  <ToolbarButton
                    icon="ri:equalizer-2-line"
                    label={t('image.zoomSensitivity')}
                    onClick={() => setShowSensitivity((visible) => !visible)}
                    active={showSensitivity}
                  />
                  <AnimatePresence>
                    {showSensitivity && (
                      <motion.div
                        className="absolute tablet:top-[calc(100%+0.5rem)] top-1/2 right-[calc(100%+0.5rem)] tablet:right-auto tablet:left-1/2 w-56 tablet:-translate-x-1/2 -translate-y-1/2 tablet:translate-y-0 rounded-xl border border-white/15 bg-black/75 p-3 text-white shadow-xl backdrop-blur-md"
                        initial={{ opacity: 0, scale: 0.96, x: 4 }}
                        animate={{ opacity: 1, scale: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.96, x: 4 }}
                        transition={{ duration: 0.15 }}
                      >
                        <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                          <span className="font-semibold text-white/80">{t('image.zoomSensitivity')}</span>
                          <span className="font-mono text-white/60 tabular-nums">{zoomSensitivity.toFixed(2)}×</span>
                        </div>
                        <input
                          type="range"
                          min={MIN_ZOOM_SENSITIVITY}
                          max={MAX_ZOOM_SENSITIVITY}
                          step={0.05}
                          value={zoomSensitivity}
                          onChange={(event) => updateZoomSensitivity(event.currentTarget.valueAsNumber)}
                          aria-label={t('image.zoomSensitivity')}
                          className="h-1.5 w-full cursor-pointer accent-rose-400"
                        />
                        <div className="mt-2 flex justify-between text-[10px] text-white/45">
                          <span>{t('image.zoomSensitivitySlow')}</span>
                          <span>{t('image.zoomSensitivityFast')}</span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <div className="h-px tablet:h-5 tablet:w-px w-5 shrink-0 bg-white/20" />
                  <ToolbarButton icon="ri:clockwise-line" label={t('image.rotate')} onClick={handleRotate} />
                  {currentLike && (
                    <>
                      <div className="h-px tablet:h-5 tablet:w-px w-5 shrink-0 bg-white/20" />
                      <LightboxLikeButton action={currentLike} onClick={handleLike} />
                    </>
                  )}
                  {currentCopy && (
                    <ToolbarButton
                      icon={
                        currentCopyStatus === 'copied'
                          ? 'ri:check-line'
                          : currentCopyStatus === 'failed'
                            ? 'ri:error-warning-line'
                            : currentCopyStatus === 'copying'
                              ? 'ri:loader-4-line'
                              : 'ri:file-copy-line'
                      }
                      label={
                        currentCopyStatus === 'copied'
                          ? currentCopy.copiedLabel
                          : currentCopyStatus === 'failed'
                            ? currentCopy.failedLabel
                            : currentCopy.label
                      }
                      onClick={() => void handleCopy()}
                      disabled={currentCopyStatus === 'copying'}
                      spinning={currentCopyStatus === 'copying'}
                    />
                  )}
                  {currentDelete && (
                    <ToolbarButton
                      icon={
                        currentDeleteStatus === 'deleting'
                          ? 'ri:loader-4-line'
                          : currentDeleteStatus === 'failed'
                            ? 'ri:error-warning-line'
                            : 'ri:delete-bin-line'
                      }
                      label={
                        !currentDelete.enabled
                          ? currentDelete.unavailableLabel
                          : currentDeleteStatus === 'deleting'
                            ? currentDelete.deletingLabel
                            : currentDeleteStatus === 'failed'
                              ? currentDelete.failedLabel
                              : currentDelete.label
                      }
                      onClick={() => void handleDelete()}
                      disabled={!currentDelete.enabled || isDeleting}
                      spinning={currentDeleteStatus === 'deleting'}
                      tone="danger"
                    />
                  )}
                  {downloadAction && (
                    <ToolbarLink
                      href={downloadAction.href}
                      download={downloadAction.filename}
                      opensExternally={downloadAction.opensExternally}
                      icon={downloadAction.opensExternally ? 'ri:external-link-line' : 'ri:download-2-line'}
                      label={downloadAction.opensExternally ? t('image.openOriginal') : t('image.download')}
                    />
                  )}
                  {currentLocate && <ToolbarButton icon="ri:focus-3-line" label={t('image.locate')} onClick={handleLocate} />}
                  <div className="h-px tablet:h-5 tablet:w-px w-5 shrink-0 bg-white/20" />
                  <ToolbarButton icon="ri:close-line" label={t('image.close')} onClick={() => closeModal()} />
                </motion.div>

                <Dialog open={Boolean(promptPicker)} onOpenChange={(open) => !open && setPromptPicker(null)}>
                  <DialogContent
                    stableScroll
                    className="z-[70] flex max-h-[min(82dvh,46rem)] max-w-2xl flex-col gap-0 overflow-hidden bg-white p-0 dark:bg-gray-950"
                    overlayClassName="z-[70] bg-black/65"
                    onEscapeKeyDown={(event) => {
                      event.preventDefault();
                      setPromptPicker(null);
                    }}
                    onPointerDownOutside={(event) => {
                      event.preventDefault();
                      setPromptPicker(null);
                    }}
                  >
                    {promptPicker && currentCopy?.getPrompts && (
                      <StyleGalleryPromptChooser
                        key={getStyleGalleryPromptChooserKey(promptPicker.key, promptPicker.prompts, promptPicker.failed)}
                        prompts={promptPicker.prompts}
                        failed={promptPicker.failed}
                        labels={{
                          title: t('gallery.promptChooserTitle'),
                          description: t('gallery.promptChooserDescription'),
                          promptOption: t('gallery.promptOption'),
                          unknownModel: t('gallery.promptModelUnknown'),
                          loading: t('gallery.promptLoading'),
                          loadFailed: t('gallery.promptLoadFailed'),
                          copy: t('gallery.copy'),
                          copied: t('gallery.copied'),
                        }}
                        onRetry={() => void handleCopy()}
                        onCopy={copyPromptChoice}
                        reduceMotion={shouldReduceMotion}
                      />
                    )}
                  </DialogContent>
                </Dialog>

                {/* Image viewport with zoom/pan */}
                <div
                  ref={containerRef}
                  role="img"
                  className="flex h-full w-full touch-none select-none items-center justify-center p-4"
                  {...backdropPointerHandlers}
                  onDoubleClick={handleDoubleClick}
                >
                  <motion.div
                    className="flex items-center justify-center"
                    initial={{ scale: 0.95 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                  >
                    <motion.div
                      className="grid origin-center place-items-center rounded-lg will-change-transform"
                      animate={{ scale: state.scale, rotate: rotation }}
                      transition={{
                        scale: { type: 'tween', duration: 0.15, ease: 'easeOut' },
                        rotate: { type: 'spring', stiffness: 300, damping: 25 },
                      }}
                      style={{
                        x: state.translateX,
                        y: state.translateY,
                        cursor: state.scale > 1.05 ? 'grab' : 'zoom-in',
                      }}
                    >
                      <LightboxImageStage
                        key={currentImageKey}
                        image={currentImage}
                        imageKey={currentImageKey}
                        shouldReduceMotion={shouldReduceMotion}
                        onResolvedSourceFailure={handleResolvedSourceFailure}
                        onSourceSettled={setSettledImageKey}
                      />
                    </motion.div>
                  </motion.div>
                </div>

                {currentImage.source && (
                  <a
                    href={currentImage.source.href}
                    data-astro-prefetch="false"
                    data-lightbox-source
                    className="absolute top-4 left-4 flex max-w-[calc(100%-6rem)] items-center gap-2 rounded-xl border border-white/20 bg-black/60 p-2 pr-3 text-white shadow-lg backdrop-blur-md"
                  >
                    {currentImage.source.thumbnail && (
                      <img
                        src={currentImage.source.thumbnail}
                        alt=""
                        width={36}
                        height={36}
                        className="size-9 rounded-md object-cover"
                      />
                    )}
                    <span className="font-mono text-sm">{currentImage.source.hash}</span>
                    <Icon icon="ri:arrow-right-up-line" className="size-4" />
                  </a>
                )}
                {currentImage?.gallerySourceSlug && (
                  <div
                    className="absolute right-20 bottom-28 left-4 max-h-24 overflow-y-auto"
                    data-lightbox-scroll-region
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <ErrorBoundary FallbackComponent={InlineErrorFallback} resetKeys={[currentImage.gallerySourceSlug]}>
                      <GalleryLightboxTags
                        slug={currentImage.gallerySourceSlug}
                        onNavigate={closeModal}
                        locale={locale}
                        basePath={locale === 'zh' ? '/image-style-prompt-gallery' : `/${locale}/image-style-prompt-gallery`}
                      />
                    </ErrorBoundary>
                  </div>
                )}
                {/* Navigation bar */}
                {data.images.length > 1 && (
                  <div className="absolute bottom-12 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-black/50 p-1 backdrop-blur-sm">
                    <NavButton direction={-1} disabled={isDeleting || data.currentIndex === 0} onClick={() => navigateTo(-1)} />
                    <span className="min-w-14 px-1 text-center font-mono text-sm text-white/80 tabular-nums">
                      {data.currentIndex + 1} / {data.images.length}
                    </span>
                    <NavButton
                      direction={1}
                      disabled={isDeleting || data.currentIndex === data.images.length - 1}
                      onClick={() => navigateTo(1)}
                    />
                  </div>
                )}

                {/* Zoom hint */}
                <ZoomHint />
              </div>
            </FloatingFocusManager>
          </motion.div>
        )}
      </AnimatePresence>
    </FloatingPortal>
  );
}
