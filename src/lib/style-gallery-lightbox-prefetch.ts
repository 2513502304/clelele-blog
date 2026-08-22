export const LIGHTBOX_SIGN_BATCH_SIZE = 24;
export const LIGHTBOX_PRELOAD_AHEAD_COUNT = 6;
export const LIGHTBOX_NEXT_BATCH_THRESHOLD = 8;

export interface LightboxPrefetchPlan {
  signIndexes: number[];
  preloadIndexes: number[];
}

function range(start: number, end: number): number[] {
  return Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);
}

/**
 * 当前签名页总是完整生成；进入页尾前瞻区后同时签下一页。浏览器只预加载临近高清图，
 * 将键盘连续翻页延迟隐藏在阅读时间内，同时限制未实际浏览图片的带宽消耗。
 */
export function createLightboxPrefetchPlan(
  total: number,
  currentIndex: number,
  batchSize = LIGHTBOX_SIGN_BATCH_SIZE,
  preloadAhead = LIGHTBOX_PRELOAD_AHEAD_COUNT,
  nextBatchThreshold = LIGHTBOX_NEXT_BATCH_THRESHOLD,
): LightboxPrefetchPlan {
  if (total <= 0 || currentIndex < 0 || currentIndex >= total) return { signIndexes: [], preloadIndexes: [] };
  const pageStart = Math.floor(currentIndex / batchSize) * batchSize;
  const pageEnd = Math.min(total, pageStart + batchSize);
  const shouldSignNext = currentIndex >= pageEnd - nextBatchThreshold && pageEnd < total;
  const signEnd = shouldSignNext ? Math.min(total, pageEnd + batchSize) : pageEnd;
  return {
    signIndexes: range(pageStart, signEnd),
    preloadIndexes: range(currentIndex + 1, Math.min(total, currentIndex + 1 + preloadAhead)),
  };
}
