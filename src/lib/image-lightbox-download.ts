export interface ImageLightboxDownloadAction {
  href: string;
  filename?: string;
  opensExternally: boolean;
}

function getFilename(src: string): string {
  if (src.startsWith('blob:') || src.startsWith('data:')) return 'image';
  const filename = src.split(/[?#]/, 1)[0].split('/').at(-1);
  if (!filename) return 'image';
  try {
    return decodeURIComponent(filename);
  } catch {
    return filename;
  }
}

/**
 * Gallery API 能返回 attachment；同源、blob 与 data URL 可用浏览器 download。
 * 跨域服务器通常会让浏览器忽略 download 属性，因此明确改为新标签打开原图。
 */
export function createImageLightboxDownloadAction(
  src: string,
  currentOrigin = typeof window === 'undefined' ? '' : window.location.origin,
): ImageLightboxDownloadAction {
  if (src.startsWith('/api/style-gallery/image/')) {
    const [withoutHash, hash = ''] = src.split('#', 2);
    return {
      href: `${withoutHash}${withoutHash.includes('?') ? '&' : '?'}download=1${hash ? `#${hash}` : ''}`,
      filename: getFilename(src),
      opensExternally: false,
    };
  }

  if (src.startsWith('blob:') || src.startsWith('data:') || src.startsWith('/')) {
    return { href: src, filename: getFilename(src), opensExternally: false };
  }

  try {
    const url = new URL(src, currentOrigin || 'http://localhost');
    if (currentOrigin && url.origin === currentOrigin) {
      return { href: src, filename: getFilename(src), opensExternally: false };
    }
  } catch {
    return { href: src, filename: getFilename(src), opensExternally: false };
  }

  return { href: src, opensExternally: true };
}
