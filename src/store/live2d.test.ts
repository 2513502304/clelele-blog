import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_LIVE2D_PREFERENCES,
  LIVE2D_PREFERENCES_STORAGE_KEY,
  type Live2DPreferenceDiagnostic,
} from '@lib/live2d/preferences';
import { createLive2DStore } from './live2d';

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial) values.set(LIVE2D_PREFERENCES_STORAGE_KEY, initial);
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe('Live2D store', () => {
  it('hydrates persistent preferences while keeping UI state transient', () => {
    const storage = memoryStorage(
      JSON.stringify({
        version: 1,
        selection: { characterId: 'tomori', costumeId: '036-live-default' },
        placement: { kind: 'detached', x: 700, y: 220 },
        hidden: false,
        audioEnabled: true,
        displayPolicy: 'smart',
      }),
    );
    const store = createLive2DStore({ storage });
    store.actions.initialize();
    store.actions.setRendererStatus('ready');
    store.actions.setAvoidanceHidden(true);
    store.actions.setActivePanel('settings');
    store.actions.setFocusWithin(true);

    assert.equal(store.$visible.get(), false);
    assert.equal(store.$state.get().preferences.hidden, false);
    assert.equal(store.$state.get().avoidanceHidden, true);
    const persistedValue = storage.values.get(LIVE2D_PREFERENCES_STORAGE_KEY);
    assert.ok(persistedValue);
    const persisted = JSON.parse(persistedValue);
    assert.equal(persisted.hidden, false);
    assert.equal('avoidanceHidden' in persisted, false);
    assert.equal('activePanel' in persisted, false);

    store.actions.setAvoidanceHidden(false);
    assert.equal(store.$visible.get(), true);
  });

  it('uses site defaults only when no visitor preference has been stored', () => {
    const emptyStorage = memoryStorage();
    const empty = createLive2DStore({ storage: emptyStorage });
    empty.actions.initialize({
      selection: { characterId: 'tomori', costumeId: 'live-sr-01' },
      audioEnabled: true,
      displayPolicy: 'always-visible',
    });
    assert.deepEqual(empty.$state.get().preferences.selection, { characterId: 'tomori', costumeId: 'live-sr-01' });
    assert.equal(empty.$state.get().preferences.audioEnabled, true);
    assert.equal(empty.$state.get().preferences.displayPolicy, 'always-visible');

    const stored = memoryStorage(JSON.stringify(DEFAULT_LIVE2D_PREFERENCES));
    const returning = createLive2DStore({ storage: stored });
    returning.actions.initialize({ audioEnabled: true, displayPolicy: 'always-visible' });
    assert.equal(returning.$state.get().preferences.audioEnabled, false);
    assert.equal(returning.$state.get().preferences.displayPolicy, 'smart');
  });

  it('manual hide survives modal avoidance and wake preserves every other preference', () => {
    const storage = memoryStorage();
    const store = createLive2DStore({ storage });
    store.actions.initialize();
    store.actions.select({ characterId: 'tomori', costumeId: '036-live-sr-01' });
    store.actions.setAudioEnabled(true);
    store.actions.setDisplayPolicy('smart');
    store.actions.moveTo({ x: 540, y: 180 });
    store.actions.setManualHidden(true);
    store.actions.setAvoidanceHidden(true);
    store.actions.setAvoidanceHidden(false);

    assert.equal(store.$state.get().preferences.hidden, true);
    store.actions.wake();
    assert.deepEqual(store.$state.get().preferences, {
      version: 1,
      selection: { characterId: 'tomori', costumeId: '036-live-sr-01' },
      placement: { kind: 'detached', x: 540, y: 180 },
      hidden: false,
      audioEnabled: true,
      displayPolicy: 'smart',
      effects: { sway: true, breathe: true, blink: true },
    });
    assert.equal(store.$state.get().loadIntent, 'visitor');
  });

  it('wake requests a recoverable renderer load', () => {
    const store = createLive2DStore({ storage: memoryStorage() });
    store.actions.initialize();
    store.actions.setManualHidden(true);
    store.actions.setRendererStatus('recoverable');

    store.actions.wake();

    assert.equal(store.$state.get().preferences.hidden, false);
    assert.equal(store.$state.get().loadIntent, 'visitor');
  });

  it('preserves current-session actions after storage write failure', () => {
    const diagnostics: Live2DPreferenceDiagnostic[] = [];
    const store = createLive2DStore({
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota exceeded');
        },
      },
      onDiagnostic: (item) => diagnostics.push(item),
    });
    store.actions.initialize();
    store.actions.setAudioEnabled(true);

    assert.equal(store.$state.get().preferences.audioEnabled, true);
    assert.deepEqual(
      diagnostics.map((item) => item.operation),
      ['write'],
    );
  });

  it('keeps saved coordinates while geometry clamps and later restores the render point', () => {
    const store = createLive2DStore({ storage: memoryStorage() });
    store.actions.initialize();
    store.actions.moveTo({ x: 900, y: 300 });
    store.actions.setGeometry({ viewport: { width: 760, height: 600 }, widget: { width: 180, height: 260 } });

    assert.deepEqual(store.$state.get().preferences.placement, { kind: 'detached', x: 900, y: 300 });
    assert.deepEqual(store.$state.get().renderedPlacement?.position, { x: 564, y: 300 });

    store.actions.setGeometry({ viewport: { width: 1280, height: 720 }, widget: { width: 180, height: 260 } });
    assert.deepEqual(store.$state.get().renderedPlacement?.position, { x: 900, y: 300 });
  });

  it('uses validated geometry for presets and nudge actions', () => {
    const store = createLive2DStore({ storage: memoryStorage() });
    store.actions.initialize();
    store.actions.setGeometry({ viewport: { width: 800, height: 640 }, widget: { width: 180, height: 260 } });
    store.actions.setPreset('bottom-right');
    assert.deepEqual(store.$state.get().renderedPlacement?.position, { x: 604, y: 364 });

    assert.equal(store.actions.nudge('right'), true);
    assert.deepEqual(store.$state.get().preferences.placement, { kind: 'detached', x: 620, y: 364 });
    assert.deepEqual(store.$state.get().renderedPlacement?.position, { x: 604, y: 364 });
  });

  it('reconciles removed catalog selections without replacing unrelated state', () => {
    const store = createLive2DStore({ storage: memoryStorage() });
    store.actions.initialize();
    store.actions.select({ characterId: 'chihaya-anon', costumeId: 'removed' });
    store.actions.moveTo({ x: 400, y: 120 });
    store.actions.setAudioEnabled(true);
    store.actions.reconcileSelection(
      [
        { characterId: 'chihaya-anon', costumeId: 'removed', enabled: false },
        { characterId: 'chihaya-anon', costumeId: 'default' },
      ],
      { characterId: 'chihaya-anon', costumeId: 'default' },
    );

    assert.deepEqual(store.$state.get().preferences, {
      version: 1,
      selection: { characterId: 'chihaya-anon', costumeId: 'default' },
      placement: { kind: 'detached', x: 400, y: 120 },
      hidden: false,
      audioEnabled: true,
      displayPolicy: 'smart',
      effects: { sway: true, breathe: true, blink: true },
    });
  });

  it('cancels only unstarted desktop idle work at the mobile breakpoint', () => {
    const dormant = createLive2DStore({ storage: memoryStorage(), initialViewportWidth: 1024 });
    dormant.actions.initialize();
    assert.equal(dormant.actions.scheduleDesktopIdleLoad(), true);
    dormant.actions.setViewportWidth(768);
    assert.equal(dormant.$state.get().loadIntent, 'none');
    assert.equal(dormant.$state.get().rendererStatus, 'dormant');
    assert.equal(dormant.actions.scheduleDesktopIdleLoad(), false);

    const visible = createLive2DStore({ storage: memoryStorage(), initialViewportWidth: 1024 });
    visible.actions.initialize();
    visible.actions.setRendererStatus('ready');
    visible.actions.setViewportWidth(768);
    assert.equal(visible.$state.get().rendererStatus, 'ready');
    assert.equal(visible.$state.get().loadIntent, 'none');
  });

  it('always-visible policy refuses temporary smart avoidance', () => {
    const store = createLive2DStore({ storage: memoryStorage() });
    store.actions.initialize();
    store.actions.setDisplayPolicy('always-visible');
    store.actions.setAvoidanceHidden(true);
    assert.equal(store.$state.get().avoidanceHidden, false);
  });
});
