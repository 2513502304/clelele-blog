import type { SiteAssetSlot } from './schema';

/** Shared with the actual cover layout: crop previews use the same viewport-height ceiling. */
export const COVER_MAX_HEIGHT = 800;
export const COVER_VIEWPORT_HEIGHT = 0.6;
export const SERIES_VIEWPORT_HEIGHT = 0.7;
export const AVATAR_DISPLAY_SIZE = 160;
export function profileFrameRatio(slot: SiteAssetSlot, width: number, height: number): number {
  if (slot === 'avatar') return 1;
  return width / Math.min(COVER_MAX_HEIGHT, height * (slot === 'weekly' ? SERIES_VIEWPORT_HEIGHT : COVER_VIEWPORT_HEIGHT));
}
export type CropPosition = { zoom: number; x: number; y: number };
/** Normalized pan survives stage resizing. Bounds guarantee no transparent strips at any zoom. */
export function cropRectangle(width: number, height: number, ratio: number, position: CropPosition) {
  const zoom = Math.max(1, Math.min(4, position.zoom));
  const cropWidth = Math.min(width, height * ratio) / zoom;
  const cropHeight = cropWidth / ratio;
  const clamp = (value: number) => Math.max(-1, Math.min(1, value));
  return {
    x: ((width - cropWidth) * (clamp(position.x) + 1)) / 2,
    y: ((height - cropHeight) * (clamp(position.y) + 1)) / 2,
    width: cropWidth,
    height: cropHeight,
  };
}
