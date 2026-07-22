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

/** 上传合并时保留已经存在的记录 ID，避免并发重复上传替换记录并丢失其点赞关联。 */
export function appendUniqueStyleGalleryExamples(
  existing: StyleGalleryExample[],
  incoming: StyleGalleryExample[],
): StyleGalleryExample[] {
  const identities = new Set(existing.map(getStyleGalleryExampleIdentity));
  const appended = [...existing];
  for (const example of incoming) {
    const identity = getStyleGalleryExampleIdentity(example);
    if (identities.has(identity)) continue;
    identities.add(identity);
    appended.push(example);
  }
  return appended;
}

/** 示例身份由规范化后的 `model` 与图片哈希组成，因此同一张图可在不同 model 分组中各保留一份。 */
export function getStyleGalleryExampleIdentity(example: StyleGalleryExample): string {
  return `${example.model.trim().toLowerCase()}::${example.imageHash}`;
}

/** 将详情示例裁剪为总览索引需要的字段；结构更新时保留同 ID 的点赞事实。 */
export function toStyleGalleryExampleIndexEntry(
  example: StyleGalleryExample,
  previous?: StyleGalleryExampleIndexEntry,
): StyleGalleryExampleIndexEntry {
  return {
    id: example.id,
    src: example.src,
    model: example.model,
    note: example.note,
    uploadedAt: example.uploadedAt,
    likedBy: previous?.likedBy ?? [],
  };
}

export function toStyleGalleryExampleIndexGroup(
  sourceSlug: string,
  examples: StyleGalleryExample[],
  previous?: StyleGalleryExampleIndexGroup,
): StyleGalleryExampleIndexGroup {
  const previousById = new Map(previous?.examples.map((example) => [example.id, example]));
  return {
    sourceSlug,
    examples: examples.map((example) => toStyleGalleryExampleIndexEntry(example, previousById.get(example.id))),
  };
}

export function removeStyleGalleryExamples(examples: StyleGalleryExample[], ids: Set<string>): StyleGalleryExample[] {
  return examples.filter((example) => !ids.has(example.id));
}
