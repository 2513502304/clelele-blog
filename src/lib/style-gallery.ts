import { getStoredStyleGalleryItem, getStyleGalleryCatalog, getStyleGalleryExampleIndex } from '@lib/style-gallery-store';
import type {
  StyleGalleryCardData,
  StyleGalleryCatalog,
  StyleGalleryExampleOverviewItem,
  StyleGalleryItem,
} from '@/types/style-gallery';

export async function getStyleGalleryData(): Promise<StyleGalleryCatalog> {
  return getStyleGalleryCatalog();
}

export async function getStyleGalleryItemBySlug(slug: string): Promise<StyleGalleryItem | undefined> {
  const [item, catalog] = await Promise.all([getStoredStyleGalleryItem(slug), getStyleGalleryCatalog()]);
  return item ? { ...item, tags: catalog.tags, modelTargets: catalog.modelTargets } : undefined;
}

export function toStyleGalleryCardDataList(catalog: StyleGalleryCatalog): StyleGalleryCardData[] {
  return catalog.items.map((item) => ({ ...item, tags: catalog.tags, modelTargets: catalog.modelTargets }));
}

export async function getStyleGalleryExampleOverview(): Promise<StyleGalleryExampleOverviewItem[]> {
  const [catalog, index] = await Promise.all([getStyleGalleryCatalog(), getStyleGalleryExampleIndex()]);
  const sourceBySlug = new Map(catalog.items.map((item) => [item.slug, item]));
  return index.groups
    .flatMap((group) => {
      const source = sourceBySlug.get(group.sourceSlug);
      if (!source) return [];
      return group.examples.map((example) => ({
        ...example,
        sourceSlug: group.sourceSlug,
        sourceTitle: source.title,
        sourceImage: source.thumbnailImage ?? source.sourceImage,
        sourceImageAlt: source.sourceImageAlt,
      }));
    })
    .sort((a, b) => (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? ''));
}
