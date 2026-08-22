/**
 * 将指针的水平位置映射为 range input 的合法步进值。
 *
 * 部分浏览器在自定义 range 样式或 React 受控值下只稳定处理点击跳转，拖动期间不会连续触发 input。
 * 调用方配合 Pointer Capture 主动采样坐标，可让鼠标、触控笔和触屏共享一致的平滑拖动行为。
 */
export function getRangeValueAtPointer(input: HTMLInputElement, clientX: number): number {
  const rect = input.getBoundingClientRect();
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 1;
  const step = Number(input.step) || 0;
  const ratio = rect.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
  const raw = min + ratio * (max - min);
  const stepped = step > 0 ? min + Math.round((raw - min) / step) * step : raw;
  return Math.max(min, Math.min(max, stepped));
}
