// 单文件上限由服务端组合时的内存占用和当前产品需求控制，而不是 Vercel 单请求体上限。
export const MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE = 12 * 1024 * 1024;
// 每块 4 MiB，为请求头留出余量，避免触发 Vercel Function 约 4.5 MB 的请求体上限。
export const STYLE_GALLERY_UPLOAD_CHUNK_SIZE = 4 * 1024 * 1024;
export const MAX_STYLE_GALLERY_UPLOAD_PARTS = Math.ceil(MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE / STYLE_GALLERY_UPLOAD_CHUNK_SIZE);

const UPLOAD_ID_PATTERN = /^[a-f0-9]{32}$/;

export function normalizeStyleGalleryUploadId(uploadId: string): string {
  return uploadId.replaceAll('-', '').toLowerCase();
}

export function isStyleGalleryUploadId(uploadId: string): boolean {
  return UPLOAD_ID_PATTERN.test(normalizeStyleGalleryUploadId(uploadId));
}

/** 根据完整文件大小计算严格的分块数量，服务端完成阶段会用它校验 manifest。 */
export function getStyleGalleryUploadPartCount(fileSize: number): number {
  if (!Number.isInteger(fileSize) || fileSize < 1 || fileSize > MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE) {
    throw new RangeError('Invalid style gallery upload size.');
  }
  return Math.ceil(fileSize / STYLE_GALLERY_UPLOAD_CHUNK_SIZE);
}

/** 临时分块只写入隔离目录，完成校验后再组合到内容哈希命名的正式对象。 */
export function getStyleGalleryUploadPartKey(uploadId: string, partIndex: number): string {
  const normalizedUploadId = normalizeStyleGalleryUploadId(uploadId);
  if (!UPLOAD_ID_PATTERN.test(normalizedUploadId)) throw new Error('Invalid style gallery upload ID.');
  if (!Number.isInteger(partIndex) || partIndex < 0 || partIndex >= MAX_STYLE_GALLERY_UPLOAD_PARTS) {
    throw new RangeError('Invalid style gallery upload part index.');
  }
  return `examples/uploads/${normalizedUploadId}/${partIndex.toString().padStart(2, '0')}.part`;
}
