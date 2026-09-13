export interface ImageDownloadProgress {
  received: number;
  total?: number;
}

// A current image may use a blob, but unusually large originals stay on the browser's native image path.
const MAX_TRACKED_IMAGE_BYTES = 64 * 1024 * 1024;

/** Read real decoded response bytes. Missing/encoded lengths remain indeterminate, never estimated percentages. */
export async function readImageDownload(
  response: Response,
  signal: AbortSignal,
  onProgress: (progress: ImageDownloadProgress) => void,
): Promise<Blob> {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error('Image response unavailable');
  }
  const length = Number(response.headers.get('content-length'));
  const encoding = response.headers.get('content-encoding');
  let total = !encoding || encoding === 'identity' ? length : undefined;
  if (!total || !Number.isSafeInteger(total) || total < 0) total = undefined;
  if (total && total > MAX_TRACKED_IMAGE_BYTES) {
    await response.body.cancel();
    throw new Error('Image exceeds tracked download budget');
  }
  const reader = response.body.getReader();
  // Also settle independent/custom streams whose producer is not wired to the fetch signal.
  const cancelReader = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener('abort', cancelReader, { once: true });
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  let lastUpdate = 0;
  onProgress({ received, total });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_TRACKED_IMAGE_BYTES) throw new Error('Image exceeds tracked download budget');
      if (total && received > total) total = undefined;
      chunks.push(value);
      if (Date.now() - lastUpdate >= 100) {
        onProgress({ received, total });
        lastUpdate = Date.now();
      }
    }
    if (total && total !== received) total = undefined;
    onProgress({ received, total });
    return new Blob(chunks, { type: response.headers.get('content-type') ?? '' });
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener('abort', cancelReader);
    reader.releaseLock();
  }
}
