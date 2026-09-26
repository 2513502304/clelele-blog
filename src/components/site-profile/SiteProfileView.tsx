import { Icon } from '@iconify/react';
import { useEffect, useState } from 'react';
import type { SiteProfile } from '@/lib/site-profile/schema';
import { siteAssetUrl } from '@/lib/site-profile/schema';
import { ProfileQuickEdit } from './ProfileQuickEdit';

export type PublicProfile = Omit<SiteProfile, 'history'>;
let request: Promise<PublicProfile> | undefined;
let expiresAt = 0;
/** One small cacheable read is shared by sidebar/mobile/About islands, including prerendered pages. */
function loadProfile() {
  if (Date.now() > expiresAt) {
    request = undefined;
    expiresAt = Date.now() + 30_000;
  }
  request ??= fetch('/api/site-profile')
    .then(async (response) => {
      if (!response.ok) throw new Error('Profile unavailable.');
      return response.json() as Promise<PublicProfile>;
    })
    .catch((error) => {
      request = undefined;
      throw error;
    });
  return request;
}
export function SiteProfileView({ initial, contactsOnly = false }: { initial: PublicProfile; contactsOnly?: boolean }) {
  const [profile, setProfile] = useState(initial);
  useEffect(() => {
    let active = true;
    void loadProfile()
      .then((value) => {
        if (active) setProfile(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  if (contactsOnly)
    return (
      <ul>
        {profile.links.map((link) => (
          <li key={link.id}>
            {link.label}:{' '}
            <a href={link.url} rel="me noreferrer" target={link.url.startsWith('https:') ? '_blank' : undefined}>
              {link.text}
            </a>
          </li>
        ))}
      </ul>
    );
  return (
    <>
      <div className="relative size-40 rounded-full">
        <img
          className="size-full rounded-full object-cover shadow-card-darker"
          src={siteAssetUrl('avatar', profile.revision)}
          alt={`${profile.name} avatar`}
          width={160}
          height={160}
          fetchPriority="high"
        />
        <ProfileQuickEdit slot="avatar" />
      </div>
      <p className="mt-2">{profile.name}</p>
      <p className="mt-3 whitespace-pre-wrap text-center text-muted-foreground">{profile.signature}</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {profile.links.map((link) => (
          <a
            key={link.id}
            href={link.url}
            title={link.label}
            aria-label={link.label}
            rel="me noreferrer"
            target="_blank"
            className="flex items-center justify-center rounded-xl px-3 py-2 transition hover:bg-primary/10"
            style={{ color: link.color }}
          >
            <Icon icon={link.icon} className={link.icon === 'ri:github-fill' ? 'size-6 dark:text-white' : 'size-6'} />
          </a>
        ))}
      </div>
    </>
  );
}
