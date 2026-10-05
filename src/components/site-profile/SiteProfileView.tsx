import { Icon } from '@iconify/react';
import { useEffect, useState } from 'react';
import { InlineSpinner } from '@/components/ui/InlineSpinner';
import { useTranslation } from '@/hooks/useTranslation';
import { AVATAR_DISPLAY_SIZE } from '@/lib/site-profile/image-crop';
import type { SiteProfile } from '@/lib/site-profile/schema';
import { siteAssetUrl } from '@/lib/site-profile/schema';
import { ProfileQuickEdit } from './ProfileQuickEdit';

export type PublicProfile = Omit<SiteProfile, 'history' | 'pendingDeletion'>;
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
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();
  useEffect(() => {
    let active = true;
    void loadProfile()
      .then((value) => {
        if (active) setProfile(value);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  if (contactsOnly)
    return (
      <ul aria-busy={loading}>
        {loading && (
          <li className="list-none">
            <InlineSpinner label={t('homeInfo.refreshing')} />
          </li>
        )}
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
    <div className="sidebar-profile">
      <div className="sidebar-identity">
        <div data-profile-asset className="sidebar-avatar group/profile relative rounded-full">
          <img
            className="size-full rounded-full object-cover shadow-card-darker motion-safe:hover:animate-shake"
            src={siteAssetUrl('avatar', profile.revision)}
            alt={`${profile.name} avatar`}
            width={AVATAR_DISPLAY_SIZE}
            height={AVATAR_DISPLAY_SIZE}
            fetchPriority="high"
          />
          <ProfileQuickEdit slot="avatar" />
        </div>
        <div className="sidebar-identity-copy" aria-busy={loading}>
          <p className="sidebar-name">
            {profile.name}
            {loading && <InlineSpinner className="text-muted-foreground" label={t('homeInfo.refreshing')} />}
          </p>
          <p className="sidebar-signature">{profile.signature}</p>
        </div>
      </div>
      <nav className="sidebar-socials" aria-label={t('homeInfo.socialLinks')}>
        {profile.links.map((link) => (
          <a
            key={link.id}
            href={link.url}
            title={link.label}
            aria-label={link.label}
            rel="me noreferrer"
            target="_blank"
            className="sidebar-social-link"
            style={{ color: link.color }}
          >
            <Icon icon={link.icon} className={link.icon === 'ri:github-fill' ? 'dark:text-white' : undefined} />
          </a>
        ))}
      </nav>
    </div>
  );
}
