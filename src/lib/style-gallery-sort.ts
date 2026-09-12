export const STYLE_GALLERY_SORT_KEYS = ['default', 'date', 'id', 'examples', 'likes'] as const;
export const STYLE_GALLERY_SORT_DIRECTIONS = ['asc', 'desc'] as const;

export type StyleGallerySortKey = (typeof STYLE_GALLERY_SORT_KEYS)[number];
export type StyleGallerySortDirection = (typeof STYLE_GALLERY_SORT_DIRECTIONS)[number];

/**
 * “默认顺序”保留 Catalog 已有的新到旧顺序；用户主动选择统计字段时则优先展示最大或最新值。
 * 三个 Gallery 入口必须共用此规则，避免同一个排序选项在不同页面产生相反的首次结果。
 */
export function getStyleGalleryDefaultSortDirection(sortKey: StyleGallerySortKey): StyleGallerySortDirection {
  return sortKey === 'default' ? 'asc' : 'desc';
}
