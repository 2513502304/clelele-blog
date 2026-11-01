export interface StudioViewport {
  zoom: number;
  x: number;
  y: number;
}

export const STUDIO_VIEWPORT_LIMITS = {
  zoom: { min: 50, max: 180 },
  x: { min: -40, max: 40 },
  y: { min: -40, max: 40 },
} as const;

/** Shared bounds for the stage gestures, keyboard shortcuts and range controls. */
export function clampStudioViewport(view: StudioViewport): StudioViewport {
  const clamp = (key: keyof StudioViewport) => {
    const { min, max } = STUDIO_VIEWPORT_LIMITS[key];
    return Math.round(Math.max(min, Math.min(max, view[key])) * 10) / 10;
  };
  return { zoom: clamp('zoom'), x: clamp('x'), y: clamp('y') };
}

/** Keep the point under the cursor stationary, until the shared pan bounds are reached. */
export function zoomStudioViewport(view: StudioViewport, zoom: number, anchor = { x: 0, y: 0 }): StudioViewport {
  const next = clampStudioViewport({ ...view, zoom });
  const ratio = next.zoom / view.zoom;
  return clampStudioViewport({ ...next, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio });
}
