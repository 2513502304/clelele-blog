import { z } from 'zod';

export const SITE_ASSET_SLOTS = [
  'avatar',
  'home',
  'weekly',
  'about',
  'music',
  'bangumi',
  'hpoi',
  'links',
  'gallery',
  'posts',
  'categories',
  'tags',
] as const;
export type SiteAssetSlot = (typeof SITE_ASSET_SLOTS)[number];
export const assetSlotSchema = z.enum(SITE_ASSET_SLOTS);
export const assetKeySchema = z.string().regex(/^images\/[a-f0-9]{64}\.(webp|png|jpg|gif)$/);
const safeUrl = z
  .string()
  .max(2048)
  .refine((value) => {
    if (/^\/(?!\/)/.test(value)) return !/[\\\s]/.test(value);
    try {
      return ['https:', 'mailto:'].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, 'Use an HTTPS, mailto, or site-relative link.');
export const profileFieldsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  signature: z.string().trim().max(500),
  links: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]{1,64}$/),
        label: z.string().trim().min(1).max(80),
        text: z.string().trim().min(1).max(160),
        url: safeUrl,
        icon: z.string().regex(/^ri:[a-z0-9-]+$/),
        color: z.string().regex(/^#[a-f0-9]{6}$/i),
      }),
    )
    .max(50)
    .refine((links) => new Set(links.map((link) => link.id)).size === links.length, 'Link IDs must be unique.'),
});
const assetSchema = z.object({
  key: assetKeySchema,
  name: z.string().max(255),
  uploadedAt: z.string().datetime(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export const siteProfileSchema = profileFieldsSchema
  .extend({
    version: z.literal(1),
    revision: z.string().uuid(),
    updatedAt: z.string().datetime(),
    assets: z.record(assetSlotSchema, assetKeySchema),
    history: z.array(assetSchema).max(500),
  })
  .superRefine((profile, ctx) => {
    const keys = new Set(profile.history.map((asset) => asset.key));
    if (!profile.assets.home || !profile.assets.avatar)
      ctx.addIssue({ code: 'custom', message: 'Home banner and avatar are required.' });
    if (Object.values(profile.assets).some((key) => !keys.has(key)))
      ctx.addIssue({ code: 'custom', message: 'Active assets must belong to the uploaded history.' });
  });
export type SiteProfile = z.infer<typeof siteProfileSchema>;
export type SiteAsset = z.infer<typeof assetSchema>;

/** Bound the selectable history while preserving every active slot and the just-uploaded asset. */
export function appendSiteAssetHistory(profile: SiteProfile, asset: SiteAsset): SiteAsset[] {
  const protectedKeys = new Set([...Object.values(profile.assets), asset.key]);
  const history = [...profile.history.filter((entry) => entry.key !== asset.key), asset];
  while (history.length > 500) {
    const index = history.findIndex((entry) => !protectedKeys.has(entry.key));
    if (index < 0) throw new Error('No inactive image history entry can be retired.');
    history.splice(index, 1);
  }
  // This removes history references only. Original HF objects remain available for recovery.
  return history;
}

/** Localized subpages share a banner slot; a source detail never becomes an arbitrary storage key. */
export function bannerSlot(path: string): SiteAssetSlot {
  const first =
    path
      .replace(/^\/(en|ja)(?=\/|$)/, '')
      .split('/')
      .filter(Boolean)[0] || 'home';
  if (first === 'friends') return 'links';
  if (first === 'image-style-prompt-gallery') return 'gallery';
  return SITE_ASSET_SLOTS.includes(first as SiteAssetSlot) && first !== 'avatar' ? (first as SiteAssetSlot) : 'posts';
}
export function siteAssetUrl(slot: SiteAssetSlot, revision?: string): string {
  return `/api/site-assets/${slot}${revision ? `?v=${encodeURIComponent(revision)}` : ''}`;
}
