import sharp from 'sharp';
import { extractStyleGalleryVisualEmbedding, extractStyleGalleryVisualEmbeddingBatch } from './style-gallery-visual-embedding';
import { createStyleGalleryVisualFeature, type StyleGalleryVisualRasterSamples } from './style-gallery-visual-feature';
import type { StyleGalleryVisualFeature } from './style-gallery-visual-types';

/** Node 上传/迁移路径从同一份原始字节计算特征，避免图片在首次哈希后被替换造成索引与对象不一致。 */
export async function computeStyleGalleryVisualFeatureFromBytes(
  bytes: Uint8Array,
  imageHash: string,
): Promise<StyleGalleryVisualFeature> {
  const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoded = await decodeNodeVisualInputs(input);
  const embedding = await extractStyleGalleryVisualEmbedding(new Blob([Uint8Array.from(decoded.embeddingImage).buffer]));
  return createStyleGalleryVisualFeature(imageHash, decoded.samples, embedding);
}

/** 离线重建按小批量执行一次 ONNX 前向；每张图片的解码、哈希和最终存储格式与在线上传路径完全相同。 */
export async function computeStyleGalleryVisualFeaturesFromBytes(
  inputs: readonly { bytes: Uint8Array; imageHash: string }[],
): Promise<StyleGalleryVisualFeature[]> {
  if (!inputs.length) return [];
  const decoded = await Promise.all(
    inputs.map(({ bytes }) => decodeNodeVisualInputs(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))),
  );
  const embeddings = await extractStyleGalleryVisualEmbeddingBatch(
    decoded.map(({ embeddingImage }) => new Blob([Uint8Array.from(embeddingImage).buffer])),
  );
  return inputs.map(({ imageHash }, index) =>
    createStyleGalleryVisualFeature(imageHash, decoded[index].samples, embeddings[index]),
  );
}

async function decodeNodeVisualInputs(
  input: Buffer,
): Promise<{ embeddingImage: Uint8Array; samples: StyleGalleryVisualRasterSamples }> {
  // 浏览器的 alpha:false Canvas 会把透明像素铺成黑色；Node 路径必须显式使用同一背景，
  // 否则 PNG 隐藏 RGB 会让上传时索引与浏览器查询得到不同的 hash、调色盘和 embedding。
  const image = sharp(input)
    .rotate()
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .removeAlpha();
  const [gray32, gray9x8, rgb64, embeddingImage] = await Promise.all([
    image.clone().resize(32, 32, { fit: 'fill' }).greyscale().raw().toBuffer(),
    image.clone().resize(9, 8, { fit: 'fill' }).greyscale().raw().toBuffer(),
    image.clone().resize(64, 64, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true }),
    // DINO 最终只接收 224px crop；先在 sharp 中压到固定尺寸，避免 ONNX 路径再次解码数十 MB 原图。
    image
      .clone()
      .resize(224, 224, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 90 })
      .toBuffer(),
  ]);
  if (rgb64.info.channels < 3) throw new Error('Decoded visual search image does not contain RGB channels.');
  const rgb = new Uint8Array(64 * 64 * 3);
  for (let source = 0, target = 0; source < rgb64.data.length; source += rgb64.info.channels, target += 3) {
    rgb[target] = rgb64.data[source];
    rgb[target + 1] = rgb64.data[source + 1];
    rgb[target + 2] = rgb64.data[source + 2];
  }
  return {
    embeddingImage: Uint8Array.from(embeddingImage),
    samples: { gray32: Uint8Array.from(gray32), gray9x8: Uint8Array.from(gray9x8), rgb64: rgb },
  };
}
