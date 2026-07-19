/** 一个 prompt item 所引用的原图；多图会按用户单次输入顺序排列。 */
export interface StyleGalleryImageRef {
  sourceImage: string;
  thumbnailImage?: string;
  sourceImageAlt?: string;
  imageHash: string;
}

/** Sub-gallery 中一张生成示例的持久化元数据；图片字节单独存放在 HF。 */
export interface StyleGalleryExample {
  id: string;
  src: string;
  alt: string;
  model: string;
  note?: string;
  uploadedAt: string;
  imageHash: string;
}

/**
 * HF `items/<slug>.json` 的完整详情数据。
 *
 * `examples` 只保存在 item 详情中，不写入列表 catalog，避免示例增长拖慢 Gallery 首页。
 */
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

/** 详情页使用的数据，在持久化 item 上补充 catalog 顶层共享配置。 */
export interface StyleGalleryItem extends StoredStyleGalleryItem {
  tags: string[];
  modelTargets: string[];
}

/**
 * `metadata/catalog.json` 中的列表页最小条目。
 * 完整 prompt 保留在此处以支持无需额外请求的搜索和复制；示例仅记录数量，不展开元数据。
 */
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

/** Gallery 首页、图片矩阵和服务端检索共享的轻量索引。 */
export interface StyleGalleryCatalog {
  version: 3;
  updatedAt: string;
  tags: string[];
  modelTargets: string[];
  items: StyleGalleryCatalogItem[];
}

/** Sub-gallery 总览所需的最小示例字段，不包含 item 详情中的冗余字段。 */
export interface StyleGalleryExampleIndexEntry {
  id: string;
  src: string;
  model: string;
  note?: string;
  uploadedAt: string;
}

/** 按来源 item 聚合示例，使总览可以恢复原图与 prompt 入口。 */
export interface StyleGalleryExampleIndexGroup {
  sourceSlug: string;
  examples: StyleGalleryExampleIndexEntry[];
}

/** HF `examples/index.json` 的结构，只服务跨 item 的 Sub-gallery 总览。 */
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
