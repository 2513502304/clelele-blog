import { useIsMobile } from '@hooks/useMediaQuery';
import { Icon } from '@iconify/react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

/** Only mount during selection. Controls reuse the top toolbar's state without moving the page. */
export default function GallerySelectionDock({
  children,
  count,
  locale = 'en',
}: {
  children: ReactNode;
  count: number;
  locale?: string;
}) {
  const isMobile = useIsMobile();
  const dockRef = useRef<HTMLElement>(null);
  const drag = useRef<{ id: number; dx: number; dy: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClickUntil = useRef(0);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const clamp = useCallback((x: number, y: number) => {
    const box = dockRef.current?.getBoundingClientRect();
    return {
      x: Math.max(8, Math.min(x, window.innerWidth - (box?.width ?? 240) - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - (box?.height ?? 40) - 8)),
    };
  }, []);
  useEffect(() => {
    // A small movement threshold lets every button surface act as a drag handle without
    // consuming ordinary clicks. Native form inputs keep text selection and popup gestures.
    const move = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 5) current.moved = true;
      if (!current.moved) return;
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      setPosition(clamp(event.clientX - current.dx, event.clientY - current.dy));
    };
    const finish = () => {
      if (drag.current?.moved) suppressClickUntil.current = Date.now() + 500;
      drag.current = null;
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', finish);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
    };
  }, [clamp]);
  useEffect(() => {
    // Expanding or resizing must not leave a manually positioned dock outside the viewport.
    const fit = () =>
      setPosition((current) => {
        if (!current) return current;
        const next = clamp(current.x, current.y);
        return next.x === current.x && next.y === current.y ? current : next;
      });
    const observer = new ResizeObserver(fit);
    if (dockRef.current) observer.observe(dockRef.current);
    window.addEventListener('resize', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [clamp]);
  const [collapsedOverride, setCollapsedOverride] = useState<boolean | null>(null);
  // Follow viewport changes until the user explicitly chooses their preferred state.
  const collapsed = collapsedOverride ?? isMobile;
  const zh = locale.startsWith('zh');
  const ja = locale.startsWith('ja');
  return (
    <aside
      ref={dockRef}
      onPointerDownCapture={(event) => {
        if (event.button !== 0 || event.pointerType !== 'mouse') return;
        if ((event.target as Element).closest('input,textarea,select,[contenteditable=true]')) return;
        const box = event.currentTarget.getBoundingClientRect();
        drag.current = {
          id: event.pointerId,
          dx: event.clientX - box.left,
          dy: event.clientY - box.top,
          x: event.clientX,
          y: event.clientY,
          moved: false,
        };
      }}
      onClickCapture={(event) => {
        if (Date.now() < suppressClickUntil.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      style={
        position
          ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto', transform: 'none', translate: 'none' }
          : undefined
      }
      data-gallery-selection-dock
      aria-label={zh ? '多选操作' : ja ? '選択操作' : 'Selection actions'}
      className="glass-surface fixed top-1/2 right-20 z-40 max-h-[70dvh] w-60 max-w-[calc(100vw-6rem)] -translate-y-1/2 cursor-grab overflow-y-auto rounded-2xl border border-border p-3 shadow-xl active:cursor-grabbing max-[768px]:top-auto max-[768px]:right-16 max-[768px]:bottom-6 max-[768px]:max-h-[50dvh] max-[768px]:translate-y-0"
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={zh ? '拖动多选工具栏' : ja ? '選択ツールバーを移動' : 'Move selection toolbar'}
          title={zh ? '拖动调整位置，也可使用方向键' : ja ? 'ドラッグまたは矢印キーで移動' : 'Drag or use arrow keys to move'}
          className="flex size-8 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-lg text-muted-foreground hover:bg-muted active:cursor-grabbing"
          onKeyDown={(event) => {
            const delta = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[event.key];
            const box = dockRef.current?.getBoundingClientRect();
            if (!delta || !box) return;
            event.preventDefault();
            setPosition(clamp(box.left + delta[0], box.top + delta[1]));
          }}
        >
          <Icon icon="ri:draggable" className="size-5" />
        </button>
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsedOverride(!collapsed)}
          className="flex min-h-10 w-full items-center gap-2 font-semibold text-sm"
        >
          <Icon icon="ri:checkbox-multiple-line" className="size-4 text-primary" />
          <span className="flex-1 text-left">{zh ? `已选择 ${count} 项` : ja ? `${count} 件選択中` : `${count} selected`}</span>
          <Icon icon={collapsed ? 'ri:arrow-down-s-line' : 'ri:arrow-up-s-line'} />
        </button>
      </div>
      {!collapsed && (
        <div className="flex flex-col gap-2 border-border border-t pt-3 [&_button]:w-full [&_select]:w-full">{children}</div>
      )}
    </aside>
  );
}
