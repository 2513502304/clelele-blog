import { useEffect, useState } from 'react';

let checked: Promise<boolean> | undefined;
/** Authorization is checked separately from cacheable page HTML, so CDN caches never leak admin controls. */
export function useSiteAdminAccess() {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let active = true;
    function check() {
      checked ??= fetch('/api/site-profile/access', { cache: 'no-store' })
        .then((r) => r.ok)
        .catch(() => false)
        .finally(() => {
          checked = undefined;
        });
      void checked.then((value) => {
        if (active) setAdmin(value);
      });
    }
    check();
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) check();
    };
    window.addEventListener('pageshow', restore);
    return () => {
      window.removeEventListener('pageshow', restore);
      active = false;
    };
  }, []);
  return admin;
}
