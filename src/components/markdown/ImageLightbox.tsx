/**
 * React image lightbox with zoom/pan support.
 * Replaces the vanilla DOM lightbox in image-enhancer.ts (~400 lines).
 *
 * Uses shared useZoomPan hook, Floating UI for dismiss behavior, and Motion animations.
 * Listens for 'open-image-lightbox' custom events dispatched by image-enhancer.ts.
 */

import { FloatingFocusManager, FloatingPortal, useDismiss, useFloating, useInteractions, useRole } from '@floating-ui/react';
import { useBackdropClickDismiss } from '@hooks/useBackdropClickDismiss';
import { useKeyboardShortcut } from '@hooks/useKeyboardShortcut';
import { useTranslation } from '@hooks/useTranslation';
import { useZoomPan } from '@hooks/useZoomPan';
import { createImageLightboxDownloadAction } from '@lib/image-lightbox-download';
import { getLive2DFocusNodes, isLive2DOwnedTarget } from '@lib/live2d/focus-scope';
import { useStore } from '@nanostores/react';
import {
  $imageLightboxData,
  closeModal,
  type ImageLightboxData,
  navigateImage,
  openModal,
  removeImageFromLightbox,
  updateImageLightboxLike,
} from '@store/modal';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LightboxLikeButton, NavButton, ToolbarButton, ToolbarLink, ZoomHint } from './ImageLightboxControls';

const ZOOM_SENSITIVITY_STORAGE_KEY = 'image-lightbox-zoom-sensitivity';
const DEFAULT_ZOOM_SENSITIVITY = 0.55;
const MIN_ZOOM_SENSITIVITY = 0.25;
const MAX_ZOOM_SENSITIVITY = 1.25;

export default function ImageLightbox() {
  const { t } = useTranslation();
  const data = useStore($imageLightboxData);
  const isOpen = data !== null;
  const currentImage = data?.images[data.currentIndex];
  const currentLike = currentImage?.like;
  const currentCopy = currentImage?.copy;
  const currentDelete = currentImage?.delete;
  const downloadAction = currentImage ? createImageLightboxDownloadAction(currentImage.src) : null;
  const currentImageKey = currentImage?.id ?? `${data?.currentIndex ?? 0}:${currentImage?.src ?? ''}`;
  const [imageLoaded, setImageLoaded] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [zoomSensitivity, setZoomSensitivity] = useState(DEFAULT_ZOOM_SENSITIVITY);
  const [showSensitivity, setShowSensitivity] = useState(false);
  const [copyState, setCopyState] = useState<{ key: string; status: 'copying' | 'copied' | 'failed' } | null>(null);
  const [deleteState, setDeleteState] = useState<{ key: string; status: 'deleting' | 'failed' } | null>(null);
  const currentCopyStatus = copyState?.key === currentImageKey ? copyState.status : null;
  const currentDeleteStatus = deleteState?.key === currentImageKey ? deleteState.status : null;
  const copyAttemptRef = useRef(0);
  const deleteAttemptRef = useRef(0);
  const copyTimerRef = useRef(0);
  const deleteTimerRef = useRef(0);

  const { containerRef, state, reset, zoomTo, zoomLevel } = useZoomPan(isOpen, { zoomSensitivity });

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
    // 未登录时直接交给 action 跳转 OAuth，不在离开页面前制造一次虚假的乐观计数。
    if (!currentLike.viewerAuthenticated) {
      await currentLike.toggle();
      return;
    }
    const previous = { liked: currentLike.liked, likeCount: currentLike.likeCount };
    updateImageLightboxLike(currentLike.exampleId, {
      liked: !currentLike.liked,
      likeCount: Math.max(0, currentLike.likeCount + (currentLike.liked ? -1 : 1)),
      pending: true,
    });
    try {
      const result = await currentLike.toggle();
      updateImageLightboxLike(currentLike.exampleId, result ? { ...result, pending: false } : { ...previous, pending: false });
    } catch {
      // Gallery controller 会记录详细错误；lightbox 只负责恢复此次交互前的视觉状态。
      updateImageLightboxLike(currentLike.exampleId, { ...previous, pending: false });
    }
  }, [currentLike]);

  const handleCopy = useCallback(async () => {
    if (!currentCopy) return;
    const key = currentImageKey;
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
        setImageLoaded(false);
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
      setImageLoaded(false);
    },
    [isDeleting, reset],
  );

  // Keyboard shortcuts for navigation
  useKeyboardShortcut({
    key: 'ArrowLeft',
    handler: () => navigateTo(-1),
    enabled: isOpen,
    ignoreInputs: false,
    preventDefault: false,
  });

  useKeyboardShortcut({
    key: 'ArrowRight',
    handler: () => navigateTo(1),
    enabled: isOpen,
    ignoreInputs: false,
    preventDefault: false,
  });

  // Keyboard shortcuts for zoom/rotate
  useKeyboardShortcut({ key: '=', handler: handleZoomIn, enabled: isOpen, ignoreInputs: false, preventDefault: false });
  useKeyboardShortcut({ key: '+', handler: handleZoomIn, enabled: isOpen, ignoreInputs: false, preventDefault: false });
  useKeyboardShortcut({ key: '-', handler: handleZoomOut, enabled: isOpen, ignoreInputs: false, preventDefault: false });
  useKeyboardShortcut({ key: 'r', handler: handleRotate, enabled: isOpen, ignoreInputs: false, preventDefault: false });
  useKeyboardShortcut({ key: '0', handler: handleResetShortcut, enabled: isOpen, ignoreInputs: false, preventDefault: false });

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
    deleteAttemptRef.current += 1;
    window.clearTimeout(copyTimerRef.current);
    window.clearTimeout(deleteTimerRef.current);
    if (isOpen) {
      reset();
      setRotation(0);
      setImageLoaded(false);
      setShowSensitivity(false);
      setCopyState(null);
      setDeleteState(null);
    }
    return () => {
      window.clearTimeout(copyTimerRef.current);
      window.clearTimeout(deleteTimerRef.current);
    };
  }, [isOpen, reset]);

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

  // Lock page scroll while lightbox is open
  useEffect(() => {
    if (!isOpen) return;
    const prevent = (e: WheelEvent) => e.preventDefault();
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

  if (!data) return null;

  return (
    <FloatingPortal>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="fixed inset-0 z-60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Backdrop */}
            <div className="fixed inset-0 bg-black/90 backdrop-blur-sm" />
            {/* Content */}
            <FloatingFocusManager context={context} getInsideElements={getLive2DFocusNodes}>
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
                  <div className="h-px tablet:h-5 tablet:w-px w-5 shrink-0 bg-white/20" />
                  <ToolbarButton icon="ri:close-line" label={t('image.close')} onClick={() => closeModal()} />
                </motion.div>

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
                    <motion.img
                      src={data.src}
                      alt={data.alt}
                      className="max-h-[80vh] max-w-[90vw] origin-center rounded-lg object-contain shadow-2xl will-change-transform"
                      animate={{ scale: state.scale, rotate: rotation, opacity: imageLoaded ? 1 : 0 }}
                      transition={{
                        scale: { type: 'tween', duration: 0.15, ease: 'easeOut' },
                        rotate: { type: 'spring', stiffness: 300, damping: 25 },
                        opacity: { duration: 0.2 },
                      }}
                      style={{
                        x: state.translateX,
                        y: state.translateY,
                        cursor: state.scale > 1.05 ? 'grab' : 'zoom-in',
                      }}
                      onLoad={() => setImageLoaded(true)}
                      draggable={false}
                    />
                  </motion.div>
                </div>

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
