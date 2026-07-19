/** 平台数组是标签、筛选和分组排序的唯一顺序来源。 */
export const STYLE_GALLERY_PLATFORMS = [
  { label: 'GPT-Image2', slug: 'gpt-image2' },
  { label: 'Nano Banana', slug: 'nano-banana' },
  { label: 'PixAI', slug: 'pixai' },
  { label: 'Midjourney', slug: 'midjourney' },
  { label: 'Flux', slug: 'flux' },
] as const;

export type StyleGalleryPlatform = (typeof STYLE_GALLERY_PLATFORMS)[number];

/** 同时接受稳定 slug 和展示名称，便于 API 与历史元数据互操作。 */
export function getStyleGalleryPlatform(value: string): StyleGalleryPlatform | undefined {
  const normalized = value.toLowerCase().trim().replace(/\s+/g, '-');
  return STYLE_GALLERY_PLATFORMS.find(
    (platform) => platform.slug === normalized || platform.label.toLowerCase() === value.toLowerCase().trim(),
  );
}

export function compareStyleGalleryPlatform(a: string, b: string): number {
  const indexA = STYLE_GALLERY_PLATFORMS.findIndex((platform) => platform.label === a);
  const indexB = STYLE_GALLERY_PLATFORMS.findIndex((platform) => platform.label === b);
  if (indexA === -1 && indexB === -1) return a.localeCompare(b);
  if (indexA === -1) return 1;
  if (indexB === -1) return -1;
  return indexA - indexB;
}
