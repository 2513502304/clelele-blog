import type { StyleGalleryPlatformLabel } from '@/lib/style-gallery-platforms';

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
  model: StyleGalleryPlatformLabel;
  note?: string;
  uploadedAt: string;
  imageHash: string;
}

/** 页面展示用的示例数据；点赞数由独立的 HF 点赞索引在读取时合并，不写回示例元数据。 */
export interface StyleGalleryExampleView extends StyleGalleryExample {
  likeCount: number;
}

/** 同一参考图片下的一份可复用 prompt，以及生成它时可公开展示的来源信息。 */
export interface StyleGalleryPromptVariant {
  /** 规范化 prompt 文本的 SHA-256；用于幂等追加，不作为图片 item 身份。 */
  id: string;
  prompt: string;
  model?: string;
  originalPrompt?: string;
  importedAt: string;
  sourceSession?: string;
  sourceLine?: number;
}

/**
 * HF `items/<slug>.json` 的完整详情数据。
 *
 * `examples` 只保存在 item 详情中，不写入列表 catalog，避免示例增长拖慢 Gallery 首页。
 */
export interface StoredStyleGalleryItem {
  version: 4;
  slug: string;
  title: string;
  date: string;
  updated?: string;
  sourceImage: string;
  thumbnailImage?: string;
  sourceImageAlt?: string;
  /** 首项是默认 prompt；后续导入只追加不同文本，不改变既有默认值。 */
  prompts: StyleGalleryPromptVariant[];
  imageHash: string;
  images: StyleGalleryImageRef[];
  draft?: boolean;
  examples: StyleGalleryExample[];
}

/** 详情页使用的数据，在持久化 item 上补充 catalog 顶层共享配置。 */
export interface StyleGalleryItem extends Omit<StoredStyleGalleryItem, 'examples'> {
  /** 默认 prompt 的兼容读取字段，避免非切换型入口重复选择首项。 */
  prompt: string;
  promptRevision: string;
  originalPrompt?: string;
  tags: string[];
  modelTargets: StyleGalleryPlatformLabel[];
  examples: StyleGalleryExampleView[];
}

/**
 * `metadata/catalog.json` 中的列表页最小条目。
 * 默认 prompt 用于卡片渲染和直接复制；额外候选只保留搜索文本，模型与来源按需读取详情 item。
 */
export interface StyleGalleryCatalogItem {
  slug: string;
  title: string;
  date: string;
  sourceImage: string;
  thumbnailImage?: string;
  sourceImageAlt?: string;
  prompt: string;
  /** 除默认 prompt 外的候选全文，仅供列表页本地搜索；来源、模型等详情仍按需读取 item。 */
  additionalPrompts: string[];
  /** 详情 item 中可切换的 prompt 数量。 */
  promptCount: number;
  /** Prompt 文本及公开来源元数据的内容修订号，用于按需请求的缓存失效。 */
  promptRevision: string;
  imageHash: string;
  imageCount: number;
  exampleCount: number;
}

/** Gallery 首页、图片矩阵和服务端检索共享的轻量索引。 */
export interface StyleGalleryCatalog {
  version: 4;
  updatedAt: string;
  tags: string[];
  modelTargets: StyleGalleryPlatformLabel[];
  items: StyleGalleryCatalogItem[];
}

/** Sub-gallery 总览所需的最小示例字段，不包含 item 详情中的冗余字段。 */
export interface StyleGalleryExampleIndexEntry {
  id: string;
  src: string;
  model: StyleGalleryPlatformLabel;
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
  /** 当前原图下所有生成示例的点赞总和。 */
  likeCount: number;
}

export interface StyleGalleryExampleOverviewItem extends Omit<StyleGalleryExampleIndexEntry, 'likedBy'> {
  sourceSlug: string;
  sourceTitle: string;
  sourceImage: string;
  sourceImageAlt?: string;
  sourceExampleCount: number;
  sourcePromptCount: number;
  sourcePromptRevision: string;
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
