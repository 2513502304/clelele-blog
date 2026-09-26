import { siteConfig } from '../../constants/site-config';
import { getSiteProfile } from './store';
/** A neutral build-time fallback keeps pages available without maintaining a second copy of editable profile data. */
export async function publicSiteProfile() {
  try {
    const { history: _, ...profile } = await getSiteProfile();
    return profile;
  } catch {
    return {
      version: 1 as const,
      revision: '',
      updatedAt: '',
      name: siteConfig.name,
      signature: '',
      assets: {},
      links: [],
    };
  }
}
