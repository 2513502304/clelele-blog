import { createHash } from 'node:crypto';
import type { StoredStyleGalleryItem, StyleGalleryExample, StyleGalleryExampleIndex } from '@/types/style-gallery';
import { assertStyleGalleryItemConsistency } from './style-gallery-assets';
import { StyleGalleryClientError } from './style-gallery-errors';
import { getStyleGalleryExampleIdentity, toStyleGalleryExampleIndexEntry } from './style-gallery-examples';
import type { GalleryMergeSelection } from './style-gallery-merge-types';
import { styleGalleryItemSchema } from './style-gallery-schema';

/** Include categories and votes in the editing snapshot so a stale comparison never silently discards new data. */
export function galleryMergeRevision(item: StoredStyleGalleryItem, tags: string[], index: StyleGalleryExampleIndex) {
  const group = index.groups.find((entry) => entry.sourceSlug === item.slug);
  return createHash('sha256')
    .update(JSON.stringify([item, tags, group ?? null]))
    .digest('hex');
}

/** Merge selected facts only; retain identity of one source and combine votes per retained example identity. */
export function buildGalleryMerge(
  items: [StoredStyleGalleryItem, StoredStyleGalleryItem],
  choice: GalleryMergeSelection,
  index: StyleGalleryExampleIndex,
) {
  const kept = items[choice.keep];
  const removed = items[choice.keep === 0 ? 1 : 0];
  const fail = () => {
    throw new StyleGalleryClientError('Selection is no longer valid. Reload both cards.', 409);
  };
  const original = choice.original
    ? items[choice.original.side].prompts.find((prompt) => prompt.id === choice.original?.id)
    : undefined;
  if (choice.original && !original) fail();
  const prompts = choice.prompts.map(({ side, id }) => {
    const value = items[side].prompts.find((prompt) => prompt.id === id);
    if (!value) return fail();
    return { ...value, originalPrompt: original?.originalPrompt || undefined };
  });
  const uniquePrompts = [...new Map(prompts.map((prompt) => [prompt.id, prompt])).values()];
  if (!uniquePrompts.length) throw new StyleGalleryClientError('Keep at least one generated prompt.', 400);
  const indexed = new Map(index.groups.flatMap((group) => group.examples.map((example) => [example.id, example] as const)));
  const examples = new Map<string, StyleGalleryExample>();
  const votes = new Map<string, Set<number>>();
  const remappedIds = new Map<string, string>();
  // Prefer the retained card's IDs when both contain the same platform/hash pair.
  for (const side of [choice.keep, choice.keep === 0 ? 1 : 0] as const) {
    if (!choice.examples.includes(side)) continue;
    for (const example of items[side].examples) {
      const key = getStyleGalleryExampleIdentity(example);
      if (!examples.has(key)) examples.set(key, example);
      const retained = examples.get(key) ?? example;
      remappedIds.set(example.id, retained.id);
      const users = votes.get(key) ?? new Set<number>();
      indexed.get(example.id)?.likedBy.forEach((id) => {
        users.add(id);
      });
      votes.set(key, users);
    }
  }
  const item = styleGalleryItemSchema.parse({
    ...kept,
    date: items[choice.date].date,
    updated: new Date().toISOString(),
    prompts: uniquePrompts,
    examples: [...examples.values()],
  });
  assertStyleGalleryItemConsistency(item);
  const group = {
    sourceSlug: item.slug,
    examples: [...examples.entries()].map(([key, example]) => ({
      ...toStyleGalleryExampleIndexEntry(example),
      likedBy: [...(votes.get(key) ?? [])].sort((a, b) => a - b),
    })),
  };
  return { item, removed, group, remappedIds };
}
