import { STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION, STYLE_GALLERY_VISUAL_MODEL_ID } from './style-gallery-visual-types';

let extractorPromise: ReturnType<typeof createExtractor> | null = null;

async function createExtractor() {
  const { env, pipeline } = await import('@huggingface/transformers');
  if (typeof window === 'undefined') env.cacheDir = '.cache/transformers';
  return pipeline('image-feature-extraction', STYLE_GALLERY_VISUAL_MODEL_ID, {
    // q8 显著减小首次下载和常驻内存；向量最终还会按单位向量 int8 量化，因此不会引入额外索引体积。
    dtype: 'q8',
  });
}

/**
 * 模型只在用户发起以图搜图或上传图片时按需加载。普通 Gallery 浏览不会下载约几十 MB 的 ONNX；
 * 浏览器 Cache Storage 与 Node 的 `.cache/transformers` 会复用权重，单个页面会话只创建一个 pipeline。
 */
async function getExtractor(): ReturnType<typeof createExtractor> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const pending = extractorPromise ?? createExtractor();
    extractorPromise = pending;
    try {
      return await pending;
    } catch (error) {
      // 不缓存 rejected Promise：模型权重首次下载的短暂网络错误必须允许当前操作自动重试，之后也能手动重试。
      if (extractorPromise === pending) extractorPromise = null;
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error('Failed to initialize the visual search model.');
}

/**
 * DINOv2 的首个 token 是整图 CLS 表征；patch token 不写入索引，否则每图体积会扩大约 257 倍。
 * 批处理只用于离线迁移等受控路径，避免逐图重复执行 ONNX 调度；浏览器单图查询仍走同一实现。
 */
export async function extractStyleGalleryVisualEmbeddingBatch(images: readonly Blob[]): Promise<Float32Array[]> {
  if (!images.length) return [];
  const extractor = await getExtractor();
  const output = await extractor(images.length === 1 ? images[0] : [...images]);
  const width = output.dims.at(-1);
  if (
    width !== STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION ||
    output.data.length < width ||
    output.data.length % images.length !== 0
  ) {
    throw new Error(`Unexpected visual embedding shape: [${output.dims.join(', ')}].`);
  }
  const sampleStride = output.data.length / images.length;
  return images.map((_, index) => Float32Array.from(output.data.slice(index * sampleStride, index * sampleStride + width)));
}

export async function extractStyleGalleryVisualEmbedding(image: Blob): Promise<Float32Array> {
  return (await extractStyleGalleryVisualEmbeddingBatch([image]))[0];
}
