import { extractStyleGalleryVisualEmbedding } from './style-gallery-visual-embedding';
import {
  convertInterleavedRgbToGrayscale,
  createStyleGalleryVisualFeature,
  extractInterleavedRgb,
  type StyleGalleryVisualRasterSamples,
} from './style-gallery-visual-feature';
import type { StyleGalleryVisualFeature } from './style-gallery-visual-types';

/** 浏览器端直接处理本地文件，查询图片不会上传到 Vercel；只有约 1 KB 的量化特征会发送给搜索 API。 */
export async function computeStyleGalleryVisualFeatureFromFile(
  file: File,
  imageHash?: string,
): Promise<StyleGalleryVisualFeature> {
  const [hash, decoded] = await Promise.all([
    imageHash ? Promise.resolve(imageHash) : sha256File(file),
    decodeBrowserRasterSamples(file),
  ]);
  const embedding = await extractStyleGalleryVisualEmbedding(decoded.embeddingImage);
  return createStyleGalleryVisualFeature(hash, decoded.samples, embedding);
}

async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function decodeBrowserRasterSamples(
  file: File,
): Promise<{ embeddingImage: Blob; samples: StyleGalleryVisualRasterSamples }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      return { embeddingImage: await createEmbeddingImage(bitmap), samples: createRasterSamples(bitmap) };
    } finally {
      bitmap.close();
    }
  }

  // Safari 旧版本没有 createImageBitmap；对象 URL 只在本地解码期间存在，仍不会把查询图片上传到服务端。
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    return { embeddingImage: await createEmbeddingImage(image), samples: createRasterSamples(image) };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function createRasterSamples(image: CanvasImageSource): StyleGalleryVisualRasterSamples {
  return {
    gray32: drawPixels(image, 32, 32, true),
    gray9x8: drawPixels(image, 9, 8, true),
    rgb64: drawPixels(image, 64, 64, false),
  };
}

async function createEmbeddingImage(image: ImageBitmap | HTMLImageElement): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 224;
  canvas.height = 224;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas 2D is unavailable for visual search.');
  const sourceWidth = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
  const sourceHeight = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
  const scale = Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('Failed to prepare the visual search model input.');
  return blob;
}

function drawPixels(image: CanvasImageSource, width: number, height: number, grayscale: true): Uint8Array;
function drawPixels(image: CanvasImageSource, width: number, height: number, grayscale: false): Uint8Array;
function drawPixels(image: CanvasImageSource, width: number, height: number, grayscale: boolean): Uint8Array {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D is unavailable for visual search.');
  context.drawImage(image, 0, 0, width, height);
  const rgba = context.getImageData(0, 0, width, height).data;
  return grayscale ? convertInterleavedRgbToGrayscale(rgba, 4) : extractInterleavedRgb(rgba, 4);
}
