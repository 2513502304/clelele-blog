import { useTranslation } from '@hooks/useTranslation';
import { Icon } from '@iconify/react';
import type { ImageLightboxLikeAction } from '@store/modal';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';

export function LightboxLikeButton({ action, onClick }: { action: ImageLightboxLikeAction; onClick: () => void }) {
  const title = !action.authEnabled
    ? action.labels.unavailable
    : !action.viewerAuthenticated
      ? action.labels.loginRequired
      : action.liked
        ? action.labels.unlike
        : action.labels.like;
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={!action.authEnabled || action.pending}
      className={`flex h-10 min-w-10 shrink-0 items-center justify-center gap-1 rounded-full px-2 font-bold text-xs transition-colors hover:bg-white/15 disabled:pointer-events-none disabled:opacity-30 ${action.liked ? 'text-rose-400' : 'text-white/80'}`}
      whileTap={{ scale: 0.85 }}
      aria-label={`${title}: ${action.likeCount}`}
      aria-pressed={action.liked}
      title={title}
    >
      <Icon
        icon={action.pending ? 'ri:loader-4-line' : action.liked ? 'ri:heart-3-fill' : 'ri:heart-3-line'}
        className={`size-5 ${action.pending ? 'animate-spin' : ''}`}
      />
      <span className="tabular-nums">{action.likeCount}</span>
    </motion.button>
  );
}

export function ToolbarButton({
  icon,
  label,
  onClick,
  disabled,
  active,
  spinning,
  tone = 'default',
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  spinning?: boolean;
  tone?: 'default' | 'danger';
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex size-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/15 disabled:pointer-events-none disabled:opacity-30 ${active ? 'bg-white/15 text-rose-300' : tone === 'danger' ? 'text-rose-300' : 'text-white/80'}`}
      whileTap={{ scale: 0.85 }}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      <Icon icon={icon} className={`size-5 ${spinning ? 'animate-spin' : ''}`} />
    </motion.button>
  );
}

export function ToolbarLink({
  href,
  download,
  opensExternally,
  icon,
  label,
}: {
  href: string;
  download?: string;
  opensExternally: boolean;
  icon: string;
  label: string;
}) {
  return (
    <motion.a
      href={href}
      download={download}
      target={opensExternally ? '_blank' : undefined}
      rel={opensExternally ? 'noreferrer' : undefined}
      className="flex size-10 shrink-0 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/15"
      whileTap={{ scale: 0.85 }}
      aria-label={label}
      title={label}
    >
      <Icon icon={icon} className="size-5" />
    </motion.a>
  );
}

const BOUNCE_LEFT = { x: [0, -2.5, 0] };
const BOUNCE_RIGHT = { x: [0, 2.5, 0] };
const BOUNCE_NONE = { x: 0 };

export function NavButton({ direction, disabled, onClick }: { direction: 1 | -1; disabled: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  const isLeft = direction === -1;
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex size-8 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/15 disabled:pointer-events-none disabled:opacity-30"
      whileTap={{ scale: 0.82 }}
      aria-label={isLeft ? t('image.prev') : t('image.next')}
    >
      <motion.span
        animate={disabled ? BOUNCE_NONE : isLeft ? BOUNCE_LEFT : BOUNCE_RIGHT}
        transition={{ duration: 1.6, repeat: 3, ease: 'easeInOut' }}
      >
        <Icon icon={isLeft ? 'ri:arrow-left-s-line' : 'ri:arrow-right-s-line'} className="size-5" />
      </motion.span>
    </motion.button>
  );
}

export function ZoomHint() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <motion.div
      className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-4 py-2 text-white/70 text-xs"
      initial={{ opacity: 0 }}
      animate={{ opacity: visible ? 1 : 0 }}
      transition={{ duration: 0.3 }}
    >
      <span className="hidden touch-none sm:inline">{t('image.hintDesktop')}</span>
      <span className="sm:hidden">{t('image.hintMobile')}</span>
    </motion.div>
  );
}
