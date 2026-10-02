/** Shared validation rules for the pre-paint bootstrap and the hydrated controls. No external font requests. */
export const READING_RULES = {
  fontSize: { default: 100, min: 85, max: 130, step: 1, css: '--reading-size', unit: '%' },
  lineHeight: { default: 1.8, min: 1.4, max: 2.2, step: 0.1, css: '--reading-leading', unit: '' },
  font: { default: 'theme', values: ['theme', 'sans', 'serif', 'mono'] },
  density: { default: 'normal', values: ['compact', 'normal', 'spacious'] },
  corners: { default: 'rounded', values: ['square', 'rounded', 'soft'] },
  transparency: { default: 'glass', values: ['glass', 'solid'] },
  motion: { default: 'full', values: ['full', 'reduced'] },
} as const;
export interface ReadingPreferences {
  fontSize: number;
  lineHeight: number;
  font: 'theme' | 'sans' | 'serif' | 'mono';
  density: 'compact' | 'normal' | 'spacious';
  corners: 'square' | 'rounded' | 'soft';
  transparency: 'glass' | 'solid';
  motion: 'full' | 'reduced';
}
/** Accept stored data only through the shared finite-number bounds and enum allowlists. */
export function normalizeReadingPreferences(input: unknown): ReadingPreferences {
  const value = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return Object.fromEntries(
    Object.entries(READING_RULES).map(([key, rule]) => {
      const raw = value[key];
      if ('min' in rule)
        return [
          key,
          typeof raw === 'number' && Number.isFinite(raw)
            ? Number((Math.round(Math.max(rule.min, Math.min(rule.max, raw)) / rule.step) * rule.step).toFixed(1))
            : rule.default,
        ];
      return [key, (rule.values as readonly unknown[]).includes(raw) ? raw : rule.default];
    }),
  ) as unknown as ReadingPreferences;
}
export const DEFAULT_READING = normalizeReadingPreferences({});
/** Read live DOM values so storage-disabled sessions and independently mounted controls stay in sync. */
export function getReadingPreferences(): ReadingPreferences {
  const data = document.documentElement.dataset;
  return normalizeReadingPreferences(
    Object.fromEntries(
      Object.entries(READING_RULES).map(([key, rule]) => {
        const value = data[`reading${key[0].toUpperCase()}${key.slice(1)}`];
        return [key, 'min' in rule && value !== undefined ? Number(value) : value];
      }),
    ),
  );
}
/** Apply immediately, persist when available, and notify layout consumers without replaying a palette change. */
export function setReadingPreferences(input: ReadingPreferences) {
  const values = normalizeReadingPreferences(input);
  for (const [key, rule] of Object.entries(READING_RULES)) {
    const value = values[key as keyof ReadingPreferences];
    document.documentElement.dataset[`reading${key[0].toUpperCase()}${key.slice(1)}`] = String(value);
    if ('css' in rule) document.documentElement.style.setProperty(rule.css, `${value}${rule.unit}`);
  }
  try {
    localStorage.setItem('appearance-reading', JSON.stringify({ ...values, scaleVersion: 2 }));
  } catch {
    /* Private storage may be unavailable. */
  }
  window.dispatchEvent(new Event('reading-change'));
}
