/** Small immutable references travel with the document; full images remain in IndexedDB. */
export const BACKGROUND_LIMIT = 12;
export const BACKGROUND_BYTE_LIMIT = 100 * 1024 * 1024;
export function mergeBackgrounds(...groups) {
  const entries = new Map();
  for (const group of groups) for (const item of group || []) {
    if (!item || typeof item.assetId !== 'string' || !item.assetId) continue;
    const { assetId, name, size, width, height, scale, x, y } = item;
    entries.set(assetId, { ...entries.get(assetId), assetId, name: name || '上传的图片',
      ...(Number.isFinite(size) && size >= 0 ? { size } : {}), ...(width > 0 && height > 0 ? { width, height } : {}),
      scale: Number.isFinite(scale) ? scale : 1, x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 });
  }
  return [...entries.values()];
}

export async function backgroundThumbnail(image) {
  const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 104;
  const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  canvas.getContext('2d').drawImage(image, (160 - image.naturalWidth * scale) / 2, (104 - image.naturalHeight * scale) / 2, image.naturalWidth * scale, image.naturalHeight * scale);
  try { return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法创建背景预览。')), 'image/webp', .78)); }
  finally { canvas.width = canvas.height = 1; }
}

/** Thumbnail reads never decode the original. Row identity survives selection/crop changes. */
export function createBackgroundLibrary({ root, storage, onUse, onDelete, onError }) {
  const rows = new Map(); let disposed = false;
  function remove(id) {
    const row = rows.get(id); if (!row) return;
    rows.delete(id); row.element.remove(); if (row.url) URL.revokeObjectURL(row.url);
  }
  return {
    render(items, activeId) {
      if (disposed) return;
      for (const id of rows.keys()) if (!items.some(item => item.assetId === id)) remove(id);
      for (const [index, item] of items.entries()) {
        let row = rows.get(item.assetId);
        if (!row) {
          const element = document.createElement('div'); element.className = 'background-asset'; element.dataset.backgroundAsset = item.assetId;
          const use = document.createElement('button'); use.type = 'button'; use.className = 'background-asset-use';
          const thumb = document.createElement('span'); thumb.className = 'background-asset-thumb'; thumb.textContent = '▧';
          const name = document.createElement('span'); name.className = 'background-asset-name';
          const deleteButton = document.createElement('button'); deleteButton.type = 'button'; deleteButton.className = 'background-asset-delete'; deleteButton.textContent = '移除';
          use.append(thumb, name); element.append(use, deleteButton);
          row = { element, use, thumb, name, deleteButton }; rows.set(item.assetId, row); root.append(element);
          use.onclick = () => Promise.resolve(onUse(item.assetId)).catch(onError);
          deleteButton.onclick = () => onDelete(item.assetId);
          storage.read('thumbnail:' + item.assetId).then(blob => {
            if (!blob || disposed || rows.get(item.assetId) !== row) return;
            const image = document.createElement('img'); image.alt = ''; image.decoding = 'async'; image.width = 160; image.height = 104;
            row.url = URL.createObjectURL(blob); image.src = row.url; thumb.replaceChildren(image);
          }).catch(() => {}); // Old drafts may have no thumbnail; their source is loaded only on selection.
        }
        row.name.textContent = item.name; row.use.title = item.name; row.use.setAttribute('aria-label', `使用背景：${item.name}`);
        row.use.setAttribute('aria-pressed', String(item.assetId === activeId)); row.deleteButton.disabled = item.assetId !== activeId;
        row.deleteButton.setAttribute('aria-label', `移除背景素材：${item.name}`);
        if (root.children[index] !== row.element) root.insertBefore(row.element, root.children[index] || null);
      }
      root.hidden = !items.length;
    },
    dispose() { disposed = true; for (const id of rows.keys()) remove(id); },
  };
}
