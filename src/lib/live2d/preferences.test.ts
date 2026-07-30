import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_LIVE2D_PREFERENCES,
  LIVE2D_PREFERENCES_STORAGE_KEY,
  type Live2DPreferenceDiagnostic,
  loadLive2DPreferences,
  parseLive2DPreferences,
  reconcileLive2DSelection,
  saveLive2DPreferences,
} from './preferences';

describe('Live2D preferences', () => {
  it('migrates legacy records and validates current records field by field', () => {
    assert.deepEqual(
      parseLive2DPreferences({
        version: 0,
        characterId: 'tomori',
        costumeId: '036-live-sr-01',
        position: { x: 840, y: 320 },
        hidden: true,
        audioEnabled: true,
        pointerTrackingEnabled: true,
        displayPolicy: 'always-visible',
      }),
      {
        version: 1,
        selection: { characterId: 'tomori', costumeId: '036-live-sr-01' },
        placement: { kind: 'detached', x: 840, y: 320 },
        hidden: true,
        audioEnabled: true,
        pointerTrackingEnabled: true,
        displayPolicy: 'always-visible',
        effects: { sway: true, breathe: true, blink: true },
      },
    );

    const partial = parseLive2DPreferences({
      version: 1,
      selection: { characterId: 'tomori', costumeId: '' },
      placement: { kind: 'detached', x: Number.NaN, y: 10 },
      hidden: 'yes',
      audioEnabled: true,
      displayPolicy: 'unknown',
    });
    assert.deepEqual(partial.selection, { characterId: 'tomori', costumeId: 'default' });
    assert.deepEqual(partial.placement, { kind: 'preset', preset: 'bottom-left' });
    assert.equal(partial.hidden, false);
    assert.equal(partial.audioEnabled, true);
    assert.equal(partial.pointerTrackingEnabled, true);
    assert.equal(partial.displayPolicy, 'smart');
    assert.deepEqual(partial.effects, { sway: true, breathe: true, blink: true });

    const customized = parseLive2DPreferences({
      ...DEFAULT_LIVE2D_PREFERENCES,
      effects: { sway: false, breathe: true, blink: false },
    });
    assert.deepEqual(customized.effects, { sway: false, breathe: true, blink: false });

    const migratedOldDefault = parseLive2DPreferences({
      version: 1,
      audioEnabled: false,
    });
    assert.equal(migratedOldDefault.audioEnabled, true);

    const explicitCurrentChoice = parseLive2DPreferences({
      ...DEFAULT_LIVE2D_PREFERENCES,
      audioEnabled: false,
      pointerTrackingEnabled: true,
    });
    assert.equal(explicitCurrentChoice.audioEnabled, false);
  });

  it('falls back safely for corrupt and unknown-version data', () => {
    assert.deepEqual(parseLive2DPreferences('{broken'), DEFAULT_LIVE2D_PREFERENCES);
    assert.deepEqual(parseLive2DPreferences({ version: 99, hidden: true }), DEFAULT_LIVE2D_PREFERENCES);
  });

  it('loads and saves one versioned storage record', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const preferences = { ...parseLive2DPreferences(DEFAULT_LIVE2D_PREFERENCES), hidden: true };

    assert.equal(saveLive2DPreferences(storage, preferences), true);
    assert.equal(values.size, 1);
    assert.ok(values.has(LIVE2D_PREFERENCES_STORAGE_KEY));
    assert.deepEqual(loadLive2DPreferences(storage), preferences);
  });

  it('contains unavailable storage and reports non-fatal diagnostics', () => {
    const diagnostics: Live2DPreferenceDiagnostic[] = [];
    const storage = {
      getItem: () => {
        throw new Error('blocked read');
      },
      setItem: () => {
        throw new Error('quota exceeded');
      },
    };

    assert.deepEqual(
      loadLive2DPreferences(storage, DEFAULT_LIVE2D_PREFERENCES, (item) => diagnostics.push(item)),
      {
        ...DEFAULT_LIVE2D_PREFERENCES,
        selection: { ...DEFAULT_LIVE2D_PREFERENCES.selection },
        placement: { ...DEFAULT_LIVE2D_PREFERENCES.placement },
      },
    );
    assert.equal(
      saveLive2DPreferences(storage, parseLive2DPreferences(DEFAULT_LIVE2D_PREFERENCES), (item) => diagnostics.push(item)),
      false,
    );
    assert.deepEqual(
      diagnostics.map((item) => item.operation),
      ['read', 'write'],
    );
  });

  it('reconciles a stale costume without resetting other preferences', () => {
    const preferences = parseLive2DPreferences({
      version: 1,
      selection: { characterId: 'chihaya-anon', costumeId: 'removed-costume' },
      placement: { kind: 'detached', x: 620, y: 140 },
      hidden: true,
      audioEnabled: true,
      pointerTrackingEnabled: false,
      displayPolicy: 'always-visible',
    });
    const reconciled = reconcileLive2DSelection(
      preferences,
      [
        { characterId: 'chihaya-anon', costumeId: 'removed-costume', enabled: false },
        { characterId: 'chihaya-anon', costumeId: 'default' },
      ],
      { characterId: 'chihaya-anon', costumeId: 'default' },
    );

    assert.deepEqual(reconciled.selection, { characterId: 'chihaya-anon', costumeId: 'default' });
    assert.equal(reconciled.pointerTrackingEnabled, false);
    assert.deepEqual({ ...reconciled, selection: preferences.selection }, preferences);
  });
});
