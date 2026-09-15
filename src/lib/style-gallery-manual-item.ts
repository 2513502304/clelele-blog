import type { StoredStyleGalleryItem, StyleGalleryImageDimensions } from '@/types/style-gallery';
import { getStyleGalleryDateKey } from './style-gallery-date-range';
import { getStyleGalleryPromptId } from './style-gallery-prompts';

/** The instant is unambiguous; the public slug/date boundary follows Shanghai rather than UTC midnight. */
export function createManualStyleGalleryItem(
  input: {
    imageHash: string;
    extension: string;
    dimensions: StyleGalleryImageDimensions;
    prompt: string;
    originalPrompt?: string;
    model?: string;
  },
  now = new Date(),
): StoredStyleGalleryItem {
  // Keep the canonical UTC serialization used by catalog sorting; derive the visible calendar day in UTC+8.
  const date = now.toISOString();
  const dateKey = getStyleGalleryDateKey(now);
  const shortHash = input.imageHash.slice(0, 12);
  const image = {
    imageHash: input.imageHash,
    sourceImage: `/api/style-gallery/image/source/${shortHash}.${input.extension}`,
    sourceImageAlt: `Style Prompt ${shortHash}`,
    dimensions: input.dimensions,
  };
  const prompt = input.prompt.trim();
  return {
    version: 4,
    slug: `${dateKey}-${shortHash}`,
    title: `Style Prompt ${shortHash}`,
    date,
    imageHash: input.imageHash,
    sourceImage: image.sourceImage,
    sourceImageAlt: image.sourceImageAlt,
    images: [image],
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
