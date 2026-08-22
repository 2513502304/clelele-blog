/** Gallery 视觉检索模型。修改模型或维度必须重建整个派生索引，禁止混写不同向量空间。 */
export const STYLE_GALLERY_VISUAL_MODEL_ID = 'Xenova/dinov2-small';
export const STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION = 384;
export const STYLE_GALLERY_VISUAL_INDEX_VERSION = 1 as const;
export const STYLE_GALLERY_VISUAL_PALETTE_SIZE = 6;

export type StyleGalleryVisualImageKind = 'source' | 'example';
export type StyleGalleryVisualSearchMode = 'combined' | 'near-duplicate' | 'semantic' | 'palette';
export type StyleGalleryVisualSearchScope = 'source' | 'example';
/** 0 表示最严格、100 表示召回最宽；50 对应经过现有图库校准的推荐范围。 */
export type StyleGalleryVisualSearchRange = number;

/** 视觉筛选器的跨页面文案契约放在 lib 层，避免数据模块反向依赖 React 组件。 */
export interface StyleGalleryVisualFilterLabels {
  trigger: string;
  imageTab: string;
  paletteTab: string;
  chooseImage: string;
  combined: string;
  combinedHelp: string;
  nearDuplicate: string;
  nearDuplicateHelp: string;
  semantic: string;
  semanticHelp: string;
  range: string;
  rangePrecise: string;
  rangeBroad: string;
  rangeHelp: string;
  search: string;
  searching: string;
  reset: string;
  matches: string;
  failed: string;
}

/**
 * 一张唯一图片的视觉特征。embedding 是单位向量按 [-127, 127] 量化后的 base64 字节串；
 * palette 将 6 组 RGB + 权重编码为固定 24 字节。固定宽度便于严格校验和控制 HF 索引体积。
 */
export interface StyleGalleryVisualFeature {
  imageHash: string;
  perceptualHash: string;
  differenceHash: string;
  palette: string;
  embedding: string;
}

/**
 * 索引中的逻辑图片记录。相同字节可能被多个 item 引用，因此记录与特征分离：featureIndex 指向
 * `features`，sourceSlug/imageId 负责把检索结果映射回现有 catalog 或 example index。
 */
export interface StyleGalleryVisualRecord {
  featureIndex: number;
  kind: StyleGalleryVisualImageKind;
  sourceSlug: string;
  imageId: string;
}

/** 写 API 使用未压缩的 feature 引用；持久化时会按 imageHash 去重并转换为 featureIndex。 */
export interface StyleGalleryVisualRecordInput extends Omit<StyleGalleryVisualRecord, 'featureIndex'> {
  feature: StyleGalleryVisualFeature;
}

export interface StyleGalleryVisualIndex {
  version: typeof STYLE_GALLERY_VISUAL_INDEX_VERSION;
  updatedAt: string;
  model: {
    id: typeof STYLE_GALLERY_VISUAL_MODEL_ID;
    dimensions: typeof STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION;
    quantization: 'int8-unit';
  };
  features: StyleGalleryVisualFeature[];
  records: StyleGalleryVisualRecord[];
}

export interface StyleGalleryVisualSearchResult {
  kind: StyleGalleryVisualImageKind;
  sourceSlug: string;
  imageId: string;
  score: number;
}
