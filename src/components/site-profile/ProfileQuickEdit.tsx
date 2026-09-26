import { useEffect, useState } from 'react';
import type { SiteAssetSlot } from '@/lib/site-profile/schema';

let checked: Promise<boolean> | undefined;
/** Authorization is checked separately from cacheable page HTML, so CDN caches never leak admin controls. */
export function ProfileQuickEdit({ slot }: { slot: SiteAssetSlot }) {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let active = true;
    checked ??= fetch('/api/site-profile/access', { cache: 'no-store' })
      .then((r) => r.ok)
      .catch(() => false);
    void checked.then((value) => {
      if (active) setAdmin(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return admin ? (
    <a
      href={`/admin?asset=${slot}`}
      data-astro-reload
      className={`absolute z-20 rounded-full border border-white/40 bg-black/60 px-4 py-2 text-sm text-white backdrop-blur-md hover:bg-black/80 ${slot === 'avatar' ? '-bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap' : 'right-5 bottom-12'}`}
    >
      {slot === 'avatar' ? '更换头像' : '更换横幅'}
    </a>
  ) : null;
}
