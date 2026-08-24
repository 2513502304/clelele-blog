export interface StyleGalleryExampleSearchTarget {
  sourceSlug: string;
  sourceTitle: string;
  note?: string;
}

export interface StyleGalleryExampleSearchSource {
  title: string;
  prompt: string;
  additionalPrompts: readonly string[];
}

/** Catalog 已持有列表搜索所需的全部 prompt；这里只压平并规范化一次，不读取详情 item。 */
export function createStyleGalleryExampleSourceSearchText(source: StyleGalleryExampleSearchSource): string {
  return [source.title, source.prompt, ...source.additionalPrompts].join('\n').toLowerCase();
}

/**
 * 为 Sub-gallery 构造本地文本筛选器。
 *
 * `sourceSearchIndex` 按 parent slug 共享完整 prompt，避免把同一长文本复制到该 parent 的每张生成示例中。
 * 每次 query 变化只扫描一次 parent 索引；过滤数千张 example 时仅执行 Set 查询与短备注匹配。
 */
export function createStyleGalleryExampleQueryMatcher(
  sourceSearchIndex: Readonly<Record<string, string>>,
  query: string,
): (example: StyleGalleryExampleSearchTarget) => boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return () => true;

  const matchingSourceSlugs = new Set(
    Object.entries(sourceSearchIndex)
      .filter(([, sourceText]) => sourceText.includes(normalizedQuery))
      .map(([sourceSlug]) => sourceSlug),
  );
  return (example) =>
    matchingSourceSlugs.has(example.sourceSlug) ||
    (!Object.hasOwn(sourceSearchIndex, example.sourceSlug) && example.sourceTitle.toLowerCase().includes(normalizedQuery)) ||
    (example.note?.toLowerCase().includes(normalizedQuery) ?? false);
}
