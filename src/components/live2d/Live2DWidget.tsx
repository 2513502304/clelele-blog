import { ErrorBoundary } from '@components/common';
import { Live2DAnimationPanel } from '@components/live2d/Live2DAnimationPanel';
import { Live2DControls } from '@components/live2d/Live2DControls';
import { Live2DModelPicker } from '@components/live2d/Live2DModelPicker';
import { Live2DSettings } from '@components/live2d/Live2DSettings';
import { useTranslation } from '@hooks/useTranslation';
import { Icon } from '@iconify/react';
import { fetchLive2DCatalog, findLive2DSelection, getLive2DCatalogSelections, live2dCatalog } from '@lib/live2d/catalog';
import { markLive2DEscapeHandled, registerLive2DFocusNode } from '@lib/live2d/focus-scope';
import { classifyLive2DPointerMovement } from '@lib/live2d/geometry';
import { Live2DInteractionGeneration, resolveLive2DPlayback, textDialogueDuration } from '@lib/live2d/interactions';
import type { Live2DDisplayPolicy } from '@lib/live2d/preferences';
import type { Live2DRenderer, Live2DRendererPhase } from '@lib/live2d/renderer';
import type { Live2DCatalog, Live2DVoiceIndex } from '@lib/live2d/types';
import { live2dVoiceAudioPreloader, live2dVoiceIndexCache } from '@lib/live2d/voice-index';
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
const AUDIO_START_TIMEOUT_MS = 15_000;
const USER_SELECTED_MOTION_PRIORITY = 3;
type AudioStatus = 'none' | 'loading' | 'playing';
const Live2DCanvas = lazy(async () => {
  const module = await import('./Live2DCanvas');
  return { default: module.Live2DCanvas };
});

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
  const selectedMotionRef = useRef<{
    group: string;
    index: number;
    priority?: number;
  } | null>(null);
  const selectedExpressionRef = useRef('');
  const effectsRef = useRef(state.preferences.effects);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [rendererStarted, setRendererStarted] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [dialogue, setDialogue] = useState('');
  const [audioStatus, setAudioStatus] = useState<AudioStatus>('none');
  const [viewportWidth, setViewportWidth] = useState(1024);
  const [modelControls, setModelControls] = useState<{
    motions: Record<string, string[]>;
    expressions: string[];
  }>({
    motions: {},
    expressions: [],
  });
  const [userPaused, setUserPaused] = useState(false);
  const [selectedMotion, setSelectedMotion] = useState('');
  const [selectedExpression, setSelectedExpression] = useState('');
  const [catalog, setCatalog] = useState<Live2DCatalog>(live2dCatalog);
  const [voiceIndex, setVoiceIndex] = useState<{ releaseId: string; value: Live2DVoiceIndex } | null>(null);
  const orderedSelections = useMemo(() => getLive2DCatalogSelections(catalog), [catalog]);

  const stopAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    setAudioStatus('none');
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
    // The nested stopAudio uses compare-and-clear release, so it cannot clear the newer owner's claim.
    if (activePlayerId !== null && activePlayerId !== LIVE2D_PLAYER_ID) stopTransientInteraction();
  }, [activePlayerId, stopTransientInteraction]);

  const resolvedSelection =
    findLive2DSelection(state.preferences.selection.characterId, state.preferences.selection.costumeId, catalog) ??
    findLive2DSelection(defaultCharacterId, defaultCostumeId, catalog) ??
    (catalog.characters[0]?.costumes[0]
      ? { character: catalog.characters[0], costume: catalog.characters[0].costumes[0] }
      : null);
  const character = resolvedSelection?.character;
  const costume = resolvedSelection?.costume;
  const characterName = character ? textLabel(character.label, locale) : t('live2d.character');
  const activeVoiceIndex = voiceIndex && character?.voice?.releaseId === voiceIndex.releaseId ? voiceIndex.value : null;
  const rendererSelection = useMemo(
    () =>
      costume
        ? {
            key: `${character?.id}/${costume.id}`,
            entryPath: `/api/live2d-assets/${costume.entryPath}`,
            scale: costume.scale,
            position: costume.position,
          }
        : null,
    [character?.id, costume],
  );

  useEffect(() => {
    live2dActions.initialize({
      selection: {
        characterId: defaultCharacterId,
        costumeId: defaultCostumeId,
      },
      displayPolicy,
      audioEnabled,
    });
  }, [audioEnabled, defaultCharacterId, defaultCostumeId, displayPolicy]);

  useEffect(() => {
    live2dActions.reconcileSelection(orderedSelections, {
      characterId: defaultCharacterId,
      costumeId: defaultCostumeId,
    });
  }, [defaultCharacterId, defaultCostumeId, orderedSelections]);

  useEffect(() => {
    if (!rendererStarted) return;
    const controller = new AbortController();
    void fetchLive2DCatalog(fetch, controller.signal)
      .then(setCatalog)
      .catch(() => {
        // 静态 bootstrap 已经可用；远程目录网络失败不应中断当前模型和页面交互。
      });
    return () => controller.abort();
  }, [rendererStarted]);

  const characterVoice = character?.voice;
  useEffect(() => {
    const voice = characterVoice;
    let active = true;
    setVoiceIndex((current) => (voice && current?.releaseId === voice.releaseId ? current : null));
    // 语音目录不参与首帧渲染；等模型 ready 后再读取，避免与 moc、纹理竞争连接。
    if (voice && state.rendererStatus === 'ready') {
      void live2dVoiceIndexCache
        .get(voice)
        .then((value) => {
          if (active) setVoiceIndex({ releaseId: voice.releaseId, value });
        })
        .catch(() => {
          // 语音目录失败时继续使用服装内的兼容台词，不影响模型渲染和互动。
        });
    }
    return () => {
      active = false;
    };
  }, [characterVoice, state.rendererStatus]);

  useEffect(() => {
    if (!activeVoiceIndex || !characterVoice || !state.preferences.audioEnabled) return;
    const controller = new AbortController();
    let cancelled = false;
    let idleHandle: number | null = null;
    const prefetch = () => {
      idleHandle = null;
      if (!cancelled) {
        void live2dVoiceAudioPreloader.prefetch(activeVoiceIndex, characterVoice.releaseId, {
          signal: controller.signal,
        });
      }
    };
    if (typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(prefetch, { timeout: 3_000 });
    } else idleHandle = globalThis.setTimeout(prefetch, 0) as unknown as number;
    return () => {
      cancelled = true;
      if (idleHandle !== null) {
        if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleHandle);
        else globalThis.clearTimeout(idleHandle);
      }
      controller.abort();
    };
  }, [activeVoiceIndex, characterVoice, state.preferences.audioEnabled]);

  useEffect(() => {
    const update = () => {
      const root = rootRef.current;
      const exclusions = [...document.querySelectorAll<HTMLElement>('[data-live2d-exclusion]')].map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        };
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
    rendererRef.current?.setPlaybackPaused(false);
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
      const temporarilyFrozen = document.hidden || state.preferences.hidden || state.avoidanceHidden;
      // 智能避让和浏览器后台只冻结现有 WebGL 实例。suspend() 会销毁 core，恢复时即使
      // 命中 HTTP 缓存也必须重新解析 moc/纹理，造成用户看到重复 loading。
      rendererRef.current?.setPlaybackPaused(temporarilyFrozen || userPaused);
    };
    syncRendererActivity();
    document.addEventListener('visibilitychange', syncRendererActivity);
    return () => document.removeEventListener('visibilitychange', syncRendererActivity);
  }, [state.avoidanceHidden, state.preferences.hidden, userPaused]);

  useEffect(() => {
    if (!state.preferences.audioEnabled) stopTransientInteraction();
  }, [state.preferences.audioEnabled, stopTransientInteraction]);

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
    (phase: Live2DRendererPhase, error?: unknown) => {
      if (phase === 'recoverable' && import.meta.env.DEV) {
        console.error('[Live2D] Renderer entered a recoverable state.', error);
      }
      if (phase === 'recoverable') stopTransientInteraction();
      if (phase === 'loading' || phase === 'ready' || phase === 'recoverable' || phase === 'dormant') {
        live2dActions.setRendererStatus(phase);
      }
      if (phase === 'ready') {
        rendererRef.current?.setEffects(effectsRef.current);
        setModelControls({
          motions: rendererRef.current?.getMotions() ?? {},
          expressions: rendererRef.current?.getExpressions() ?? [],
        });
        const rememberedMotion = selectedMotionRef.current;
        if (selectedExpressionRef.current) rendererRef.current?.setExpression(selectedExpressionRef.current);
        if (rememberedMotion) {
          rendererRef.current?.playMotion(rememberedMotion.group, rememberedMotion.index, rememberedMotion.priority);
        }
      }
    },
    [stopTransientInteraction],
  );

  const interact = useCallback(
    (area = 'head') => {
      if (!costume || state.rendererStatus !== 'ready' || userPaused) return;
      const resolved = resolveLive2DPlayback(
        {
          mappingInteractions: costume.interactions,
          mappingReleaseId: costume.releaseId,
          dialogueSource:
            activeVoiceIndex && characterVoice
              ? { interactions: activeVoiceIndex.interactions, releaseId: characterVoice.releaseId }
              : undefined,
          suppressMappingAudio: Boolean(characterVoice && !activeVoiceIndex),
        },
        area,
        Math.random,
      );
      if (!resolved) return;
      const { mapping, line, audio: interactionAudio } = resolved;
      const generation = interactionGeneration.current.next();
      if (dialogueTimerRef.current !== null) window.clearTimeout(dialogueTimerRef.current);
      const clearDialogue = () => {
        if (dialogueTimerRef.current !== null) window.clearTimeout(dialogueTimerRef.current);
        dialogueTimerRef.current = null;
        if (interactionGeneration.current.isCurrent(generation)) setDialogue('');
      };
      const scheduleDialogueClear = (delay: number) => {
        if (dialogueTimerRef.current !== null) window.clearTimeout(dialogueTimerRef.current);
        dialogueTimerRef.current = window.setTimeout(clearDialogue, delay);
      };
      if (mapping.expression) {
        selectedExpressionRef.current = mapping.expression;
        setSelectedExpression(mapping.expression);
        rendererRef.current?.setExpression(mapping.expression);
      }
      if (mapping.motionGroup) {
        const index = mapping.motionIndex ?? 0;
        selectedMotionRef.current = {
          group: mapping.motionGroup,
          index,
          priority: USER_SELECTED_MOTION_PRIORITY,
        };
        setSelectedMotion(`${mapping.motionGroup}\u0000${index}`);
        rendererRef.current?.playMotion(mapping.motionGroup, mapping.motionIndex, USER_SELECTED_MOTION_PRIORITY);
      }
      setDialogue(line);

      stopAudio();
      if (!state.preferences.audioEnabled || !interactionAudio) {
        scheduleDialogueClear(textDialogueDuration(line));
        return;
      }
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      const finishAudio = (clearImmediately: boolean) => {
        if (interactionGeneration.current.isCurrent(generation)) {
          setAudioStatus('none');
          releaseActivePlayer(LIVE2D_PLAYER_ID);
          if (clearImmediately) clearDialogue();
          else scheduleDialogueClear(textDialogueDuration(line));
        }
      };
      audio.onended = () => finishAudio(true);
      audio.onerror = () => finishAudio(false);
      audio.src = `/api/live2d-assets/releases/${interactionAudio.releaseId}/${interactionAudio.path
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')}`;
      claimActivePlayer(LIVE2D_PLAYER_ID);
      setAudioStatus('loading');
      dialogueTimerRef.current = window.setTimeout(() => {
        if (interactionGeneration.current.isCurrent(generation)) {
          clearDialogue();
          interactionGeneration.current.invalidate();
          stopAudio();
        }
      }, AUDIO_START_TIMEOUT_MS);
      void audio
        .play()
        .then(() => {
          if (interactionGeneration.current.isCurrent(generation)) {
            if (dialogueTimerRef.current !== null) window.clearTimeout(dialogueTimerRef.current);
            dialogueTimerRef.current = null;
            setAudioStatus('playing');
          }
        })
        .catch(() => finishAudio(false));
    },
    [activeVoiceIndex, characterVoice, costume, state.preferences.audioEnabled, state.rendererStatus, stopAudio, userPaused],
  );
  const keepRenderer = useCallback((renderer: Live2DRenderer | null) => {
    rendererRef.current = renderer;
    if (!renderer) setModelControls({ motions: {}, expressions: [] });
  }, []);

  const togglePause = useCallback(() => {
    const next = !userPaused;
    rendererRef.current?.setPlaybackPaused(next);
    setUserPaused(next);
  }, [userPaused]);

  const downloadScreenshot = useCallback(() => {
    const frame = rendererRef.current?.captureFrame();
    if (!frame) return;
    const anchor = document.createElement('a');
    anchor.href = frame;
    anchor.download = `${state.preferences.selection.characterId}-${state.preferences.selection.costumeId}.png`;
    anchor.click();
  }, [state.preferences.selection.characterId, state.preferences.selection.costumeId]);

  const selectMotion = useCallback((group: string, index: number) => {
    selectedMotionRef.current = {
      group,
      index,
      priority: USER_SELECTED_MOTION_PRIORITY,
    };
    setSelectedMotion(`${group}\u0000${index}`);
    rendererRef.current?.playMotion(group, index, USER_SELECTED_MOTION_PRIORITY);
  }, []);

  const resetMotion = useCallback(() => {
    selectedMotionRef.current = null;
    setSelectedMotion('');
    rendererRef.current?.resetMotion();
  }, []);

  const selectExpression = useCallback((expression?: string) => {
    const next = expression ?? '';
    selectedExpressionRef.current = next;
    setSelectedExpression(next);
    if (expression) rendererRef.current?.setExpression(expression);
    else rendererRef.current?.resetExpression();
  }, []);

  useEffect(() => {
    effectsRef.current = state.preferences.effects;
    rendererRef.current?.setEffects(state.preferences.effects);
  }, [state.preferences.effects]);

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
    pointerStart.current = {
      pointer: { x: event.clientX, y: event.clientY },
      widget: point,
    };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!pointerStart.current) return;
    setDragOffset({
      x: event.clientX - pointerStart.current.pointer.x,
      y: event.clientY - pointerStart.current.pointer.y,
    });
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
    randomMotion: t('live2d.randomMotion'),
    defaultMotion: t('live2d.defaultMotion'),
    expression: t('live2d.expression'),
    defaultExpression: t('live2d.defaultExpression'),
    randomExpression: t('live2d.randomExpression'),
    unavailable: t('live2d.unavailable'),
    automaticEffects: t('live2d.automaticEffects'),
    sway: t('live2d.sway'),
    breathe: t('live2d.breathe'),
    blink: t('live2d.blink'),
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
        {dialogue && (
          <output className="live2d-dialogue">
            {audioStatus !== 'none' && (
              <Icon
                className={audioStatus === 'loading' ? 'live2d-dialogue-audio is-loading' : 'live2d-dialogue-audio'}
                icon={audioStatus === 'loading' ? 'ri:loader-4-line' : 'ri:volume-up-line'}
                aria-label={audioStatus === 'loading' ? t('live2d.voiceLoading') : t('live2d.voicePlaying')}
              />
            )}
            <span>{dialogue}</span>
          </output>
        )}
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
          catalog={catalog}
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
          effects={state.preferences.effects}
          onPlayMotion={selectMotion}
          onResetMotion={resetMotion}
          onExpression={selectExpression}
          onPause={togglePause}
          onEffect={live2dActions.setEffect}
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
