interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

const SCROLL_EDGE_EPSILON = 1;

/**
 * 判断嵌套面板能否消费当前纵向滚轮输入。
 *
 * Lightbox 会锁住页面滚动，但 Prompt 选择框仍需独立滚动。只有面板在当前方向还有空间时才
 * 放行事件；到达边界后继续拦截，可避免滚动穿透到 Lightbox 后面的页面。
 */
export function canConsumeLightboxWheel(metrics: ScrollMetrics, deltaY: number): boolean {
  if (deltaY === 0) return false;

  const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  if (maxScrollTop <= SCROLL_EDGE_EPSILON) return false;

  if (deltaY < 0) return metrics.scrollTop > SCROLL_EDGE_EPSILON;
  return metrics.scrollTop < maxScrollTop - SCROLL_EDGE_EPSILON;
}
