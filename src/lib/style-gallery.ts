import { getStoredStyleGalleryItem, getStyleGalleryCatalog, getStyleGalleryExampleIndex } from '@lib/style-gallery-store';
import type {
  StyleGalleryCardData,
  StyleGalleryCatalog,
  StyleGalleryExampleOverviewItem,
  StyleGalleryItem,
} from '@/types/style-gallery';

export async function getStyleGalleryData(): Promise<StyleGalleryCatalog> {
  return getStyleGalleryCatalog();
}

/** 按需组合详情 item 与 catalog 顶层共享配置，不扫描其他 item。 */
export async function getStyleGalleryItemBySlug(slug: string): Promise<StyleGalleryItem | undefined> {
  const [item, catalog] = await Promise.all([getStoredStyleGalleryItem(slug), getStyleGalleryCatalog()]);
  return item ? { ...item, tags: catalog.tags, modelTargets: catalog.modelTargets } : undefined;
}

/** 把 catalog 顶层的公共标签和目标平台注入各卡片，避免在 HF 中逐项重复存储。 */
export function toStyleGalleryCardDataList(catalog: StyleGalleryCatalog): StyleGalleryCardData[] {
  return catalog.items.map((item) => ({ ...item, tags: catalog.tags, modelTargets: catalog.modelTargets }));
}

/** 通过轻量示例索引与 catalog 做关联，构造 Sub-gallery 总览，不读取全部详情 item。 */
export async function getStyleGalleryExampleOverview(): Promise<StyleGalleryExampleOverviewItem[]> {
  const [catalog, index] = await Promise.all([getStyleGalleryCatalog(), getStyleGalleryExampleIndex()]);
  const sourceBySlug = new Map(catalog.items.map((item) => [item.slug, item]));
  return index.groups
    .flatMap((group) => {
      const source = sourceBySlug.get(group.sourceSlug);
      if (!source) return [];
      return group.examples.map((example) => ({
        ...example,
        sourceSlug: group.sourceSlug,
        sourceTitle: source.title,
        sourceImage: source.thumbnailImage ?? source.sourceImage,
        sourceImageAlt: source.sourceImageAlt,
      }));
    })
    .sort((a, b) => (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? ''));
}
