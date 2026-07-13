export interface StyleGalleryImageRef {
  sourceImage: string;
  thumbnailImage?: string;
  sourceImageAlt?: string;
  imageHash: string;
}

export interface StyleGalleryExample {
  id: string;
  src: string;
  alt: string;
  model: string;
  note?: string;
  uploadedAt: string;
  imageHash: string;
}

export interface StoredStyleGalleryItem {
  version: 3;
  slug: string;
  title: string;
  date: string;
  updated?: string;
  sourceImage: string;
  thumbnailImage?: string;
  sourceImageAlt?: string;
  prompt: string;
  originalPrompt?: string;
  imageHash: string;
  images: StyleGalleryImageRef[];
  sourceSession?: string;
  sourceLine?: number;
  draft?: boolean;
  examples: StyleGalleryExample[];
}

export interface StyleGalleryItem extends StoredStyleGalleryItem {
  tags: string[];
  modelTargets: string[];
}

export interface StyleGalleryCatalogItem {
  slug: string;
  title: string;
  date: string;
  sourceImage: string;
  thumbnailImage?: string;
  sourceImageAlt?: string;
  prompt: string;
  imageHash: string;
  imageCount: number;
  exampleCount: number;
}

export interface StyleGalleryCatalog {
  version: 3;
  updatedAt: string;
  tags: string[];
  modelTargets: string[];
  items: StyleGalleryCatalogItem[];
}

export interface StyleGalleryExampleIndexEntry {
  id: string;
  src: string;
  model: string;
  note?: string;
  uploadedAt: string;
}

export interface StyleGalleryExampleIndexGroup {
  sourceSlug: string;
  examples: StyleGalleryExampleIndexEntry[];
}

export interface StyleGalleryExampleIndex {
  version: 1;
  updatedAt: string;
  groups: StyleGalleryExampleIndexGroup[];
}

export interface StyleGalleryCardData extends StyleGalleryCatalogItem {
  tags: string[];
  modelTargets: string[];
}

export interface StyleGalleryExampleOverviewItem extends StyleGalleryExampleIndexEntry {
  sourceSlug: string;
  sourceTitle: string;
  sourceImage: string;
  sourceImageAlt?: string;
}
