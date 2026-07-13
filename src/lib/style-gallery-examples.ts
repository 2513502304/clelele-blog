import type { StyleGalleryExample, StyleGalleryExampleIndexEntry, StyleGalleryExampleIndexGroup } from '@/types/style-gallery';

export function mergeStyleGalleryExamples(examples: StyleGalleryExample[]): StyleGalleryExample[] {
  const byIdentity = new Map<string, StyleGalleryExample>();
  for (const example of examples) {
    if (!example.src) continue;
    const identity = getStyleGalleryExampleIdentity(example);
    byIdentity.set(identity, { ...byIdentity.get(identity), ...example });
  }
  return [...byIdentity.values()];
}

export function getStyleGalleryExampleIdentity(example: StyleGalleryExample): string {
  return `${example.model.trim().toLowerCase()}::${example.imageHash}`;
}

export function toStyleGalleryExampleIndexEntry(example: StyleGalleryExample): StyleGalleryExampleIndexEntry {
  return {
    id: example.id,
    src: example.src,
    model: example.model,
    note: example.note,
    uploadedAt: example.uploadedAt,
  };
}

export function toStyleGalleryExampleIndexGroup(
  sourceSlug: string,
  examples: StyleGalleryExample[],
): StyleGalleryExampleIndexGroup {
  return { sourceSlug, examples: examples.map(toStyleGalleryExampleIndexEntry) };
}

export function removeStyleGalleryExamples(examples: StyleGalleryExample[], ids: Set<string>): StyleGalleryExample[] {
  return examples.filter((example) => !ids.has(example.id));
}
