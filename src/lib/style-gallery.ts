import { createStyleGalleryExampleSourceSearchText } from '@lib/style-gallery-example-search';
import { getStyleGalleryParentLikeCounts } from '@lib/style-gallery-likes';
import { getPrimaryStyleGalleryPrompt, getStyleGalleryPromptRevision } from '@lib/style-gallery-prompts';
import {
  getStoredStyleGalleryItem,
  getStyleGalleryCatalog,
  getStyleGalleryExampleIndex,
  getStyleGalleryPromptSearchIndex,
} from '@lib/style-gallery-store';
import type {
  StyleGalleryCardData,
  StyleGalleryCatalog,
  StyleGalleryExampleIndex,
  StyleGalleryExampleOverviewItem,
  StyleGalleryItem,
  StyleGalleryPromptSearchIndex,
} from '@/types/style-gallery';
import { getStyleGallerySourceThumbnail } from './style-gallery-image-key';

const overviewCache = new WeakMap<
  StyleGalleryCatalog,
  WeakMap<Awaited<ReturnType<typeof getStyleGalleryExampleIndex>>, StyleGalleryExampleOverviewItem[]>
>();
const promptSearchTextIndexCache = new WeakMap<
  StyleGalleryCatalog,
  { index: StyleGalleryPromptSearchIndex; text: Record<string, string> }
>();

export interface StyleGalleryData extends StyleGalleryCatalog {
  /** 仅在服务端读取时派生，不属于持久化 catalog schema。 */
  parentLikeCounts: Record<string, number>;
}

export async function getStyleGalleryData(): Promise<StyleGalleryData> {
  const [catalog, index] = await Promise.all([getStyleGalleryCatalog(), getStyleGalleryExampleIndex()]);
  return createStyleGalleryData(catalog, index);
}

/** Build public card metadata from the same source revisions as sorted search pages. */
export function createStyleGalleryData(catalog: StyleGalleryCatalog, index: StyleGalleryExampleIndex): StyleGalleryData {
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
    index.groups.find((group) => group.sourceSlug === item.slug)?.examples.map((example) => [example.id, example]),
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
    modelTargets: catalog.modelTargets,
  };
}

/** 合并列表排序需要的点赞总数；目标平台继续只保留在 catalog 顶层。 */
export function toStyleGalleryCardDataList(catalog: StyleGalleryData, start = 0, end?: number): StyleGalleryCardData[] {
  return catalog.items.slice(start, end).map((item) => ({
    ...item,
    likeCount: catalog.parentLikeCounts[item.slug] ?? 0,
  }));
}

/** 通过轻量示例索引与 catalog 做关联，构造 Sub-gallery 总览，不读取全部详情 item。 */
export async function getStyleGalleryExampleOverview(): Promise<StyleGalleryExampleOverviewItem[]> {
  const [catalog, index] = await Promise.all([getStyleGalleryCatalog(), getStyleGalleryExampleIndex()]);
  return createStyleGalleryExampleOverview(catalog, index);
}

/** Build the sorted join for a known pair of source snapshots. */
export function createStyleGalleryExampleOverview(
  catalog: StyleGalleryCatalog,
  index: StyleGalleryExampleIndex,
): StyleGalleryExampleOverviewItem[] {
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
        sourceImage: getStyleGallerySourceThumbnail(source.sourceImage),
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
 * 为三个列表入口构建共享全文搜索文本。
 * 该索引由独立 CDN 接口按需加载，普通浏览和滚动不会下载数 MB prompt。
 */
export async function getStyleGalleryPromptSearchTextIndex(): Promise<Record<string, string>> {
  const [catalog, promptIndex] = await Promise.all([getStyleGalleryCatalog(), getStyleGalleryPromptSearchIndex()]);
  return createStyleGalleryPromptSearchTextIndex(catalog, promptIndex);
}

export function createStyleGalleryPromptSearchTextIndex(
  catalog: StyleGalleryCatalog,
  promptIndex: StyleGalleryPromptSearchIndex,
): Record<string, string> {
  const cached = promptSearchTextIndexCache.get(catalog);
  if (cached?.index === promptIndex) return cached.text;
  const searchIndex = Object.fromEntries(
    catalog.items.map((item) => [
      item.slug,
      createStyleGalleryExampleSourceSearchText({ title: item.title, prompts: promptIndex.entries[item.slug] ?? [] }),
    ]),
  );
  promptSearchTextIndexCache.set(catalog, { index: promptIndex, text: searchIndex });
  return searchIndex;
}
