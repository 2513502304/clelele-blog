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
      onClick={(event) => {
        const frame = event.currentTarget.closest('[data-profile-asset]')?.getBoundingClientRect();
        if (frame) event.currentTarget.href = `/admin?asset=${slot}&frame=${frame.width / frame.height}`;
      }}
      className={`pointer-events-none absolute z-20 rounded-full border border-white/40 bg-black/60 px-4 py-2 text-sm text-white opacity-0 backdrop-blur-md transition-opacity hover:bg-black/80 focus:pointer-events-auto focus:opacity-100 group-focus-within/profile:pointer-events-auto group-focus-within/profile:opacity-100 group-hover/profile:pointer-events-auto group-hover/profile:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100 ${slot === 'avatar' ? '-bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap' : 'right-5 bottom-12'}`}
    >
      {slot === 'avatar' ? '更换头像' : '更换横幅'}
    </a>
  ) : null;
}
