import type { StyleGalleryExampleOverviewItem as Example } from '@/types/style-gallery';

type Source = Pick<
  Example,
  | 'sourceSlug'
  | 'sourceTitle'
  | 'sourceImage'
  | 'sourceImageAlt'
  | 'sourceExampleCount'
  | 'sourcePromptCount'
  | 'sourcePromptRevision'
>;
type Card = [
  source: number,
  id: string,
  src: string,
  model: Example['model'],
  uploadedAt: string,
  likes: number,
  dimensions: Example['dimensions'] | null,
];
export interface OverviewPayload {
  sources: Source[];
  cards: Card[];
}

/** Preserve the global sort order while transmitting parent metadata once. Recipes are fetched when opened. */
export function packOverview(examples: Example[]): OverviewPayload {
  const sources: Source[] = [];
  const bySlug = new Map<string, number>();
  const cards = examples.map((e): Card => {
    let source = bySlug.get(e.sourceSlug);
    if (source === undefined) {
      source = sources.length;
      bySlug.set(e.sourceSlug, source);
      sources.push({
        sourceSlug: e.sourceSlug,
        sourceTitle: e.sourceTitle,
        sourceImage: e.sourceImage,
        sourceImageAlt: e.sourceImageAlt,
        sourceExampleCount: e.sourceExampleCount,
        sourcePromptCount: e.sourcePromptCount,
        sourcePromptRevision: e.sourcePromptRevision,
      });
    }
    return [source, e.id, e.src, e.model, e.uploadedAt, e.likeCount, e.dimensions ?? null];
  });
  return { sources, cards };
}

export function unpackOverview({ sources, cards }: OverviewPayload): Example[] {
  return cards.map(([source, id, src, model, uploadedAt, likeCount, dimensions]) => ({
    ...sources[source],
    id,
    src,
    model,
    uploadedAt,
    likeCount,
    dimensions: dimensions ?? undefined,
  }));
}
