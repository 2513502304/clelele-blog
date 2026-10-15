const MAX_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 6;
const blobs = new Map<string, Blob>();
let retainedBytes = 0;

/** Failed decodes must be retryable; a successful HTTP response can still contain corrupt image bytes. */
export function discardCachedLightboxImage(source: string): void {
  retainedBytes -= blobs.get(source)?.size ?? 0;
  blobs.delete(source);
}

/** Retain only recently viewed response bytes; mounted viewers own/revoke their own blob URLs. */
export function cacheLightboxImage(source: string, blob: Blob): void {
  discardCachedLightboxImage(source);
  if (blob.size > MAX_BYTES) return;
  blobs.set(source, blob);
  retainedBytes += blob.size;
  while (blobs.size > MAX_ENTRIES || retainedBytes > MAX_BYTES) {
    const oldest = blobs.keys().next().value;
    if (oldest === undefined) break;
    retainedBytes -= blobs.get(oldest)?.size ?? 0;
    blobs.delete(oldest);
  }
}

/** Use the exact request URL as identity, so refreshed signatures never reuse an unrelated response. */
export function getCachedLightboxImage(source: string): Blob | undefined {
  const blob = blobs.get(source);
  if (blob) {
    blobs.delete(source);
    blobs.set(source, blob);
  }
  return blob;
}
