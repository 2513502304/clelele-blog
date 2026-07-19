// Keep each Function request comfortably below Vercel's 4.5 MB request-body limit.
export const MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE = 12 * 1024 * 1024;
export const STYLE_GALLERY_UPLOAD_CHUNK_SIZE = 4 * 1024 * 1024;
export const MAX_STYLE_GALLERY_UPLOAD_PARTS = Math.ceil(MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE / STYLE_GALLERY_UPLOAD_CHUNK_SIZE);

const UPLOAD_ID_PATTERN = /^[a-f0-9]{32}$/;

export function normalizeStyleGalleryUploadId(uploadId: string): string {
  return uploadId.replaceAll('-', '').toLowerCase();
}

export function isStyleGalleryUploadId(uploadId: string): boolean {
  return UPLOAD_ID_PATTERN.test(normalizeStyleGalleryUploadId(uploadId));
}

export function getStyleGalleryUploadPartCount(fileSize: number): number {
  if (!Number.isInteger(fileSize) || fileSize < 1 || fileSize > MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE) {
    throw new RangeError('Invalid style gallery upload size.');
  }
  return Math.ceil(fileSize / STYLE_GALLERY_UPLOAD_CHUNK_SIZE);
}

export function getStyleGalleryUploadPartKey(uploadId: string, partIndex: number): string {
  const normalizedUploadId = normalizeStyleGalleryUploadId(uploadId);
  if (!UPLOAD_ID_PATTERN.test(normalizedUploadId)) throw new Error('Invalid style gallery upload ID.');
  if (!Number.isInteger(partIndex) || partIndex < 0 || partIndex >= MAX_STYLE_GALLERY_UPLOAD_PARTS) {
    throw new RangeError('Invalid style gallery upload part index.');
  }
  return `examples/uploads/${normalizedUploadId}/${partIndex.toString().padStart(2, '0')}.part`;
}
