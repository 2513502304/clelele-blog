import sharp from 'sharp';
import type { StyleGalleryImageDimensions } from '@/types/style-gallery';

/**
 * libwebp requires complete pixel chunks even for Sharp.metadata(). Read the fixed
 * RIFF canvas header for range requests instead. EXIF-bearing files must fall back
 * to the full decoder because orientation metadata can follow the pixel payload.
 * Format: https://developers.google.com/speed/webp/docs/riff_container
 */
export function readWebpHeaderDimensions(bytes: Uint8Array): StyleGalleryImageDimensions | undefined {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return;
  switch (buffer.toString('ascii', 12, 16)) {
    case 'VP8X':
      if (buffer[20] & 0x08) return;
      return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
    case 'VP8L': {
      if (buffer[20] !== 0x2f) return;
      const bits = buffer.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    case 'VP8 ':
      if (buffer.toString('hex', 23, 26) !== '9d012a') return;
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
}

/** Read headers only; mirror browser EXIF rotation without decoding the full image. */
export async function readStyleGalleryImageDimensions(input: string | Uint8Array): Promise<StyleGalleryImageDimensions> {
  const metadata = await sharp(input).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Image dimensions are missing.');
  const rotated = (metadata.orientation ?? 1) >= 5;
  return {
    width: rotated ? metadata.height : metadata.width,
    height: rotated ? metadata.width : metadata.height,
  };
}
