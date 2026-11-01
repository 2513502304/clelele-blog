/**
 * Native exports carry only the full-size texture. Bilinear minification aliases their fine lines.
 * Request GPU mip generation once at upload and trilinear sampling; original PNGs stay untouched.
 * Square atlases add about one third in texture storage without increasing canvas pixels or frame rate.
 */
export function enableNativeMipmaps(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const object = value as Record<string, unknown>;
  const settings = object.settings as Record<string, unknown> | undefined;
  if (
    typeof object.texture === 'string' &&
    object.mipCount === 1 &&
    typeof object.width === 'number' &&
    typeof object.height === 'number' &&
    Number.isInteger(object.width) &&
    Number.isInteger(object.height) &&
    object.width > 0 &&
    object.height > 0 &&
    settings?.m_FilterMode === 1
  ) {
    object.mipCount = 1 + Math.floor(Math.log2(Math.max(object.width, object.height)));
    settings.m_FilterMode = 2;
  }
  for (const child of Object.values(object)) enableNativeMipmaps(child);
}
