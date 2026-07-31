import type { Live2DPlacement } from './geometry';

export const LIVE2D_PREFERENCES_VERSION = 1 as const;
export const LIVE2D_PREFERENCES_STORAGE_KEY = 'live2d-preferences';

export type Live2DDisplayPolicy = 'smart' | 'always-visible';

export interface Live2DSelection {
  characterId: string;
  costumeId: string;
}

export interface Live2DEffects {
  sway: boolean;
  breathe: boolean;
  blink: boolean;
}

export interface Live2DPreferences {
  version: typeof LIVE2D_PREFERENCES_VERSION;
  selection: Live2DSelection;
  placement: Live2DPlacement;
  hidden: boolean;
  audioEnabled: boolean;
  pointerTrackingEnabled: boolean;
  displayPolicy: Live2DDisplayPolicy;
  effects: Live2DEffects;
}

export interface Live2DPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface Live2DPreferenceDiagnostic {
  operation: 'read' | 'write';
  error: unknown;
}

export type Live2DPreferenceDiagnosticHandler = (diagnostic: Live2DPreferenceDiagnostic) => void;

export const DEFAULT_LIVE2D_PREFERENCES: Readonly<Live2DPreferences> = Object.freeze({
  version: LIVE2D_PREFERENCES_VERSION,
  selection: Object.freeze({ characterId: 'chihaya-anon', costumeId: 'default' }),
  placement: Object.freeze({ kind: 'preset', preset: 'bottom-left' }),
  hidden: false,
  audioEnabled: true,
  pointerTrackingEnabled: true,
  displayPolicy: 'smart',
  effects: Object.freeze({ sway: true, breathe: true, blink: true }),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function parseSelection(value: unknown, fallback: Live2DSelection): Live2DSelection {
  if (!isRecord(value)) return { ...fallback };
  return {
    characterId: nonEmptyString(value.characterId, fallback.characterId),
    costumeId: nonEmptyString(value.costumeId, fallback.costumeId),
  };
}

function parsePlacement(value: unknown, fallback: Live2DPlacement): Live2DPlacement {
  if (!isRecord(value)) return { ...fallback };

  // The first release stored `sidebar`, which required a real layout spacer. Preserve
  // visitor intent by migrating it to the equivalent floating corner without changing page flow.
  if (value.kind === 'sidebar') return { kind: 'preset', preset: 'bottom-left' };
  if (
    value.kind === 'preset' &&
    (value.preset === 'bottom-left' || value.preset === 'bottom-center' || value.preset === 'bottom-right')
  ) {
    return { kind: 'preset', preset: value.preset };
  }
  if (value.kind === 'detached' && Number.isFinite(value.x) && Number.isFinite(value.y)) {
    return { kind: 'detached', x: value.x as number, y: value.y as number };
  }

  return { ...fallback };
}

function parseEffects(value: unknown, fallback: Live2DEffects): Live2DEffects {
  if (!isRecord(value)) return { ...fallback };
  return {
    sway: typeof value.sway === 'boolean' ? value.sway : fallback.sway,
    breathe: typeof value.breathe === 'boolean' ? value.breathe : fallback.breathe,
    blink: typeof value.blink === 'boolean' ? value.blink : fallback.blink,
  };
}

function parseCurrentRecord(record: Record<string, unknown>, defaults: Live2DPreferences): Live2DPreferences {
  const hasCurrentInteractionPreferences = typeof record.pointerTrackingEnabled === 'boolean';
  return {
    version: LIVE2D_PREFERENCES_VERSION,
    selection: parseSelection(record.selection, defaults.selection),
    placement: parsePlacement(record.placement, defaults.placement),
    hidden: typeof record.hidden === 'boolean' ? record.hidden : defaults.hidden,
    // Older v1 records persisted the former false default during catalog reconciliation, so false
    // did not necessarily represent a visitor choice. The gaze field marks records written by the
    // current settings UI; from that point onward an explicit audio choice is preserved.
    audioEnabled:
      hasCurrentInteractionPreferences && typeof record.audioEnabled === 'boolean'
        ? record.audioEnabled
        : defaults.audioEnabled,
    pointerTrackingEnabled:
      typeof record.pointerTrackingEnabled === 'boolean' ? record.pointerTrackingEnabled : defaults.pointerTrackingEnabled,
    displayPolicy:
      record.displayPolicy === 'smart' || record.displayPolicy === 'always-visible'
        ? record.displayPolicy
        : defaults.displayPolicy,
    effects: parseEffects(record.effects, defaults.effects),
  };
}

/** Migrates the pre-versioned prototype shape without trusting malformed coordinates or flags. */
function migrateLegacyRecord(record: Record<string, unknown>, defaults: Live2DPreferences): Live2DPreferences {
  const position = isRecord(record.position)
    ? { kind: 'detached' as const, x: record.position.x, y: record.position.y }
    : undefined;
  const placement = record.sidebarResident === true ? { kind: 'sidebar' as const } : position;

  return parseCurrentRecord(
    {
      selection: {
        characterId: record.characterId ?? record.selectedCharacterId,
        costumeId: record.costumeId ?? record.selectedCostumeId,
      },
      placement,
      hidden: record.hidden,
      audioEnabled: record.audioEnabled,
      pointerTrackingEnabled: record.pointerTrackingEnabled,
      displayPolicy: record.displayPolicy,
      effects: record.effects,
    },
    defaults,
  );
}

/** Parses current and legacy preference data. Unknown future schemas fail closed to the configured defaults. */
export function parseLive2DPreferences(
  value: unknown,
  defaults: Live2DPreferences = DEFAULT_LIVE2D_PREFERENCES,
): Live2DPreferences {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return cloneLive2DPreferences(defaults);
    }
  }

  if (!isRecord(parsed)) return cloneLive2DPreferences(defaults);
  if (parsed.version === LIVE2D_PREFERENCES_VERSION) return parseCurrentRecord(parsed, defaults);
  if (parsed.version === 0 || parsed.version === undefined) return migrateLegacyRecord(parsed, defaults);
  return cloneLive2DPreferences(defaults);
}

