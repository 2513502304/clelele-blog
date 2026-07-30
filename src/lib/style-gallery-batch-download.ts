export interface StyleGalleryDownloadItem {
  id: string;
  src: string;
}

export interface StyleGalleryBatchDownloadResult {
  downloaded: number;
  failed: StyleGalleryDownloadItem[];
}

interface StyleGalleryBatchDownloadOptions {
  concurrency?: number;
  attempts?: number;
  fetchImage?: typeof fetch;
  saveBlob?: (blob: Blob, filename: string) => void;
  onProgress?: (completed: number, total: number) => void;
}

const DEFAULT_DOWNLOAD_CONCURRENCY = 3;
const DEFAULT_DOWNLOAD_ATTEMPTS = 2;

function extensionFromUrl(src: string): string {
  const extension = src.split(/[?#]/, 1)[0].split('.').at(-1)?.toLowerCase();
  return extension && /^(?:jpe?g|png|webp)$/.test(extension) ? extension : 'png';
}

function saveBrowserBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Safari may still be consuming the object URL after click() returns.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

async function downloadOne(
  item: StyleGalleryDownloadItem,
  attempts: number,
  fetchImage: typeof fetch,
  saveBlob: (blob: Blob, filename: string) => void,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      // In production the same-origin route only signs and redirects. The image body then travels
      // directly from HF to the visitor, so batch downloads do not proxy image bytes through Vercel.
      const response = await fetchImage(item.src, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`Image download failed with ${response.status}`);
      saveBlob(await response.blob(), `${item.id}.${extensionFromUrl(item.src)}`);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Image download failed');
}

/**
 * Downloads selected HF-backed images with bounded memory and per-file failure isolation.
 * Each worker holds at most one image blob; a failed file is retried independently and never
 * causes already downloaded files to be repeated.
 */
export async function downloadStyleGalleryImages(
  items: readonly StyleGalleryDownloadItem[],
  options: StyleGalleryBatchDownloadOptions = {},
): Promise<StyleGalleryBatchDownloadResult> {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_DOWNLOAD_CONCURRENCY));
  const attempts = Math.max(1, Math.floor(options.attempts ?? DEFAULT_DOWNLOAD_ATTEMPTS));
  const fetchImage = options.fetchImage ?? fetch;
  const saveBlob = options.saveBlob ?? saveBrowserBlob;
  const failed: StyleGalleryDownloadItem[] = [];
  let cursor = 0;
  let completed = 0;
  let downloaded = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      try {
        await downloadOne(item, attempts, fetchImage, saveBlob);
        downloaded += 1;
      } catch {
        failed.push(item);
      } finally {
        completed += 1;
        options.onProgress?.(completed, items.length);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return { downloaded, failed };
}
