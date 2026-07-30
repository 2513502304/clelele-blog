import {
  isLive2DMobileViewport,
  type Live2DNudgeDirection,
  type Live2DPlacement,
  type Live2DPoint,
  nudgeLive2DPlacement,
  type ResolvedLive2DPlacement,
  type ResolveLive2DPlacementOptions,
  resolveLive2DPlacement,
} from '@lib/live2d/geometry';
import {
  cloneLive2DPreferences,
  DEFAULT_LIVE2D_PREFERENCES,
  type Live2DCatalogSelection,
  type Live2DDisplayPolicy,
  type Live2DEffects,
  type Live2DPreferenceDiagnosticHandler,
  type Live2DPreferenceStorage,
  type Live2DPreferences,
  type Live2DSelection,
  loadLive2DPreferences,
  reconcileLive2DSelection,
  saveLive2DPreferences,
} from '@lib/live2d/preferences';
import { atom, computed } from 'nanostores';

export type Live2DRendererStatus = 'dormant' | 'loading' | 'ready' | 'recoverable';
export type Live2DLoadIntent = 'none' | 'desktop-idle' | 'visitor';
export type Live2DPanel = 'picker' | 'animations' | 'settings' | null;
export type Live2DViewportMode = 'desktop' | 'mobile';

export interface Live2DState {
  preferences: Live2DPreferences;
  renderedPlacement: ResolvedLive2DPlacement | null;
  avoidanceHidden: boolean;
  activePanel: Live2DPanel;
  focusWithin: boolean;
  rendererStatus: Live2DRendererStatus;
  loadIntent: Live2DLoadIntent;
  viewportMode: Live2DViewportMode;
  initialized: boolean;
}

type GeometryContext = Omit<ResolveLive2DPlacementOptions, 'placement'>;

export interface CreateLive2DStoreOptions {
  defaults?: Live2DPreferences;
  storage?: Live2DPreferenceStorage | (() => Live2DPreferenceStorage | undefined);
  onDiagnostic?: Live2DPreferenceDiagnosticHandler;
  initialViewportWidth?: number;
}

