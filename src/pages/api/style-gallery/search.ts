import { createStyleGalleryData, createStyleGalleryPromptSearchTextIndex } from '@lib/style-gallery';
import { STYLE_GALLERY_LIST_CACHE_TAG, setStyleGalleryPublicCacheHeaders } from '@lib/style-gallery-public-cache';
import { createGallerySearch } from '@lib/style-gallery-search';
import { STYLE_GALLERY_SORT_KEYS, type StyleGallerySortKey } from '@lib/style-gallery-sort';
import {
  getStyleGalleryCatalog,
  getStyleGalleryExampleIndex,
  getStyleGalleryPromptSearchIndex,
} from '@lib/style-gallery-store';
import type { APIRoute } from 'astro';

export const prerender = false;

async function readSnapshot() {
  const [catalog, examples, index] = await Promise.all([
    getStyleGalleryCatalog(),
    getStyleGalleryExampleIndex(),
    getStyleGalleryPromptSearchIndex(),
  ]);
  const revision = [catalog.updatedAt, examples.updatedAt, index.updatedAt].join('/');
  if (snapshot?.revision === revision) return snapshot;
  const gallery = createStyleGalleryData(catalog, examples);
  const prompts = createStyleGalleryPromptSearchTextIndex(catalog, index);
  return { gallery, search: createGallerySearch(gallery, prompts), revision };
}
type Snapshot = {
  gallery: ReturnType<typeof createStyleGalleryData>;
  search: ReturnType<typeof createGallerySearch>;
  revision: string;
};
let snapshot: Snapshot | undefined;
let loading: Promise<Snapshot> | undefined;

/** Concurrent queries share slow storage reads, then search a bounded, revision-scoped offset cache. */
export const GET: APIRoute = async ({ url }) => {
  const params = url.searchParams;
  const q = (params.get('q') ?? '').trim().toLowerCase();
  const offset = Number(params.get('offset') ?? 0);
  const sort = (params.get('sort') ?? 'default') as StyleGallerySortKey;
  if (!q || !Number.isSafeInteger(offset) || offset < 0 || !STYLE_GALLERY_SORT_KEYS.includes(sort))
    return new Response(null, { status: 400 });
  try {
    loading ??= readSnapshot()
      .then((value) => {
        snapshot = value;
        return value;
      })
      .finally(() => {
        loading = undefined;
      });
    const data = await loading;
    const matches = data.search(q, params.get('from') ?? '', params.get('to') ?? '', sort, params.get('dir') === 'desc');
    const all = params.get('all') === '1';
    const start = !all && params.get('revision') === data.revision ? Math.min(offset, matches.length) : 0;
    const items = matches.slice(start, all ? undefined : start + 24).map((i) => {
      const item = data.gallery.items[i];
      return { ...item, likeCount: data.gallery.parentLikeCounts[item.slug] ?? 0 };
    });
    const headers = new Headers();
    setStyleGalleryPublicCacheHeaders(headers, [STYLE_GALLERY_LIST_CACHE_TAG]);
    return Response.json({ start, items, total: matches.length, revision: data.revision }, { headers });
  } catch {
    return new Response('Gallery search unavailable', { status: 503 });
  }
};
