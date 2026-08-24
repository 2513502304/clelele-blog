import { createStyleGalleryExampleSourceSearchText } from '@lib/style-gallery-example-search';
import { getStyleGalleryParentLikeCounts } from '@lib/style-gallery-likes';
import { getPrimaryStyleGalleryPrompt, getStyleGalleryPromptRevision } from '@lib/style-gallery-prompts';
import { getStoredStyleGalleryItem, getStyleGalleryCatalog, getStyleGalleryExampleIndex } from '@lib/style-gallery-store';
import type {
  StyleGalleryCardData,
  StyleGalleryCatalog,
  StyleGalleryExampleOverviewItem,
  StyleGalleryItem,
} from '@/types/style-gallery';

const overviewCache = new WeakMap<
  StyleGalleryCatalog,
  WeakMap<Awaited<ReturnType<typeof getStyleGalleryExampleIndex>>, StyleGalleryExampleOverviewItem[]>
>();
const exampleSearchIndexCache = new WeakMap<StyleGalleryCatalog, Record<string, string>>();

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
  const primaryPrompt = getPrimaryStyleGalleryPrompt(item.prompts);
  const indexedById = new Map(
    index.groups.find((group) => group.sourceSlug === slug)?.examples.map((example) => [example.id, example]),
  );
  return {
    ...item,
    prompt: primaryPrompt.prompt,
    promptRevision: getStyleGalleryPromptRevision(item.prompts),
    originalPrompt: primaryPrompt.originalPrompt,
    examples: item.examples.map((example) => ({
      ...example,
      likeCount: indexedById.get(example.id)?.likedBy.length ?? 0,
    })),
    tags: catalog.tags,
    modelTargets: catalog.modelTargets,
  };
}

/** 合并列表排序需要的点赞总数；公共标签和目标平台继续只保留在 catalog 顶层。 */
export function toStyleGalleryCardDataList(catalog: StyleGalleryData): StyleGalleryCardData[] {
  return catalog.items.map((item) => ({
    ...item,
    likeCount: catalog.parentLikeCounts[item.slug] ?? 0,
  }));
}

/** 通过轻量示例索引与 catalog 做关联，构造 Sub-gallery 总览，不读取全部详情 item。 */
export async function getStyleGalleryExampleOverview(): Promise<StyleGalleryExampleOverviewItem[]> {
  const [catalog, index] = await Promise.all([getStyleGalleryCatalog(), getStyleGalleryExampleIndex()]);
  const cached = overviewCache.get(catalog)?.get(index);
  if (cached) return cached;
  const sourceBySlug = new Map(catalog.items.map((item) => [item.slug, item]));
  const overview = index.groups
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
        sourcePromptCount: source.promptCount,
        sourcePromptRevision: source.promptRevision,
        likeCount: likedBy.length,
      }));
    })
    .sort((a, b) => (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? ''));
  let byIndex = overviewCache.get(catalog);
  if (!byIndex) {
    byIndex = new WeakMap();
    overviewCache.set(catalog, byIndex);
  }
  byIndex.set(index, overview);
  return overview;
}

/**
 * 仅为确实存在生成示例的 parent 构建全文搜索索引。
 * 该索引由独立 CDN 接口按需加载，避免给所有 Sub-gallery 访客增加 SSR 响应体积。
 */
export async function getStyleGalleryExampleSearchIndex(): Promise<Record<string, string>> {
  const catalog = await getStyleGalleryCatalog();
  const cached = exampleSearchIndexCache.get(catalog);
  if (cached) return cached;
  const searchIndex = Object.fromEntries(
    catalog.items
      .filter((item) => item.exampleCount > 0)
      .map((item) => [item.slug, createStyleGalleryExampleSourceSearchText(item)]),
  );
  exampleSearchIndexCache.set(catalog, searchIndex);
  return searchIndex;
}
