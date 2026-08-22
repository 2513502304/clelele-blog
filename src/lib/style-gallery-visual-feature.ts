import {
  STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION,
  STYLE_GALLERY_VISUAL_PALETTE_SIZE,
  type StyleGalleryVisualFeature,
} from './style-gallery-visual-types';

const PHASH_SIZE = 32;
const PHASH_COMPONENTS = 8;
const DHASH_WIDTH = 9;
const DHASH_HEIGHT = 8;
const PALETTE_CHANNEL_BUCKETS = 16;

export interface StyleGalleryVisualRasterSamples {
  gray32: Uint8Array;
  gray9x8: Uint8Array;
  rgb64: Uint8Array;
}

/** 浏览器和 Node 图像解码器共用的纯计算入口，保证三条上传路径生成完全相同的特征格式。 */
export function createStyleGalleryVisualFeature(
  imageHash: string,
  samples: StyleGalleryVisualRasterSamples,
  embedding: Float32Array,
): StyleGalleryVisualFeature {
  if (!/^[a-f0-9]{64}$/i.test(imageHash)) throw new Error('Visual feature image hash must be a SHA-256 value.');
  if (samples.gray32.length !== PHASH_SIZE * PHASH_SIZE) throw new Error('pHash input must contain 32x32 pixels.');
  if (samples.gray9x8.length !== DHASH_WIDTH * DHASH_HEIGHT) throw new Error('dHash input must contain 9x8 pixels.');
  if (samples.rgb64.length !== 64 * 64 * 3) throw new Error('Palette input must contain 64x64 RGB pixels.');
  return {
    imageHash: imageHash.toLowerCase(),
    perceptualHash: computePerceptualHash(samples.gray32),
    differenceHash: computeDifferenceHash(samples.gray9x8),
    palette: encodePalette(computeDominantPalette(samples.rgb64)),
    embedding: encodeQuantizedEmbedding(embedding),
  };
}

/** 64 位 pHash 对缩放和有损压缩稳定，用于优先召回同图的不同尺寸或编码版本。 */
export function computePerceptualHash(gray: Uint8Array): string {
  const coefficients: number[] = [];
  for (let u = 0; u < PHASH_COMPONENTS; u += 1) {
    for (let v = 0; v < PHASH_COMPONENTS; v += 1) {
      let sum = 0;
      for (let x = 0; x < PHASH_SIZE; x += 1) {
        const cosX = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * PHASH_SIZE));
        for (let y = 0; y < PHASH_SIZE; y += 1) {
          sum += gray[y * PHASH_SIZE + x] * cosX * Math.cos(((2 * y + 1) * v * Math.PI) / (2 * PHASH_SIZE));
        }
      }
      coefficients.push(sum);
    }
  }
  const comparable = coefficients.slice(1).sort((a, b) => a - b);
  const median = comparable[Math.floor(comparable.length / 2)] ?? 0;
  return bitsToHex(coefficients.map((value, index) => index === 0 || value >= median));
}

/** dHash 补充检测边缘布局变化；与 pHash 联用，避免仅凭单一哈希误判。 */
export function computeDifferenceHash(gray: Uint8Array): string {
  const bits: boolean[] = [];
  for (let y = 0; y < DHASH_HEIGHT; y += 1) {
    for (let x = 0; x < DHASH_WIDTH - 1; x += 1) {
      bits.push(gray[y * DHASH_WIDTH + x] > gray[y * DHASH_WIDTH + x + 1]);
    }
  }
  return bitsToHex(bits);
}

/**
 * 用固定 12-bit RGB 直方图提取主色，而不是保存任意长度的 K-means 结果。该算法确定、快速且跨运行时一致；
 * 每组颜色保留实际桶内均值，以及它在六个候选主色中的相对权重，足以支持感知色差范围筛选。
 */
