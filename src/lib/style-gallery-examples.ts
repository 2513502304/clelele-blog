import type { StyleGalleryExample } from '@/types/style-gallery';

export interface StyleGalleryExamplesManifest {
  version: 1;
  slug: string;
  examples: StyleGalleryExample[];
  updatedAt: string;
}

export function getStyleGalleryExamplesManifestKey(slug: string): string {
  return `examples/${slug}.json`;
}

export function normalizeStyleGalleryExamplesManifest(slug: string, value: unknown): StyleGalleryExamplesManifest {
  if (!value || typeof value !== 'object') {
    return { version: 1, slug, examples: [], updatedAt: new Date(0).toISOString() };
  }
  const record = value as Partial<StyleGalleryExamplesManifest>;
  return {
    version: 1,
    slug,
    examples: Array.isArray(record.examples) ? record.examples.filter(isStyleGalleryExample) : [],
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(0).toISOString(),
  };
}

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
  if (example.imageHash && example.model) {
    return `${example.model.trim().toLowerCase()}::${example.imageHash}`;
  }
  return example.src;
}

function isStyleGalleryExample(value: unknown): value is StyleGalleryExample {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.src === 'string' &&
    (record.alt === undefined || typeof record.alt === 'string') &&
    (record.model === undefined || typeof record.model === 'string') &&
    (record.note === undefined || typeof record.note === 'string') &&
    (record.uploadedAt === undefined || typeof record.uploadedAt === 'string') &&
    (record.imageHash === undefined || typeof record.imageHash === 'string')
  );
}
