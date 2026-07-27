const ownedNodes = new Set<HTMLElement>();

/**
 * 共享一个稳定的 Live2D 焦点域。全屏弹窗只需查询此注册表，无需了解 Widget 的 portal 结构。
 */
export function registerLive2DFocusNode(node: HTMLElement): () => void {
  ownedNodes.add(node);
  return () => ownedNodes.delete(node);
}

export function getLive2DFocusNodes(): HTMLElement[] {
  return [...ownedNodes].filter((node) => node.isConnected);
}

export function isLive2DOwnedTarget(target: EventTarget | null): boolean {
  return target instanceof Node && getLive2DFocusNodes().some((node) => node === target || node.contains(target));
}

export function markLive2DEscapeHandled(event: KeyboardEvent): void {
  Object.defineProperty(event, 'live2dHandled', { configurable: true, value: true });
}

export function isLive2DEscapeHandled(event: KeyboardEvent): boolean {
  return Boolean((event as KeyboardEvent & { live2dHandled?: boolean }).live2dHandled);
}