export function cloneLive2DPreferences(preferences: Live2DPreferences): Live2DPreferences {
  return {
    ...preferences,
    selection: { ...preferences.selection },
    placement: { ...preferences.placement },
    effects: { ...preferences.effects },
  };
}

export function loadLive2DPreferences(
  storage: Live2DPreferenceStorage | undefined,
  defaults: Live2DPreferences = DEFAULT_LIVE2D_PREFERENCES,
  onDiagnostic?: Live2DPreferenceDiagnosticHandler,
): Live2DPreferences {
  if (!storage) return cloneLive2DPreferences(defaults);
  try {
    const stored = storage.getItem(LIVE2D_PREFERENCES_STORAGE_KEY);
    return stored === null ? cloneLive2DPreferences(defaults) : parseLive2DPreferences(stored, defaults);
  } catch (error) {
    onDiagnostic?.({ operation: 'read', error });
    return cloneLive2DPreferences(defaults);
  }
}

/** Returns false on unavailable storage while leaving the caller's in-memory state untouched. */
export function saveLive2DPreferences(
  storage: Live2DPreferenceStorage | undefined,
  preferences: Live2DPreferences,
  onDiagnostic?: Live2DPreferenceDiagnosticHandler,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(LIVE2D_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    return true;
  } catch (error) {
    onDiagnostic?.({ operation: 'write', error });
    return false;
  }
}

export interface Live2DCatalogSelection {
  characterId: string;
  costumeId: string;
  enabled?: boolean;
}

/** Replaces only a stale selection, preserving every unrelated visitor preference. */
export function reconcileLive2DSelection(
  preferences: Live2DPreferences,
  catalog: readonly Live2DCatalogSelection[],
  fallback: Live2DSelection,
): Live2DPreferences {
  const selected = catalog.some(
    (entry) =>
      entry.enabled !== false &&
      entry.characterId === preferences.selection.characterId &&
      entry.costumeId === preferences.selection.costumeId,
  );
  if (selected) return cloneLive2DPreferences(preferences);

  const configuredFallback = catalog.find(
    (entry) => entry.enabled !== false && entry.characterId === fallback.characterId && entry.costumeId === fallback.costumeId,
  );
  const firstAvailable = catalog.find((entry) => entry.enabled !== false);
  const replacement = configuredFallback ?? firstAvailable;
  if (!replacement) return cloneLive2DPreferences(preferences);

  return {
    ...cloneLive2DPreferences(preferences),
    selection: { characterId: replacement.characterId, costumeId: replacement.costumeId },
  };
}
