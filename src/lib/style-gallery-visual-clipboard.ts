const STYLE_GALLERY_QUERY_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

interface ClipboardImageData {
  files: ArrayLike<File>;
  items: ArrayLike<Pick<DataTransferItem, 'kind' | 'type' | 'getAsFile'>>;
}

export type StyleGalleryClipboardImageResult =
  | { status: 'accepted'; file: File }
  | { status: 'unsupported'; mimeType: string }
  | { status: 'empty' };

/**
 * 从系统剪贴板选择第一张可用于视觉检索的图片。优先读取 DataTransferItem，兼容浏览器仅暴露
 * files 的实现；非图片内容保持原生粘贴行为，存在图片但格式不支持时返回明确状态供 UI 提示。
 */
export function getStyleGalleryClipboardImage(data: ClipboardImageData): StyleGalleryClipboardImageResult {
  const candidates: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file?.type.startsWith('image/')) candidates.push(file);
  }
  if (candidates.length === 0) {
    candidates.push(...Array.from(data.files).filter((file) => file.type.startsWith('image/')));
  }

  const accepted = candidates.find((file) => STYLE_GALLERY_QUERY_IMAGE_TYPES.has(file.type.toLowerCase()));
  if (accepted) return { status: 'accepted', file: accepted };
  const unsupported = candidates[0];
  return unsupported ? { status: 'unsupported', mimeType: unsupported.type } : { status: 'empty' };
}