function browserStorage(): Live2DPreferenceStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function createLive2DStore(options: CreateLive2DStoreOptions = {}) {
  const defaults = cloneLive2DPreferences(options.defaults ?? DEFAULT_LIVE2D_PREFERENCES);
  const initialViewportMode = isLive2DMobileViewport(options.initialViewportWidth ?? Number.POSITIVE_INFINITY)
    ? 'mobile'
    : 'desktop';
  const $state = atom<Live2DState>({
    preferences: defaults,
    renderedPlacement: null,
    avoidanceHidden: false,
    activePanel: null,
    focusWithin: false,
    rendererStatus: 'dormant',
    loadIntent: 'none',
    viewportMode: initialViewportMode,
    initialized: false,
  });
  const $visible = computed(
    $state,
    (state) => !state.preferences.hidden && !state.avoidanceHidden && state.rendererStatus === 'ready',
  );
  let geometry: GeometryContext | null = null;

  const getStorage = (): Live2DPreferenceStorage | undefined => {
    if (typeof options.storage === 'function') return options.storage();
    return options.storage ?? browserStorage();
  };

  const renderPlacement = (preferences: Live2DPreferences): ResolvedLive2DPlacement | null =>
    geometry ? resolveLive2DPlacement({ ...geometry, placement: preferences.placement }) : null;

  const commitPreferences = (preferences: Live2DPreferences): void => {
    const current = $state.get();
    $state.set({ ...current, preferences, renderedPlacement: renderPlacement(preferences) });
    saveLive2DPreferences(getStorage(), preferences, options.onDiagnostic);
  };

  const updatePreferences = (update: (current: Live2DPreferences) => Live2DPreferences): void => {
    commitPreferences(update(cloneLive2DPreferences($state.get().preferences)));
  };

  const actions = {
    initialize(runtimeDefaults: Partial<Pick<Live2DPreferences, 'selection' | 'audioEnabled' | 'displayPolicy'>> = {}): void {
      const current = $state.get();
      const configuredDefaults: Live2DPreferences = {
        ...defaults,
        ...runtimeDefaults,
        selection: runtimeDefaults.selection ? { ...runtimeDefaults.selection } : { ...defaults.selection },
      };
      const preferences = loadLive2DPreferences(getStorage(), configuredDefaults, options.onDiagnostic);
      $state.set({
        ...current,
        preferences,
        renderedPlacement: renderPlacement(preferences),
        initialized: true,
      });
    },

    setGeometry(nextGeometry: GeometryContext): void {
      geometry = nextGeometry;
      const current = $state.get();
      $state.set({ ...current, renderedPlacement: renderPlacement(current.preferences) });
    },

    clearGeometry(): void {
      geometry = null;
      $state.set({ ...$state.get(), renderedPlacement: null });
    },

    select(selection: Live2DSelection): void {
      updatePreferences((current) => ({ ...current, selection: { ...selection } }));
    },

    reconcileSelection(catalog: readonly Live2DCatalogSelection[], fallback: Live2DSelection): void {
      commitPreferences(reconcileLive2DSelection($state.get().preferences, catalog, fallback));
    },

    setPlacement(placement: Live2DPlacement): void {
      const floatingPlacement = placement.kind === 'sidebar' ? ({ kind: 'preset', preset: 'bottom-left' } as const) : placement;
      updatePreferences((current) => ({ ...current, placement: { ...floatingPlacement } }));
    },

    setPreset(preset: Extract<Live2DPlacement, { kind: 'preset' }>['preset']): void {
      actions.setPlacement({ kind: 'preset', preset });
    },

    moveTo(point: Live2DPoint): void {
      actions.setPlacement({ kind: 'detached', ...point });
    },

    nudge(direction: Live2DNudgeDirection): boolean {
      const position = $state.get().renderedPlacement?.position;
      if (!position) return false;
      actions.setPlacement(nudgeLive2DPlacement(position, direction));
      return true;
    },

    setManualHidden(hidden: boolean): void {
      updatePreferences((current) => ({ ...current, hidden }));
      if (hidden) $state.set({ ...$state.get(), activePanel: null });
    },

    wake(): void {
      actions.setManualHidden(false);
      actions.requestVisitorLoad();
    },

    setAudioEnabled(audioEnabled: boolean): void {
      updatePreferences((current) => ({ ...current, audioEnabled }));
    },

    setPointerTrackingEnabled(pointerTrackingEnabled: boolean): void {
      updatePreferences((current) => ({ ...current, pointerTrackingEnabled }));
    },

    setDisplayPolicy(displayPolicy: Live2DDisplayPolicy): void {
      updatePreferences((current) => ({ ...current, displayPolicy }));
      if (displayPolicy === 'always-visible') $state.set({ ...$state.get(), avoidanceHidden: false });
    },

    setEffect(effect: keyof Live2DEffects, enabled: boolean): void {
      updatePreferences((current) => ({
        ...current,
        effects: { ...current.effects, [effect]: enabled },
      }));
    },

    setAvoidanceHidden(hidden: boolean): void {
      const current = $state.get();
      $state.set({
        ...current,
        avoidanceHidden: current.preferences.displayPolicy === 'smart' ? hidden : false,
      });
    },

    setActivePanel(activePanel: Live2DPanel): void {
      $state.set({ ...$state.get(), activePanel });
    },

    setFocusWithin(focusWithin: boolean): void {
      $state.set({ ...$state.get(), focusWithin });
    },

    setViewportWidth(width: number): void {
      const current = $state.get();
      const viewportMode = isLive2DMobileViewport(width) ? 'mobile' : 'desktop';
      const loadIntent =
        viewportMode === 'mobile' && current.rendererStatus === 'dormant' && current.loadIntent === 'desktop-idle'
          ? 'none'
          : current.loadIntent;
      $state.set({ ...current, viewportMode, loadIntent });
    },

    scheduleDesktopIdleLoad(): boolean {
      const current = $state.get();
      if (current.viewportMode !== 'desktop' || current.rendererStatus !== 'dormant') return false;
      $state.set({ ...current, loadIntent: 'desktop-idle' });
      return true;
    },

    requestVisitorLoad(): void {
      const current = $state.get();
      if (current.rendererStatus === 'dormant' || current.rendererStatus === 'recoverable') {
        $state.set({ ...current, loadIntent: 'visitor' });
      }
    },

    setRendererStatus(rendererStatus: Live2DRendererStatus): void {
      const current = $state.get();
      $state.set({
        ...current,
        rendererStatus,
        loadIntent: rendererStatus === 'loading' || rendererStatus === 'ready' ? 'none' : current.loadIntent,
      });
    },
  };

  return { $state, $visible, actions };
}

const globalLive2DStore = createLive2DStore();

export const $live2dState = globalLive2DStore.$state;
export const $live2dVisible = globalLive2DStore.$visible;
export const live2dActions = globalLive2DStore.actions;
