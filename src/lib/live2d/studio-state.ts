export interface Live2DParameter {
  id: string;
  value: number;
  min: number;
  max: number;
  default: number;
}
// Small static color recipes: no second renderer, shader passes or animation loops.
export const STUDIO_FILTERS = {
  original: {},
  soft: { saturate: 0.82, contrast: 0.94, brightness: 1.07 },
  film: { sepia: 0.25, saturate: 0.85, contrast: 1.08 },
  mono: { grayscale: 1, contrast: 1.1 },
  vivid: { saturate: 1.3, contrast: 1.06 },
  night: { sepia: 0.16, 'hue-rotate': 165, saturate: 0.8, brightness: 0.9 },
  rose: { sepia: 0.18, 'hue-rotate': -45, saturate: 1.15, brightness: 1.05 },
  cool: { sepia: 0.2, 'hue-rotate': 160, saturate: 0.8, contrast: 0.96 },
  warm: { sepia: 0.32, saturate: 1.1, brightness: 1.04 },
} as const;
export type StudioFilter = keyof typeof STUDIO_FILTERS;

/** Interpolate each operation from its neutral value; preview and PNG use this same recipe. */
export function studioFilterCss(filter: StudioFilter, strength = 100): string {
  const amount = Number.isFinite(strength) ? Math.max(0, Math.min(100, strength)) / 100 : 1;
  if (!amount) return 'none';
  return (
    Object.entries(STUDIO_FILTERS[filter])
      .map(([name, target]) => {
        const neutral = ['sepia', 'grayscale', 'hue-rotate'].includes(name) ? 0 : 1;
        const value = Number((neutral + (target - neutral) * amount).toFixed(4));
        return `${name}(${value}${name === 'hue-rotate' ? 'deg' : ''})`;
      })
      .join(' ') || 'none'
  );
}

/** Use the model's own bounds; never persist an arbitrary key into a runtime parameter map. */
export function clampParameterOverrides(
  values: Record<string, unknown>,
  parameters: Live2DParameter[],
): Record<string, number> {
  return Object.fromEntries(
    parameters.flatMap((p) => {
      const value = values[p.id];
      return typeof value === 'number' && Number.isFinite(value) ? [[p.id, Math.max(p.min, Math.min(p.max, value))]] : [];
    }),
  );
}

/** Pose files are local, model-specific edits, not executable scripts or model URLs. */
export function parseStudioPose(text: string, model: string, parameters: Live2DParameter[]): Record<string, number> {
  if (text.length > 100_000) throw new Error('pose-too-large');
  const value = JSON.parse(text);
  if (
    value?.version !== 1 ||
    value.model !== model ||
    !value.parameters ||
    typeof value.parameters !== 'object' ||
    Array.isArray(value.parameters)
  )
    throw new Error('pose-model-mismatch');
  return clampParameterOverrides(value.parameters, parameters);
}
