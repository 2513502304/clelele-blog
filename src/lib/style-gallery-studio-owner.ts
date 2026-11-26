import { createHash } from 'node:crypto';
import { getStyleGalleryObjectTextSnapshot, putStyleGalleryObject, StyleGalleryObjectConflictError } from './hf-s3-presign';

export function studioOwner(request: Request) {
  const platform = request.headers.get('x-gallery-provider');
  const apiKey = request.headers.get('x-api-key')?.trim();
  if ((platform !== 'pixai' && platform !== 'gpt-image') || !apiKey || apiKey.length > 2048) return null;
  const owner = createHash('sha256').update(`gallery-studio-v1:${platform}:${apiKey}`).digest('hex');
  return { owner, platform, apiKey } as const;
}
const sourceKey = (owner: string) => `generation-drafts/owners/${owner}/sources.json`;
export async function readStudioSources(owner: string) {
  const { text, etag } = await getStyleGalleryObjectTextSnapshot(sourceKey(owner));
  if (text && !etag) throw new Error('Missing source index revision');
  return { slugs: (text ? JSON.parse(text) : []) as string[], etag };
}

/** Register before reserving a paid submission so an interrupted response cannot orphan its source. */
export async function rememberStudioSource(owner: string, slug: string) {
  for (let i = 0; ; i++) {
    const { slugs, etag } = await readStudioSources(owner);
    if (slugs.includes(slug)) return;
    try {
      await putStyleGalleryObject(
        sourceKey(owner),
        Buffer.from(JSON.stringify([slug, ...slugs])),
        'application/json',
        etag ? { ifMatch: etag } : { ifNoneMatch: '*' },
      );
      return;
    } catch (error) {
      if (!(error instanceof StyleGalleryObjectConflictError) || i >= 5) throw error;
    }
  }
}
