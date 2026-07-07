import { type CollectionEntry, getCollection } from 'astro:content';
import type { StyleGalleryCardData, StyleGalleryItem } from '@/types/style-gallery';

export async function getStyleGalleryItems(): Promise<StyleGalleryItem[]> {
  const items = await getCollection('styleGallery', ({ data }) => {
    return import.meta.env.PROD ? data.draft !== true : true;
  });

  return [...items].sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export async function getStyleGalleryItemBySlug(slug: string): Promise<StyleGalleryItem | undefined> {
  const items = await getStyleGalleryItems();
  return items.find((item) => item.id.replace(/\.(md|mdx)$/, '') === slug);
}

export async function getStyleGalleryItemById(id: string): Promise<StyleGalleryItem | undefined> {
  const items = await getStyleGalleryItems();
  return items.find((item) => item.id === id);
}

export function getStyleGallerySlug(item: CollectionEntry<'styleGallery'>): string {
  return item.id.replace(/\.(md|mdx)$/, '');
}

export function getAllStyleGalleryTags(items: StyleGalleryItem[]): string[] {
  return [...new Set(items.flatMap((item) => item.data.tags ?? []))].sort((a, b) => a.localeCompare(b));
}

export function toStyleGalleryCardData(item: StyleGalleryItem): StyleGalleryCardData {
  return {
    slug: getStyleGallerySlug(item),
    title: item.data.title,
    prompt: item.data.prompt,
    date: item.data.date,
    sourceImage: item.data.sourceImage,
    thumbnailImage: item.data.thumbnailImage,
    sourceImageAlt: item.data.sourceImageAlt,
    imageHash: item.data.imageHash,
    imageCount: item.data.images?.length ?? 1,
    tags: item.data.tags ?? [],
    modelTargets: item.data.modelTargets ?? [],
    exampleCount: item.data.examples?.length ?? 0,
  };
}

export function toStyleGalleryCardDataList(items: StyleGalleryItem[]): StyleGalleryCardData[] {
  return items.map(toStyleGalleryCardData);
}
