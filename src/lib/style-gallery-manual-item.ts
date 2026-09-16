import { createHash } from 'node:crypto';
import type { StoredStyleGalleryItem, StyleGalleryImageDimensions } from '@/types/style-gallery';
import { getStyleGalleryDateKey } from './style-gallery-date-range';
import { getStyleGalleryPromptId } from './style-gallery-prompts';

/** The instant is unambiguous; the public slug/date boundary follows Shanghai rather than UTC midnight. */
export function createManualStyleGalleryItem(
  input: {
    imageHash: string;
    extension: string;
    dimensions: StyleGalleryImageDimensions;
    images?: { imageHash: string; extension: string; dimensions: StyleGalleryImageDimensions }[];
    prompt: string;
    originalPrompt?: string;
    model?: string;
  },
  now = new Date(),
): StoredStyleGalleryItem {
  // Keep the canonical UTC serialization used by catalog sorting; derive the visible calendar day in UTC+8.
  const date = now.toISOString();
  const dateKey = getStyleGalleryDateKey(now);
  const refs = input.images ?? [input];
  // Match session imports exactly: image order is part of a multi-image collection's identity.
  const imageHash =
    refs.length === 1
      ? refs[0].imageHash
      : createHash('sha256')
          .update(refs.map((image) => image.imageHash).join('\n'))
          .digest('hex');
  const shortHash = imageHash.slice(0, 12);
  const images = refs.map((ref) => ({
    imageHash: ref.imageHash,
    sourceImage: `/api/style-gallery/image/source/${ref.imageHash.slice(0, 12)}.${ref.extension}`,
    sourceImageAlt: `Style Prompt ${shortHash}`,
    dimensions: ref.dimensions,
  }));
  const image = images[0];
  const prompt = input.prompt.trim();
  return {
    version: 4,
    slug: `${dateKey}-${shortHash}`,
    title: `Style Prompt ${shortHash}`,
    date,
    imageHash,
    sourceImage: image.sourceImage,
    sourceImageAlt: image.sourceImageAlt,
    images,
    examples: [],
    prompts: [
      {
        id: getStyleGalleryPromptId(prompt),
        prompt,
        model: input.model?.trim() || undefined,
        originalPrompt: input.originalPrompt?.trim() || undefined,
        importedAt: date,
      },
    ],
  };
}
