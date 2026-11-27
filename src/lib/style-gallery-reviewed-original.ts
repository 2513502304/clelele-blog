import { waitUntil } from '@vercel/functions';
import { getStyleGalleryObjectBytes, getStyleGalleryObjectEtag } from './hf-s3-presign';
import type { StyleGalleryVisualFeature } from './style-gallery-visual-types';

const maxBytes = 8 * 1024 * 1024,
  maxEntries = 2,
  maxAge = 180_000;
type Entry = {
  bytes: Buffer;
  etag: string;
  timer: ReturnType<typeof setTimeout>;
  expires: number;
  feature?: Promise<StyleGalleryVisualFeature | undefined>;
};
const entries = new Map<string, Entry>();
let capturing = 0,
  preparing = false;

/** Keys include the private owner, source, generation and output index. No public record is produced here. */
export function forgetReviewedOriginal(key: string) {
  const entry = entries.get(key);
  if (entry) clearTimeout(entry.timer);
  entries.delete(key);
}

/** Tap a fully consumed review response with backpressure. Partial, oversized and unversioned bodies bypass reuse. */
export function streamReviewedOriginal(
  key: string,
  response: Response,
  prepare?: (bytes: Buffer) => Promise<StyleGalleryVisualFeature>,
) {
  const input = response.body,
    etag = response.headers.get('etag'),
    length = Number(response.headers.get('content-length'));
  if (!input || !etag || capturing >= maxEntries || length > maxBytes || response.status !== 200) return input;
  const existing = entries.get(key);
  if (existing?.etag === etag && existing.expires > Date.now()) return input;
  const chunks: Buffer[] = [];
  let size = 0;
  capturing++;
  const tap = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.length;
      if (size <= maxBytes) chunks.push(Buffer.from(chunk));
      else chunks.length = 0;
      controller.enqueue(chunk);
    },
    flush() {
      if (!size || size > maxBytes || (length && length !== size)) return;
      forgetReviewedOriginal(key);
      const oldest = entries.keys().next().value;
      if (entries.size >= maxEntries && oldest !== undefined) forgetReviewedOriginal(oldest);
      const timer = setTimeout(() => forgetReviewedOriginal(key), maxAge);
      timer.unref?.();
      const entry: Entry = { bytes: Buffer.concat(chunks, size), etag, timer, expires: Date.now() + maxAge };
      entries.set(key, entry);
      // At most one speculative inference per container. A failed or skipped attempt is retried on confirmation.
      if (prepare && !preparing) {
        preparing = true;
        entry.feature = Promise.resolve()
          .then(() => prepare(entry.bytes))
          .catch(() => undefined)
          .finally(() => {
            preparing = false;
          });
        waitUntil(entry.feature.then(() => undefined));
      }
    },
  });
  void input
    .pipeTo(tap.writable)
    .catch(() => {
      /* The outgoing readable carries the upstream error or cancellation. */
    })
    .finally(() => {
      chunks.length = 0;
      capturing--;
    });
  return tap.readable;
}

/** A replacement or deletion in durable storage invalidates even a freshly viewed local copy. */
export async function readReviewedOriginal(key: string) {
  const entry = entries.get(key);
  if (entry && entry.expires > Date.now() && (await getStyleGalleryObjectEtag(key).catch(() => null)) === entry.etag)
    return { bytes: entry.bytes, feature: entry.feature, reused: true };
  return { bytes: await getStyleGalleryObjectBytes(key), feature: undefined, reused: false };
}
