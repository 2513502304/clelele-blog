/** One allowlist supplies first-paint restoration, live controls, and runtime validation. */
export const SCENERY_RULES = {
  imageOpacity: { default: 100, min: 0, max: 100, step: 1 },
  mask: { default: 30, min: 0, max: 85, step: 1 },
  maskStyle: { default: 'vignette', values: ['uniform', 'gradient', 'vignette', 'top', 'bottom', 'spotlight', 'mist'] },
  tone: { default: 'warm', values: ['neutral', 'warm', 'cool'] },
  brightness: { default: 100, min: 60, max: 140, step: 1 },
  contrast: { default: 100, min: 60, max: 140, step: 1 },
  saturation: { default: 100, min: 0, max: 180, step: 1 },
  blur: { default: 0, min: 0, max: 8, step: 0.5 },
  focusX: { default: 50, min: 0, max: 100, step: 1 },
  focusY: { default: 50, min: 0, max: 100, step: 1 },
  edge: { default: 'wave', values: ['wave', 'fade', 'straight', 'arc', 'diagonal', 'layered', 'mist'] },
  ambientLight: { default: 'off', values: ['off', 'halo', 'wash'] },
  lightOpacity: { default: 85, min: 0, max: 100, step: 1 },
  lightBlur: { default: 35, min: 0, max: 100, step: 1 },
  lightSpread: { default: 55, min: 0, max: 200, step: 1 },
  lightBrightness: { default: 100, min: 40, max: 160, step: 1 },
  lightContrast: { default: 100, min: 50, max: 150, step: 1 },
  lightSaturation: { default: 100, min: 0, max: 200, step: 1 },
  lightThemeBlend: { default: 10, min: 0, max: 70, step: 1 },
  lightFeather: { default: 30, min: 0, max: 100, step: 1 },
  lightDirection: { default: 'all', values: ['all', 'sides', 'top', 'bottom'] },
  lightSurface: { default: 35, min: 0, max: 100, step: 1 },
  lightTextShadow: { default: 20, min: 0, max: 100, step: 1 },
  textOpacity: { default: 70, min: 0, max: 100, step: 1 },
  textSize: { default: 100, min: 70, max: 140, step: 1 },
  textWeight: { default: '700', values: ['400', '500', '600', '700', '800'] },
  textSpacing: { default: 5, min: 0, max: 12, step: 1 },
  textShadow: { default: 30, min: 0, max: 100, step: 1 },
  textColor: { default: 'theme', values: ['white', 'ink', 'theme'] },
  textFont: { default: 'theme', values: ['theme', 'round', 'serif'] },
  effect: { default: 'sakura', values: ['none', 'sakura', 'snow', 'rain', 'fireflies', 'stars', 'leaves', 'bokeh', 'aurora'] },
  density: { default: 100, min: 10, max: 100, step: 1 },
  speed: { default: 60, min: 10, max: 100, step: 1 },
  effectOpacity: { default: 60, min: 10, max: 100, step: 1 },
} as const;
export type SceneryPreferences = {
  [K in keyof typeof SCENERY_RULES]: (typeof SCENERY_RULES)[K] extends { values: readonly (infer V)[] } ? V : number;
};
declare global {
  interface Window {
    __sceneryPreferences?: SceneryPreferences;
  }
}
/** Reject corrupt storage, nonfinite numbers and injected CSS before applying preferences. */
export function normalizeSceneryPreferences(input: unknown): SceneryPreferences {
  const values = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return Object.fromEntries(
    Object.entries(SCENERY_RULES).map(([key, rule]) => {
      const raw = values[key];
      return [
        key,
        'min' in rule
          ? typeof raw === 'number' && Number.isFinite(raw)
            ? Number((Math.round(Math.max(rule.min, Math.min(rule.max, raw)) / rule.step) * rule.step).toFixed(2))
            : rule.default
          : (rule.values as readonly unknown[]).includes(raw)
            ? raw
            : rule.default,
      ];
    }),
  ) as SceneryPreferences;
}
export const DEFAULT_SCENERY = normalizeSceneryPreferences({});
/** The in-memory value also survives Astro navigation when browser storage is unavailable. */
export function getSceneryPreferences(): SceneryPreferences {
  return normalizeSceneryPreferences(window.__sceneryPreferences);
}
/** Change only banner CSS and the decorative renderer; never rewrite or re-encode image assets. */
export function setSceneryPreferences(input: SceneryPreferences) {
  const values = normalizeSceneryPreferences(input);
  window.__sceneryPreferences = values;
  for (const [key, value] of Object.entries(values)) {
    const name = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    if (typeof value === 'number') document.documentElement.style.setProperty(`--scene-${name}`, String(value));
    else document.documentElement.setAttribute(`data-scene-${name}`, value);
  }
  document.documentElement.toggleAttribute('data-scene-text-hidden', values.textOpacity === 0);
  try {
    localStorage.setItem('appearance-scenery', JSON.stringify(values));
  } catch {
    /* Session-only fallback. */
  }
  window.dispatchEvent(new Event('scenery-change'));
}
