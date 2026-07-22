/**
 * 单次 API 请求的条目上限，而不是用户一次操作的总量上限。
 * 客户端会自动拆批，服务端保留边界以控制校验并发和请求体大小。
 */
export const STYLE_GALLERY_PREPARE_BATCH_SIZE = 32;
export const STYLE_GALLERY_MUTATION_BATCH_SIZE = 128;

export function chunkStyleGalleryRequestItems<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('Style gallery request batch size must be positive.');
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}