export function computeDominantPalette(rgb: Uint8Array): Array<[number, number, number, number]> {
  const buckets = new Map<number, { count: number; red: number; green: number; blue: number }>();
  for (let index = 0; index < rgb.length; index += 3) {
    const red = rgb[index];
    const green = rgb[index + 1];
    const blue = rgb[index + 2];
    const key =
      (Math.floor((red * PALETTE_CHANNEL_BUCKETS) / 256) << 8) |
      (Math.floor((green * PALETTE_CHANNEL_BUCKETS) / 256) << 4) |
      Math.floor((blue * PALETTE_CHANNEL_BUCKETS) / 256);
    const current = buckets.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
    current.count += 1;
    current.red += red;
    current.green += green;
    current.blue += blue;
    buckets.set(key, current);
  }
  const selected = [...buckets.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, STYLE_GALLERY_VISUAL_PALETTE_SIZE);
  const selectedCount = selected.reduce((sum, bucket) => sum + bucket.count, 0) || 1;
  const palette = selected.map((bucket): [number, number, number, number] => [
    Math.round(bucket.red / bucket.count),
    Math.round(bucket.green / bucket.count),
    Math.round(bucket.blue / bucket.count),
    Math.max(1, Math.round((bucket.count / selectedCount) * 255)),
  ]);
  while (palette.length < STYLE_GALLERY_VISUAL_PALETTE_SIZE) palette.push([0, 0, 0, 0]);
  return palette;
}

export function encodePalette(palette: ReadonlyArray<readonly [number, number, number, number]>): string {
  if (palette.length !== STYLE_GALLERY_VISUAL_PALETTE_SIZE) throw new Error('Visual palette has an invalid size.');
  return bytesToBase64(Uint8Array.from(palette.flat()));
}

export function decodePalette(value: string): Array<[number, number, number, number]> {
  const bytes = base64ToBytes(value);
  if (bytes.length !== STYLE_GALLERY_VISUAL_PALETTE_SIZE * 4) throw new Error('Visual palette has an invalid encoding.');
  return Array.from({ length: STYLE_GALLERY_VISUAL_PALETTE_SIZE }, (_, index) => [
    bytes[index * 4],
    bytes[index * 4 + 1],
    bytes[index * 4 + 2],
    bytes[index * 4 + 3],
  ]);
}

/** 单位向量量化为 int8；base64 中保存原始补码字节，避免 JSON 数字数组约 3 倍的体积。 */
export function encodeQuantizedEmbedding(embedding: Float32Array): string {
  if (embedding.length !== STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION) {
    throw new Error(`Visual embedding must contain ${STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION} dimensions.`);
  }
  let squaredNorm = 0;
  for (const value of embedding) squaredNorm += value * value;
  const norm = Math.sqrt(squaredNorm);
  if (!Number.isFinite(norm) || norm === 0) throw new Error('Visual embedding must contain a non-zero finite vector.');
  const bytes = new Uint8Array(embedding.length);
  for (let index = 0; index < embedding.length; index += 1) {
    const quantized = Math.max(-127, Math.min(127, Math.round((embedding[index] / norm) * 127)));
    bytes[index] = quantized < 0 ? quantized + 256 : quantized;
  }
  return bytesToBase64(bytes);
}

export function decodeQuantizedEmbedding(value: string): Int8Array {
  const bytes = base64ToBytes(value);
  if (bytes.length !== STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION) {
    throw new Error('Visual embedding has an invalid encoding.');
  }
  return new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function hammingDistance(left: string, right: string): number {
  if (!/^[a-f0-9]{16}$/i.test(left) || !/^[a-f0-9]{16}$/i.test(right)) return 64;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    let value = Number.parseInt(left[index], 16) ^ Number.parseInt(right[index], 16);
    while (value) {
      distance += value & 1;
      value >>>= 1;
    }
  }
  return distance;
}

function bitsToHex(bits: readonly boolean[]): string {
  let output = '';
  for (let offset = 0; offset < bits.length; offset += 4) {
    let nibble = 0;
    for (let bit = 0; bit < 4; bit += 1) nibble = (nibble << 1) | (bits[offset + bit] ? 1 : 0);
    output += nibble.toString(16);
  }
  return output;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
