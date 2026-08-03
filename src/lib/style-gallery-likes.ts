import { mutateStyleGalleryExampleIndex } from '@lib/style-gallery-store';
import type { StyleGalleryExampleIndex } from '@/types/style-gallery';

const parentLikeCountsCache = new WeakMap<StyleGalleryExampleIndex, Map<string, number>>();
const viewerLikedIdsCache = new WeakMap<StyleGalleryExampleIndex, Map<number, string[]>>();

/** 将示例索引中的点赞数汇总到 parent slug，供 Gallery 首页和图片矩阵排序。 */
export function getStyleGalleryParentLikeCounts(index: StyleGalleryExampleIndex): Map<string, number> {
  const cached = parentLikeCountsCache.get(index);
  if (cached) return cached;
  const counts = new Map(
    index.groups.map((group) => [
      group.sourceSlug,
      group.examples.reduce((total, example) => total + example.likedBy.length, 0),
    ]),
  );
  parentLikeCountsCache.set(index, counts);
  return counts;
}

/** 对单个 GitHub 用户的目标点赞状态执行幂等更新。 */
export async function setStyleGalleryExampleLike(input: {
  exampleId: string;
  userId: number;
  liked: boolean;
}): Promise<{ liked: boolean; likeCount: number; sourceSlug: string }> {
  let result: { liked: boolean; likeCount: number; sourceSlug: string } | undefined;
  await mutateStyleGalleryExampleIndex((current) => {
    const groupIndex = current.groups.findIndex((group) => group.examples.some((example) => example.id === input.exampleId));
    if (groupIndex < 0) throw new Error(`Style gallery example not found: ${input.exampleId}`);
    const group = current.groups[groupIndex];
    const exampleIndex = group.examples.findIndex((example) => example.id === input.exampleId);
    const example = group.examples[exampleIndex];
    const alreadyLiked = example.likedBy.includes(input.userId);
    result = { liked: input.liked, likeCount: example.likedBy.length, sourceSlug: group.sourceSlug };
    if (alreadyLiked === input.liked) return current;

    const likedBy = new Set(example.likedBy);
    input.liked ? likedBy.add(input.userId) : likedBy.delete(input.userId);
    const userIds = [...likedBy].sort((a, b) => a - b);
    result = { liked: input.liked, likeCount: userIds.length, sourceSlug: group.sourceSlug };
    const examples = group.examples.slice();
    examples[exampleIndex] = { ...example, likedBy: userIds };
    const groups = current.groups.slice();
    groups[groupIndex] = { ...group, examples };
    return { version: 2, updatedAt: new Date().toISOString(), groups };
  });
  if (!result) throw new Error(`Style gallery example not found: ${input.exampleId}`);
  return result;
}

/** 删除示例时点赞事实随同一索引条目一起消失，不需要额外清理表。 */
export function getStyleGalleryViewerLikedExampleIds(index: StyleGalleryExampleIndex, userId: number): string[] {
  let byUser = viewerLikedIdsCache.get(index);
  if (!byUser) {
    byUser = new Map();
    viewerLikedIdsCache.set(index, byUser);
  }
  const cached = byUser.get(userId);
  if (cached) return cached;
  const ids = index.groups.flatMap((group) =>
    group.examples.filter((example) => example.likedBy.includes(userId)).map((example) => example.id),
  );
  byUser.set(userId, ids);
  return ids;
}
