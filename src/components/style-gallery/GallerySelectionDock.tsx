import { useIsMobile } from '@hooks/useMediaQuery';
import { Icon } from '@iconify/react';
import { type ReactNode, useState } from 'react';

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
  const [collapsedOverride, setCollapsedOverride] = useState<boolean | null>(null);
  // Follow viewport changes until the user explicitly chooses their preferred state.
  const collapsed = collapsedOverride ?? isMobile;
  const zh = locale.startsWith('zh');
  const ja = locale.startsWith('ja');
  return (
    <aside
      data-gallery-selection-dock
      aria-label={zh ? '多选操作' : ja ? '選択操作' : 'Selection actions'}
      className="glass-surface fixed top-1/2 right-20 z-40 max-h-[70dvh] w-60 max-w-[calc(100vw-6rem)] -translate-y-1/2 overflow-y-auto rounded-2xl border border-border p-3 shadow-xl max-[768px]:top-auto max-[768px]:right-16 max-[768px]:bottom-6 max-[768px]:max-h-[50dvh] max-[768px]:translate-y-0"
    >
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
      {!collapsed && (
        <div className="flex flex-col gap-2 border-border border-t pt-3 [&_button]:w-full [&_select]:w-full">{children}</div>
      )}
    </aside>
  );
}
