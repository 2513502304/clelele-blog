import { getStyleGalleryParentLikeCounts } from '@lib/style-gallery-likes';
import { getStoredStyleGalleryItem, getStyleGalleryCatalog, getStyleGalleryExampleIndex } from '@lib/style-gallery-store';
import type {
  StyleGalleryCardData,
  StyleGalleryCatalog,
  StyleGalleryExampleOverviewItem,
  StyleGalleryItem,
} from '@/types/style-gallery';

export interface StyleGalleryData extends StyleGalleryCatalog {
  /** 仅在服务端读取时派生，不属于持久化 catalog schema。 */
  parentLikeCounts: Record<string, number>;
}

export async function getStyleGalleryData(): Promise<StyleGalleryData> {
  const [catalog, index] = await Promise.all([getStyleGalleryCatalog(), getStyleGalleryExampleIndex()]);
  return { ...catalog, parentLikeCounts: Object.fromEntries(getStyleGalleryParentLikeCounts(index)) };
}

/** 按需组合详情 item 与 catalog 顶层共享配置，不扫描其他 item。 */
export async function getStyleGalleryItemBySlug(slug: string): Promise<StyleGalleryItem | undefined> {
  const [item, catalog, index] = await Promise.all([
    getStoredStyleGalleryItem(slug),
    getStyleGalleryCatalog(),
    getStyleGalleryExampleIndex(),
  ]);
  if (!item) return undefined;
  const indexedById = new Map(
    index.groups.find((group) => group.sourceSlug === slug)?.examples.map((example) => [example.id, example]),
  );
  return {
    ...item,
    examples: item.examples.map((example) => ({
      ...example,
      likeCount: indexedById.get(example.id)?.likedBy.length ?? 0,
    })),
    tags: catalog.tags,
    modelTargets: catalog.modelTargets,
  };
}

/** 把 catalog 顶层的公共标签和目标平台注入各卡片，避免在 HF 中逐项重复存储。 */
export function toStyleGalleryCardDataList(catalog: StyleGalleryData): StyleGalleryCardData[] {
  return catalog.items.map((item) => ({
    ...item,
    tags: catalog.tags,
    modelTargets: catalog.modelTargets,
    likeCount: catalog.parentLikeCounts[item.slug] ?? 0,
  }));
}

/** 通过轻量示例索引与 catalog 做关联，构造 Sub-gallery 总览，不读取全部详情 item。 */
export async function getStyleGalleryExampleOverview(): Promise<StyleGalleryExampleOverviewItem[]> {
  const [catalog, index] = await Promise.all([getStyleGalleryCatalog(), getStyleGalleryExampleIndex()]);
  const sourceBySlug = new Map(catalog.items.map((item) => [item.slug, item]));
  return index.groups
    .flatMap((group) => {
      const source = sourceBySlug.get(group.sourceSlug);
      if (!source) return [];
      return group.examples.map(({ likedBy, ...example }) => ({
        ...example,
        sourceSlug: group.sourceSlug,
        sourceTitle: source.title,
        sourceImage: source.thumbnailImage ?? source.sourceImage,
        sourceImageAlt: source.sourceImageAlt,
        sourceExampleCount: source.exampleCount,
        likeCount: likedBy.length,
      }));
    })
    .sort((a, b) => (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? ''));
}
