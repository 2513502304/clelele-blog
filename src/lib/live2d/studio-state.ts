export interface Live2DParameter {
  id: string;
  value: number;
  min: number;
  max: number;
  default: number;
}
export const STUDIO_FILTERS = {
  original: 'none',
  soft: 'saturate(0.82) contrast(0.94) brightness(1.07)',
  film: 'sepia(0.25) saturate(0.85) contrast(1.08)',
  mono: 'grayscale(1) contrast(1.1)',
  vivid: 'saturate(1.3) contrast(1.06)',
  night: 'sepia(0.16) hue-rotate(165deg) saturate(0.8) brightness(0.9)',
} as const;
export type StudioFilter = keyof typeof STUDIO_FILTERS;

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
