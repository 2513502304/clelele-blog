const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** 将浏览器 MIME 或文件名统一成 HF 正式对象使用的扩展名。 */
export function getStyleGalleryExampleExtension(contentType: string, fileName = ''): string {
  const contentTypeExtension = IMAGE_EXTENSIONS[contentType.toLowerCase()];
  if (contentTypeExtension) return contentTypeExtension;
  const match = fileName.toLowerCase().match(/\.(jpe?g|png|webp)$/);
  if (match?.[1]) return match[1] === 'jpeg' ? 'jpg' : match[1];
  throw new Error(`Unsupported image type: ${contentType || fileName}`);
}

/** direct 上传只发送由 prepare 扩展名反向确定的规范 MIME，避免依赖不稳定的 File.type。 */
export function getStyleGalleryExampleContentType(extension: string): string {
  const contentType = IMAGE_CONTENT_TYPES[extension.toLowerCase()];
  if (!contentType) throw new Error(`Unsupported image extension: ${extension}`);
  return contentType;
}
