import { getStyleGalleryExampleOverview, getStyleGalleryPromptSearchTextIndex } from '@lib/style-gallery';
import type { APIRoute } from 'astro';

export const prerender = false;

/** Only matching public source and example IDs cross the wire, even for long prompt queries. */
export const POST: APIRoute = async ({ request }) => {
  const input = await request.json().catch(() => null);
  if (typeof input?.query !== 'string' || !input.query.trim()) return new Response(null, { status: 400 });
  const query = input.query.trim().toLowerCase();
  const [examples, index] = await Promise.all([getStyleGalleryExampleOverview(), getStyleGalleryPromptSearchTextIndex()]);
  const sourceSlugs = Object.keys(index).filter((slug) => index[slug].includes(query));
  // Many images share a prompt. Normalize each distinct note at most once per search.
  const notes = new Map<string, boolean>();
  const ids = [];
  for (const example of examples) {
    if (!example.note) continue;
    let matches = notes.get(example.note);
    if (matches === undefined) {
      matches = example.note.toLowerCase().includes(query);
      notes.set(example.note, matches);
    }
    if (matches) ids.push(example.id);
  }
  return Response.json({ sourceSlugs, ids }, { headers: { 'Cache-Control': 'private, no-store' } });
};
