import type { StyleGalleryExample, StyleGalleryExampleIndexEntry, StyleGalleryExampleIndexGroup } from '@/types/style-gallery';

/** 按“平台 + 图片哈希”合并示例，后出现的元数据覆盖同一身份的旧值。 */
export function mergeStyleGalleryExamples(examples: StyleGalleryExample[]): StyleGalleryExample[] {
  const byIdentity = new Map<string, StyleGalleryExample>();
  for (const example of examples) {
    if (!example.src) continue;
    const identity = getStyleGalleryExampleIdentity(example);
    byIdentity.set(identity, { ...byIdentity.get(identity), ...example });
  }
  return [...byIdentity.values()];
}

/** 示例身份包含平台，因此同一张图可以在不同平台分组中各保留一份。 */
export function getStyleGalleryExampleIdentity(example: StyleGalleryExample): string {
  return `${example.model.trim().toLowerCase()}::${example.imageHash}`;
}

/** 将详情示例裁剪为总览索引需要的最小字段。 */
export function toStyleGalleryExampleIndexEntry(example: StyleGalleryExample): StyleGalleryExampleIndexEntry {
  return {
    id: example.id,
    src: example.src,
    model: example.model,
    note: example.note,
    uploadedAt: example.uploadedAt,
  };
}

export function toStyleGalleryExampleIndexGroup(
  sourceSlug: string,
  examples: StyleGalleryExample[],
): StyleGalleryExampleIndexGroup {
  return { sourceSlug, examples: examples.map(toStyleGalleryExampleIndexEntry) };
}

export function removeStyleGalleryExamples(examples: StyleGalleryExample[], ids: Set<string>): StyleGalleryExample[] {
  return examples.filter((example) => !ids.has(example.id));
}
