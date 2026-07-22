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

/** 页面展示用的示例数据；点赞数由独立的 HF 点赞索引在读取时合并，不写回示例元数据。 */
export interface StyleGalleryExampleView extends StyleGalleryExample {
  likeCount: number;
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
export interface StyleGalleryItem extends Omit<StoredStyleGalleryItem, 'examples'> {
  tags: string[];
  modelTargets: string[];
  examples: StyleGalleryExampleView[];
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
  /** GitHub 数字用户 ID；数组本身是“一位用户一票”的唯一事实源。 */
  likedBy: number[];
}

/** 按来源 item 聚合示例，使总览可以恢复原图与 prompt 入口。 */
export interface StyleGalleryExampleIndexGroup {
  sourceSlug: string;
  examples: StyleGalleryExampleIndexEntry[];
}

/** HF `examples/index-v2.json` 的结构，统一服务 Sub-gallery 总览与点赞。 */
export interface StyleGalleryExampleIndex {
  version: 2;
  updatedAt: string;
  groups: StyleGalleryExampleIndexGroup[];
}

export interface StyleGalleryCardData extends StyleGalleryCatalogItem {
  tags: string[];
  modelTargets: string[];
  /** 当前原图下所有生成示例的点赞总和。 */
  likeCount: number;
}

export interface StyleGalleryExampleOverviewItem extends Omit<StyleGalleryExampleIndexEntry, 'likedBy'> {
  sourceSlug: string;
  sourceTitle: string;
  sourceImage: string;
  sourceImageAlt?: string;
  sourceExampleCount: number;
  likeCount: number;
}

/** GitHub 登录用户在点赞会话中公开给前端的最小资料。 */
export interface StyleGalleryViewer {
  id: number;
  login: string;
  name?: string;
  avatarUrl: string;
  profileUrl: string;
}
