import { ErrorBoundary } from '@components/common';
import { Live2DAnimationPanel } from '@components/live2d/Live2DAnimationPanel';
import { Live2DControls } from '@components/live2d/Live2DControls';
import { Live2DModelPicker } from '@components/live2d/Live2DModelPicker';
import { Live2DSettings } from '@components/live2d/Live2DSettings';
import { useTranslation } from '@hooks/useTranslation';
import { Icon } from '@iconify/react';
import { findLive2DCostume, live2dCatalog } from '@lib/live2d/catalog';
import { markLive2DEscapeHandled, registerLive2DFocusNode } from '@lib/live2d/focus-scope';
import { classifyLive2DPointerMovement } from '@lib/live2d/geometry';
import { Live2DInteractionGeneration, resolveLive2DInteraction } from '@lib/live2d/interactions';
import type { Live2DDisplayPolicy } from '@lib/live2d/preferences';
import type { Live2DRenderer, Live2DRendererPhase } from '@lib/live2d/renderer';
import { useStore } from '@nanostores/react';
import { $live2dState, live2dActions } from '@store/live2d';
import { $activeModal } from '@store/modal';
import { $activePlayerId, claimActivePlayer, releaseActivePlayer } from '@store/player';
import { type CSSProperties, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface Live2DWidgetConfig {
  defaultCharacterId: string;
  defaultCostumeId: string;
  desktopIdleDelayMs: number;
  displayPolicy: Live2DDisplayPolicy;
  audioEnabled: boolean;
}

interface PointerStart {
  pointer: { x: number; y: number };
  widget: { x: number; y: number };
}

const immersiveModals = new Set(['imageLightbox', 'codeFullscreen', 'diagramFullscreen']);
const LIVE2D_PLAYER_ID = 'live2d-character-audio';
const DIALOGUE_DURATION_MS = 6_000;
const Live2DCanvas = lazy(async () => {
  const module = await import('./Live2DCanvas');
  return { default: module.Live2DCanvas };
});

function catalogSelections() {
  return live2dCatalog.characters.flatMap((character) =>
    character.costumes.map((costume) => ({ characterId: character.id, costumeId: costume.id })),
  );
}

function textLabel(values: Record<string, string>, locale: string): string {
  return values[locale] ?? values.zh ?? values.en ?? Object.values(values)[0] ?? '';
}

/** Persistent shell: all visual, preference, asset and renderer work stays behind this single island. */
function Live2DWidgetContent({
  defaultCharacterId,
  defaultCostumeId,
  desktopIdleDelayMs,
  displayPolicy,
  audioEnabled,
}: Live2DWidgetConfig) {
  const { t, locale } = useTranslation();
  const state = useStore($live2dState);
  const modal = useStore($activeModal);
  const activePlayerId = useStore($activePlayerId);
  const rootRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLButtonElement>(null);
  const rendererRef = useRef<Live2DRenderer | null>(null);
  const rootFocusCleanup = useRef<(() => void) | null>(null);
  const wakeFocusCleanup = useRef<(() => void) | null>(null);
  const pointerStart = useRef<PointerStart | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const dialogueTimerRef = useRef<number | null>(null);
  const interactionGeneration = useRef(new Live2DInteractionGeneration());
  const interactionSelectionRef = useRef('');
  const selectedMotionRef = useRef<{ group: string; index: number } | null>(null);
  const selectedExpressionRef = useRef('');
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [rendererStarted, setRendererStarted] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [dialogue, setDialogue] = useState('');
  const [viewportWidth, setViewportWidth] = useState(1024);
  const [modelControls, setModelControls] = useState<{ motions: Record<string, string[]>; expressions: string[] }>({
    motions: {},
    expressions: [],
  });
  const [userPaused, setUserPaused] = useState(false);
  const [pausedFrame, setPausedFrame] = useState<string | null>(null);
  const [selectedMotion, setSelectedMotion] = useState('');
  const [selectedExpression, setSelectedExpression] = useState('');
  const orderedSelections = useMemo(catalogSelections, []);

  const stopAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    releaseActivePlayer(LIVE2D_PLAYER_ID);
  }, []);

  const stopTransientInteraction = useCallback(() => {
    interactionGeneration.current.invalidate();
    if (dialogueTimerRef.current !== null) window.clearTimeout(dialogueTimerRef.current);
    dialogueTimerRef.current = null;
    setDialogue('');
    stopAudio();
  }, [stopAudio]);

  useEffect(() => {
    // stopAudio uses compare-and-clear release, so it cannot clear the newer owner's claim.
    if (activePlayerId !== null && activePlayerId !== LIVE2D_PLAYER_ID) stopAudio();
  }, [activePlayerId, stopAudio]);

  const costume =
    findLive2DCostume(state.preferences.selection.characterId, state.preferences.selection.costumeId) ??
    findLive2DCostume(defaultCharacterId, defaultCostumeId) ??
    live2dCatalog.characters[0]?.costumes[0];
  const character = live2dCatalog.characters.find((candidate) => candidate.id === state.preferences.selection.characterId);
  const characterName = character ? textLabel(character.label, locale) : t('live2d.character');
  const rendererSelection = useMemo(
    () =>
      costume
        ? {
            key: `${state.preferences.selection.characterId}/${state.preferences.selection.costumeId}`,
            entryPath: `/api/live2d-assets/${costume.entryPath}`,
            scale: costume.scale,
            position: costume.position,
          }
        : null,
    [costume, state.preferences.selection.characterId, state.preferences.selection.costumeId],
  );

  useEffect(() => {
    live2dActions.initialize({
      selection: { characterId: defaultCharacterId, costumeId: defaultCostumeId },
      displayPolicy,
      audioEnabled,
    });
    live2dActions.reconcileSelection(orderedSelections, { characterId: defaultCharacterId, costumeId: defaultCostumeId });
  }, [audioEnabled, defaultCharacterId, defaultCostumeId, displayPolicy, orderedSelections]);

  useEffect(() => {
    const update = () => {
      const root = rootRef.current;
      const exclusions = [...document.querySelectorAll<HTMLElement>('[data-live2d-exclusion]')].map((node) => {
        const rect = node.getBoundingClientRect();
        return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
      });
      const mobile = window.innerWidth <= 768;
      live2dActions.setGeometry({
        viewport: { width: window.innerWidth, height: window.innerHeight },
        widget: {
          width: root?.offsetWidth || (mobile ? 192 : 280),
          height: root?.offsetHeight || (mobile ? 300 : 390),
        },
        sidebarAnchor: null,
        exclusionZones: exclusions,
        mobile,
      });
      live2dActions.setViewportWidth(window.innerWidth);
      setViewportWidth(window.innerWidth);
    };
    update();
    window.addEventListener('resize', update, { passive: true });
    document.addEventListener('astro:page-load', update);
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('astro:page-load', update);
      live2dActions.clearGeometry();
    };
  }, []);

  useEffect(() => {
    if (state.viewportMode !== 'desktop' || rendererStarted) return;
    let cancelled = false;
    const start = () => {
      if (!cancelled && live2dActions.scheduleDesktopIdleLoad()) setRendererStarted(true);
    };
    const timeout = window.setTimeout(() => {
      if ('requestIdleCallback' in window) window.requestIdleCallback(start, { timeout: 1200 });
      else start();
    }, desktopIdleDelayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [desktopIdleDelayMs, rendererStarted, state.viewportMode]);

  useEffect(() => {
    if (state.loadIntent !== 'none') setRendererStarted(true);
  }, [state.loadIntent]);

  useEffect(() => {
    live2dActions.setAvoidanceHidden(state.preferences.displayPolicy === 'smart' && immersiveModals.has(modal.type ?? ''));
  }, [modal.type, state.preferences.displayPolicy]);

  useEffect(() => {
    if (state.avoidanceHidden && state.activePanel) live2dActions.setActivePanel(null);
  }, [state.activePanel, state.avoidanceHidden]);

  useEffect(() => {
    const selectionKey = rendererSelection?.key ?? '';
    if (interactionSelectionRef.current === selectionKey) return;
    interactionSelectionRef.current = selectionKey;
    setUserPaused(false);
    setPausedFrame(null);
    selectedMotionRef.current = null;
    selectedExpressionRef.current = '';
    setSelectedMotion('');
    setSelectedExpression('');
    rendererRef.current?.resume();
    stopTransientInteraction();
  }, [rendererSelection?.key, stopTransientInteraction]);

  useEffect(() => {
    if (state.preferences.hidden || state.avoidanceHidden || state.rendererStatus === 'recoverable') {
      stopTransientInteraction();
    }
  }, [state.avoidanceHidden, state.preferences.hidden, state.rendererStatus, stopTransientInteraction]);

  useEffect(() => {
    const syncRendererActivity = () => {
      const shouldPause = document.hidden || state.preferences.hidden || state.avoidanceHidden || userPaused;
      if (shouldPause) rendererRef.current?.suspend();
      else rendererRef.current?.resume();
    };
    syncRendererActivity();
    document.addEventListener('visibilitychange', syncRendererActivity);
    return () => document.removeEventListener('visibilitychange', syncRendererActivity);
  }, [state.avoidanceHidden, state.preferences.hidden, userPaused]);

  useEffect(() => {
    if (!state.preferences.audioEnabled) stopAudio();
  }, [state.preferences.audioEnabled, stopAudio]);

  useEffect(() => {
    const stopWhenHidden = () => {
      if (document.hidden) stopTransientInteraction();
    };
    document.addEventListener('visibilitychange', stopWhenHidden);
    document.addEventListener('astro:before-preparation', stopTransientInteraction);
    return () => {
      document.removeEventListener('visibilitychange', stopWhenHidden);
      document.removeEventListener('astro:before-preparation', stopTransientInteraction);
      stopTransientInteraction();
    };
  }, [stopTransientInteraction]);

  const setRootNode = useCallback((node: HTMLDivElement | null) => {
    rootFocusCleanup.current?.();
    rootFocusCleanup.current = null;
    rootRef.current = node;
    if (node) rootFocusCleanup.current = registerLive2DFocusNode(node);
  }, []);
  const setWakeNode = useCallback((node: HTMLButtonElement | null) => {
    wakeFocusCleanup.current?.();
    wakeFocusCleanup.current = null;
    if (node) wakeFocusCleanup.current = registerLive2DFocusNode(node);
  }, []);
  useEffect(
    () => () => {
      rootFocusCleanup.current?.();
      wakeFocusCleanup.current?.();
    },
    [],
  );

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !state.activePanel) return;
      // Existing site modals keep ownership of Escape unless focus is inside Live2D.
      if (modal.type && !rootRef.current?.contains(document.activeElement)) return;
      live2dActions.setActivePanel(null);
      markLive2DEscapeHandled(event);
      event.stopImmediatePropagation();
    };
    document.addEventListener('keydown', handleEscape, true);
    return () => document.removeEventListener('keydown', handleEscape, true);
  }, [modal.type, state.activePanel]);

  useEffect(() => {
    if (!state.activePanel) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !rootRef.current?.contains(target)) live2dActions.setActivePanel(null);
    };
    document.addEventListener('pointerdown', closeOutside, true);
    return () => document.removeEventListener('pointerdown', closeOutside, true);
  }, [state.activePanel]);

  const handlePhase = useCallback(
    (phase: Live2DRendererPhase) => {
      if (phase === 'recoverable') stopTransientInteraction();
      if (phase === 'loading' || phase === 'ready' || phase === 'recoverable' || phase === 'dormant') {
        live2dActions.setRendererStatus(phase);
      }
      if (phase === 'ready') {
        setModelControls({
          motions: rendererRef.current?.getMotions() ?? {},
          expressions: rendererRef.current?.getExpressions() ?? [],
        });
        const rememberedMotion = selectedMotionRef.current;
        if (selectedExpressionRef.current) rendererRef.current?.setExpression(selectedExpressionRef.current);
        if (rememberedMotion) rendererRef.current?.playMotion(rememberedMotion.group, rememberedMotion.index);
      }
    },
    [stopTransientInteraction],
  );

  const interact = useCallback(
    (area = 'head') => {
      if (!costume || state.rendererStatus !== 'ready') return;
      const resolved = resolveLive2DInteraction(costume.interactions, area);
      if (!resolved) return;
      const { mapping, line } = resolved;
      const generation = interactionGeneration.current.next();
      if (dialogueTimerRef.current !== null) window.clearTimeout(dialogueTimerRef.current);
      if (mapping.expression) {
        selectedExpressionRef.current = mapping.expression;
        setSelectedExpression(mapping.expression);
        rendererRef.current?.setExpression(mapping.expression);
      }
      if (mapping.motionGroup) {
        const index = mapping.motionIndex ?? 0;
        selectedMotionRef.current = { group: mapping.motionGroup, index };
        setSelectedMotion(`${mapping.motionGroup}\u0000${index}`);
        rendererRef.current?.playMotion(mapping.motionGroup, mapping.motionIndex);
      }
      setDialogue(line);
      dialogueTimerRef.current = window.setTimeout(() => {
        if (interactionGeneration.current.isCurrent(generation)) setDialogue('');
        dialogueTimerRef.current = null;
      }, DIALOGUE_DURATION_MS);

      stopAudio();
      if (!state.preferences.audioEnabled || !mapping.audio) return;
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      const releaseIfCurrent = () => {
        if (interactionGeneration.current.isCurrent(generation)) releaseActivePlayer(LIVE2D_PLAYER_ID);
      };
      audio.onended = releaseIfCurrent;
      audio.onerror = releaseIfCurrent;
      audio.src = `/api/live2d-assets/releases/${costume.releaseId}/${mapping.audio
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')}`;
      claimActivePlayer(LIVE2D_PLAYER_ID);
      void audio.play().catch(() => releaseIfCurrent());
    },
    [costume, state.preferences.audioEnabled, state.rendererStatus, stopAudio],
  );
  const keepRenderer = useCallback((renderer: Live2DRenderer | null) => {
    rendererRef.current = renderer;
    if (!renderer) setModelControls({ motions: {}, expressions: [] });
  }, []);

  const togglePause = useCallback(() => {
    if (userPaused) {
      setPausedFrame(null);
      setUserPaused(false);
      return;
    }
    const frame = rendererRef.current?.captureFrame();
    if (!frame) return;
    setPausedFrame(frame);
    setUserPaused(true);
  }, [userPaused]);

  const downloadScreenshot = useCallback(() => {
    const frame = pausedFrame ?? rendererRef.current?.captureFrame();
    if (!frame) return;
    const anchor = document.createElement('a');
    anchor.href = frame;
    anchor.download = `${state.preferences.selection.characterId}-${state.preferences.selection.costumeId}.png`;
    anchor.click();
  }, [pausedFrame, state.preferences.selection.characterId, state.preferences.selection.costumeId]);

  const selectMotion = useCallback((group: string, index: number) => {
    selectedMotionRef.current = { group, index };
    setSelectedMotion(`${group}\u0000${index}`);
    rendererRef.current?.playMotion(group, index);
  }, []);

  const selectExpression = useCallback((expression?: string) => {
    const next = expression ?? '';
    selectedExpressionRef.current = next;
    setSelectedExpression(next);
    rendererRef.current?.setExpression(expression);
  }, []);

  const cycle = (direction: -1 | 1) => {
    const current = orderedSelections.findIndex(
      (entry) =>
        entry.characterId === state.preferences.selection.characterId &&
        entry.costumeId === state.preferences.selection.costumeId,
    );
    const next = orderedSelections[(Math.max(current, 0) + direction + orderedSelections.length) % orderedSelections.length];
    if (next) live2dActions.select(next);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    const point = state.renderedPlacement?.position;
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerStart.current = { pointer: { x: event.clientX, y: event.clientY }, widget: point };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!pointerStart.current) return;
    setDragOffset({ x: event.clientX - pointerStart.current.pointer.x, y: event.clientY - pointerStart.current.pointer.y });
  };
  const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;
    const current = { x: event.clientX, y: event.clientY };
    if (classifyLive2DPointerMovement(start.pointer, current) === 'drag') {
      live2dActions.moveTo({
        x: start.widget.x + current.x - start.pointer.x,
        y: start.widget.y + current.y - start.pointer.y,
      });
    } else {
      interact(event.nativeEvent.offsetY < event.currentTarget.clientHeight * 0.55 ? 'head' : 'body');
    }
    setDragOffset({ x: 0, y: 0 });
  };

  const placement = state.renderedPlacement?.position;
  const manuallyHidden = state.preferences.hidden;
  const dormantMobile = state.viewportMode === 'mobile' && !rendererStarted && state.loadIntent === 'none';
  if ((manuallyHidden || dormantMobile || state.renderedPlacement?.mode === 'collapsed') && !state.avoidanceHidden) {
    return (
      <button
        ref={setWakeNode}
        type="button"
        className="live2d-wake"
        data-live2d-policy={state.preferences.displayPolicy}
        onClick={() => {
          live2dActions.wake();
          setRendererStarted(true);
        }}
        aria-label={t('live2d.wake')}
        title={t('live2d.wake')}
      >
        <Icon icon="ri:user-smile-line" aria-hidden="true" />
      </button>
    );
  }

  if (!placement || !costume || !rendererSelection) return null;

  const transform = `translate3d(${placement.x + dragOffset.x}px, ${placement.y + dragOffset.y}px, 0)`;
  const rootStyle = {
    transform,
    '--live2d-screen-x': `${placement.x}px`,
  } as CSSProperties;
  const labels = {
    toolbar: t('live2d.toolbar'),
    previous: t('live2d.previous'),
    next: t('live2d.next'),
    characters: t('live2d.characters'),
    animations: t('live2d.animations'),
    settings: t('live2d.settings'),
    close: t('live2d.close'),
    hide: t('live2d.hide'),
    restore: t('live2d.restore'),
    audio: t('live2d.audio'),
    audioDescription: t('live2d.audioDescription'),
    displayPolicy: t('live2d.displayPolicy'),
    smart: t('live2d.smart'),
    alwaysVisible: t('live2d.alwaysVisible'),
    position: t('live2d.position'),
    nudge: t('live2d.nudge'),
    up: t('live2d.up'),
    right: t('live2d.right'),
    down: t('live2d.down'),
    left: t('live2d.left'),
    'bottom-left': t('live2d.bottomLeft'),
    'bottom-center': t('live2d.bottomCenter'),
    'bottom-right': t('live2d.bottomRight'),
    search: t('live2d.search'),
    searchPlaceholder: t('live2d.searchPlaceholder'),
    costumeCount: t('live2d.costumeCount'),
    noResults: t('live2d.noResults'),
    playbackTools: t('live2d.playbackTools'),
    pause: t('live2d.pause'),
    resume: t('live2d.resume'),
    screenshot: t('live2d.screenshot'),
    motion: t('live2d.motion'),
    playMotion: t('live2d.playMotion'),
    selectMotion: t('live2d.selectMotion'),
    expression: t('live2d.expression'),
    randomExpression: t('live2d.randomExpression'),
    unavailable: t('live2d.unavailable'),
    pagination: t('live2d.pagination'),
    previousPage: t('live2d.previousPage'),
    nextPage: t('live2d.nextPage'),
    pageStatus: t('live2d.pageStatus'),
  };
  return (
    <div
      ref={setRootNode}
      className="live2d-root"
      style={rootStyle}
      data-phase={state.rendererStatus}
      data-live2d-policy={state.preferences.displayPolicy}
      data-panel-align={placement.x + 140 < viewportWidth / 2 ? 'left' : 'right'}
      data-avoidance-hidden={state.avoidanceHidden || undefined}
      aria-hidden={state.avoidanceHidden || undefined}
      inert={state.avoidanceHidden}
    >
      <div className="live2d-stage">
        {rendererStarted && (
          <Suspense fallback={null}>
            <Live2DCanvas
              selection={rendererSelection}
              active
              retryNonce={retryNonce}
              onPhase={handlePhase}
              onTap={interact}
              onRenderer={keepRenderer}
            />
          </Suspense>
        )}
        <button
          ref={surfaceRef}
          type="button"
          className="live2d-interaction-surface"
          aria-label={t('live2d.interact', { name: characterName })}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              interact();
              return;
            }
            const direction = {
              ArrowUp: 'up',
              ArrowRight: 'right',
              ArrowDown: 'down',
              ArrowLeft: 'left',
            }[event.key] as 'up' | 'right' | 'down' | 'left' | undefined;
            if (direction) {
              event.preventDefault();
              live2dActions.nudge(direction);
            }
          }}
        />
        {state.rendererStatus === 'loading' && <div className="live2d-status">{t('live2d.loading')}</div>}
        {state.rendererStatus === 'recoverable' && (
          <div className="live2d-status live2d-error" role="alert">
            <span>{t('live2d.failed')}</span>
            <button
              type="button"
              onClick={() => {
                live2dActions.requestVisitorLoad();
                setRetryNonce((value) => value + 1);
              }}
            >
              {t('live2d.retry')}
            </button>
          </div>
        )}
        {dialogue && <output className="live2d-dialogue">{dialogue}</output>}
        {pausedFrame && <img className="live2d-paused-frame" src={pausedFrame} alt="" aria-hidden="true" />}
      </div>
      <Live2DControls
        labels={labels}
        onPrevious={() => cycle(-1)}
        onNext={() => cycle(1)}
        onCharacters={() => live2dActions.setActivePanel(state.activePanel === 'picker' ? null : 'picker')}
        onAnimations={() => live2dActions.setActivePanel(state.activePanel === 'animations' ? null : 'animations')}
        onSettings={() => live2dActions.setActivePanel(state.activePanel === 'settings' ? null : 'settings')}
        onHide={() => live2dActions.setManualHidden(true)}
      />
      {state.activePanel === 'picker' && (
        <Live2DModelPicker
          catalog={live2dCatalog}
          locale={locale}
          selected={state.preferences.selection}
          title={t('live2d.characters')}
          labels={labels}
          onSelect={live2dActions.select}
          onClose={() => live2dActions.setActivePanel(null)}
        />
      )}
      {state.activePanel === 'animations' && (
        <Live2DAnimationPanel
          labels={labels}
          motions={modelControls.motions}
          expressions={modelControls.expressions}
          selectedMotion={selectedMotion}
          selectedExpression={selectedExpression}
          paused={userPaused}
          onPlayMotion={selectMotion}
          onExpression={selectExpression}
          onPause={togglePause}
          onScreenshot={downloadScreenshot}
          onClose={() => live2dActions.setActivePanel(null)}
        />
      )}
      {state.activePanel === 'settings' && (
        <Live2DSettings
          labels={labels}
          audioEnabled={state.preferences.audioEnabled}
          displayPolicy={state.preferences.displayPolicy}
          placement={state.preferences.placement}
          onAudio={live2dActions.setAudioEnabled}
          onPolicy={live2dActions.setDisplayPolicy}
          onPreset={live2dActions.setPreset}
          onClose={() => live2dActions.setActivePanel(null)}
        />
      )}
      <span className="sr-only" aria-live="polite">
        {state.rendererStatus === 'ready' ? t('live2d.ready', { name: characterName }) : ''}
      </span>
    </div>
  );
}

function Live2DWidgetFallback() {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="live2d-wake"
      // React.lazy 会缓存失败的 chunk Promise；刷新页面才能建立新的网络代际。
      onClick={() => window.location.reload()}
      aria-label={t('live2d.retry')}
      title={t('live2d.retry')}
    >
      <Icon icon="ri:refresh-line" aria-hidden="true" />
    </button>
  );
}

/** 将可选角色组件的异常限制在自身边界内，避免破坏持久博客布局，并提供局部重试。 */
export default function Live2DWidget(config: Live2DWidgetConfig) {
  return (
    <ErrorBoundary FallbackComponent={Live2DWidgetFallback} resetKeys={[config.defaultCharacterId, config.defaultCostumeId]}>
      <Live2DWidgetContent {...config} />
    </ErrorBoundary>
  );
}
