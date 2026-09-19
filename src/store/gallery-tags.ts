import type { StyleGalleryTagIndex } from '@lib/style-gallery-tags';
import { useStore } from '@nanostores/react';
import { atom } from 'nanostores';
import { useEffect } from 'react';

const EMPTY: StyleGalleryTagIndex = { version: 1, items: {} };
const $tags = atom<{ index: StyleGalleryTagIndex; status: 'idle' | 'loading' | 'ready' | 'error' }>({
  index: EMPTY,
  status: 'idle',
});
export const $galleryTagEditor = atom<string | string[] | null>(null);
let pending: Promise<void> | undefined;
let revision = 0;
let editorNeedsFreshSnapshot = false;

/** Public tags are sufficient to start a draft; PUT authenticates and compares the base tags.
 * After a conflict, force one fresh read so reopening cannot repeat the same stale draft.
 */
export function getGalleryTagEditorSnapshot(): StyleGalleryTagIndex | null {
  const state = $tags.get();
  return !editorNeedsFreshSnapshot && state.status === 'ready' ? state.index : null;
}
export function invalidateGalleryTagEditorSnapshot(): void {
  editorNeedsFreshSnapshot = true;
}

/** One small public request per page, shared across Astro islands and every mounted card. */
export function loadGalleryTags(): Promise<void> {
  if (pending) return pending;
  const started = revision;
  $tags.set({ ...$tags.get(), status: 'loading' });
  pending = fetch('/api/style-gallery/tags', { signal: AbortSignal.timeout(20_000) })
    .then(async (response) => {
      if (!response.ok) throw new Error('Tag read failed.');
      const index: StyleGalleryTagIndex = await response.json();
      // A delayed public response must never overwrite a successful edit/fresh editor snapshot.
      if (started === revision) $tags.set({ index, status: 'ready' });
    })
    .catch(() => {
      if (started === revision) $tags.set({ ...$tags.get(), status: 'error' });
    })
    .finally(() => {
      pending = undefined;
    });
  return pending;
}

export function useGalleryTags(enabled = true) {
  const state = useStore($tags);
  useEffect(() => {
    if (enabled && $tags.get().status === 'idle') void loadGalleryTags();
  }, [enabled]);
  return state;
}

/** Publish saved tags to all visible cards, filters and an already-open Lightbox. */
export function publishGalleryTags(index: StyleGalleryTagIndex): void {
  revision++;
  editorNeedsFreshSnapshot = false;
  $tags.set({ index, status: 'ready' });
}
