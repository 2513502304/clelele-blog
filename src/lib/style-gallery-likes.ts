import { mutateStyleGalleryExampleIndex } from '@lib/style-gallery-store';
import type { StyleGalleryExampleIndex } from '@/types/style-gallery';

/** 将示例索引中的点赞数汇总到 parent slug，供 Gallery 首页和图片矩阵排序。 */
export function getStyleGalleryParentLikeCounts(index: StyleGalleryExampleIndex): Map<string, number> {
  return new Map(
    index.groups.map((group) => [
      group.sourceSlug,
      group.examples.reduce((total, example) => total + example.likedBy.length, 0),
    ]),
  );
}

/** 对单个 GitHub 用户的目标点赞状态执行幂等更新。 */
export async function setStyleGalleryExampleLike(input: {
  exampleId: string;
  userId: number;
  liked: boolean;
}): Promise<{ liked: boolean; likeCount: number; sourceSlug: string }> {
  let result: { liked: boolean; likeCount: number; sourceSlug: string } | undefined;
  await mutateStyleGalleryExampleIndex((current) => {
    let found = false;
    const groups = current.groups.map((group) => ({
      ...group,
      examples: group.examples.map((example) => {
        if (example.id !== input.exampleId) return example;
        found = true;
        const likedBy = new Set(example.likedBy);
        input.liked ? likedBy.add(input.userId) : likedBy.delete(input.userId);
        const userIds = [...likedBy].sort((a, b) => a - b);
        result = { liked: input.liked, likeCount: userIds.length, sourceSlug: group.sourceSlug };
        return { ...example, likedBy: userIds };
      }),
    }));
    if (!found) throw new Error(`Style gallery example not found: ${input.exampleId}`);
    return { version: 2, updatedAt: new Date().toISOString(), groups };
  });
  if (!result) throw new Error(`Style gallery example not found: ${input.exampleId}`);
  return result;
}

/** 删除示例时点赞事实随同一索引条目一起消失，不需要额外清理表。 */
export function getStyleGalleryViewerLikedExampleIds(index: StyleGalleryExampleIndex, userId: number): string[] {
  return index.groups.flatMap((group) =>
    group.examples.filter((example) => example.likedBy.includes(userId)).map((example) => example.id),
  );
}
