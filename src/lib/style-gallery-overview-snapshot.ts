import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import { waitUntil } from '@vercel/functions';
import {
  getStyleGalleryObjectBytesSnapshot,
  getStyleGalleryObjectEtag,
  putStyleGalleryObject,
  StyleGalleryObjectConflictError,
} from './hf-s3-presign';
import { createStyleGalleryExampleOverview, getStyleGalleryExampleOverview } from './style-gallery';
import { materializeExamples, readExampleRootSnapshot, STYLE_GALLERY_EXAMPLE_INDEX_KEY } from './style-gallery-example-shards';
import { type OverviewPayload, packOverview } from './style-gallery-overview-payload';
import { getStyleGalleryCatalogSnapshot, STYLE_GALLERY_CATALOG_KEY } from './style-gallery-store';

const cacheKey = 'metadata/cache/example-overview-v1.json.gz';
const compress = promisify(gzip),
  decompress = promisify(gunzip);
type Snapshot = { catalog: string; examples: string; payload: OverviewPayload };
function digest(snapshot: Snapshot) {
  return createHash('sha256')
    .update(JSON.stringify([snapshot.catalog, snapshot.examples, snapshot.payload]))
    .digest('hex');
}
type Result = { payload: OverviewPayload; source: 'memory' | 'snapshot' | 'rebuild' | 'origin' };
let current: Snapshot | undefined;
let inFlight: Promise<Result> | undefined;

async function load(): Promise<Result> {
  // Check both authorities. Likes and source renames can change the list independently.
  const [catalog, examples] = await Promise.all([
    getStyleGalleryObjectEtag(STYLE_GALLERY_CATALOG_KEY),
    getStyleGalleryObjectEtag(STYLE_GALLERY_EXAMPLE_INDEX_KEY),
  ]);
  if (!catalog || !examples) return { payload: packOverview(await getStyleGalleryExampleOverview()), source: 'origin' };
  if (current?.catalog === catalog && current.examples === examples) return { payload: current.payload, source: 'memory' };

  // One bounded cache object across revisions. Its loss, a corrupt body or a lost conditional write only costs a rebuild.
  const stored = await getStyleGalleryObjectBytesSnapshot(cacheKey).catch(() => null);
  if (stored) {
    try {
      const saved: Snapshot & { sha256: string } = JSON.parse((await decompress(stored.bytes)).toString('utf8'));
      if (
        saved.catalog === catalog &&
        saved.examples === examples &&
        Array.isArray(saved.payload?.sources) &&
        Array.isArray(saved.payload?.cards) &&
        saved.sha256 === digest(saved)
      ) {
        current = saved;
        return { payload: saved.payload, source: 'snapshot' };
      }
    } catch {
      /* The authoritative data remains available. */
    }
  }
  const [source, root] = await Promise.all([getStyleGalleryCatalogSnapshot(), readExampleRootSnapshot()]);
  const payload = packOverview(createStyleGalleryExampleOverview(source.value, await materializeExamples(root.root)));
  if (root.etag) {
    // Use the ETags of the bodies actually read, even if a publisher committed between HEAD and GET.
    const rebuilt = { catalog: source.etag, examples: root.etag, payload };
    current = rebuilt;
    waitUntil(
      compress(JSON.stringify({ ...rebuilt, sha256: digest(rebuilt) }))
        .then((bytes) =>
          putStyleGalleryObject(
            cacheKey,
            bytes,
            'application/gzip',
            stored?.etag ? { ifMatch: stored.etag } : { ifNoneMatch: '*' },
          ),
        )
        .catch((error) => {
          if (!(error instanceof StyleGalleryObjectConflictError))
            console.warn('[style-gallery] Overview snapshot write deferred.');
        }),
    );
  }
  return { payload, source: 'rebuild' };
}

/** A cold container can serve the complete public card list without loading the full collection of notes and recipes. */
export function getOverviewSnapshot(): Promise<Result> {
  if (inFlight) return inFlight;
  inFlight = load()
    .catch(async () => ({ payload: packOverview(await getStyleGalleryExampleOverview()), source: 'origin' as const }))
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
}
