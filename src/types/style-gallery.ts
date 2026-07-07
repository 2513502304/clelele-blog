import type { CollectionEntry } from 'astro:content';

export type StyleGalleryItem = CollectionEntry<'styleGallery'>;

export interface StyleGalleryImageRef {
  sourceImage: string;
  thumbnailImage?: string;
  sourceImageAlt?: string;
  imageHash: string;
}

export interface StyleGalleryExample {
  src: string;
  alt?: string;
  model?: string;
  note?: string;
  uploadedAt?: string;
  imageHash?: string;
}

export interface StyleGalleryCardData {
  slug: string;
  title: string;
  description?: string;
  date: Date;
  sourceImage: string;
  thumbnailImage?: string;
  sourceImageAlt?: string;
  imageHash: string;
  imageCount: number;
  tags: string[];
  modelTargets: string[];
  exampleCount: number;
}
