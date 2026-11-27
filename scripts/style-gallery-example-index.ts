import { createHash } from 'node:crypto';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { gunzipSync, gzipSync } from 'node:zlib';
import { fetchHfS3Read } from '../src/lib/hf-s3';
import { createStyleGallerySignedImageUrl, getStyleGalleryObjectBytes, putStyleGalleryObject } from '../src/lib/hf-s3-presign';
import { mapWithConcurrency } from '../src/lib/map-with-concurrency';
import {
  type ExampleManifest,
  materializeExamples,
  parseExampleRoot,
  putExampleRoot,
  readExampleRootSnapshot,
  STYLE_GALLERY_EXAMPLE_INDEX_KEY,
  stageExampleGroups,
} from '../src/lib/style-gallery-example-shards';

/** The old index can exceed a full-transfer timeout on a remote operator's connection.
 * Every byte range must attest to the same version and extent; the root PUT still uses its ETag.
 */
async function readMigrationSource() {
  const url = createStyleGallerySignedImageUrl(STYLE_GALLERY_EXAMPLE_INDEX_KEY);
  const chunk = 2 * 1024 * 1024;
  const range = (start: number, end: number) =>
    fetchHfS3Read(url, { headers: { range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(120_000) });
  const first = await range(0, chunk - 1);
  const etag = first.headers.get('etag');
  if (!first.ok || !etag) throw Error(`Cannot read versioned example index (HTTP ${first.status}).`);
  if (first.status === 200) return { text: await first.text(), etag };
  const size = Number(first.headers.get('content-range')?.split('/')[1]);
  if (!Number.isSafeInteger(size) || size <= 0) throw Error('Invalid size for index byte ranges.');
  async function part(response: Response, start: number, end: number) {
    if (
      response.status !== 206 ||
      response.headers.get('etag') !== etag ||
      response.headers.get('content-range') !== `bytes ${start}-${end}/${size}`
    )
      throw Error('Example index changed or returned an invalid byte range.');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== end - start + 1) throw Error('Incomplete example index byte range.');
    return bytes;
  }
  const initial = await part(first, 0, Math.min(chunk, size) - 1);
  const offsets = Array.from({ length: Math.ceil(size / chunk) - 1 }, (_, i) => (i + 1) * chunk);
  const rest = await mapWithConcurrency(offsets, 6, async (start) => {
    const end = Math.min(size, start + chunk) - 1;
    return part(await range(start, end), start, end);
  });
  return { text: Buffer.concat([initial, ...rest], size).toString('utf8'), etag };
}

const { positionals, values } = parseArgs({ allowPositionals: true, options: { slug: { type: 'string' } } });
const [command] = positionals;
if (
  positionals.length !== 1 ||
  !command ||
  !['read', 'check', 'stage', 'activate', 'restore'].includes(command) ||
  (command === 'read') !== Boolean(values.slug)
)
  throw Error('Use read --slug SLUG, check, stage, activate, or restore.');
const raw = await readMigrationSource();
if (!raw.text || !raw.etag) throw Error('Index or ETag missing.');
const root = parseExampleRoot(raw.text);
if (command === 'read') {
  const slug = values.slug ?? '';
  if (!/^[a-z0-9-]{1,160}$/i.test(slug)) throw Error('Invalid source slug.');
  const group = (await materializeExamples(root, slug)).groups[0];
  if (!group) throw Error('Source has no indexed examples.');
  console.log(JSON.stringify(group));
} else {
  const data = await materializeExamples(root, undefined, true);
  // Validation is deliberately stronger than parsing: do not silently drop unrecognized fields or normalize old values.
  if (root.version === 2 && !isDeepStrictEqual(JSON.parse(raw.text), data))
    throw Error('Legacy fields changed during schema validation. The publication key was not modified.');
  const summary = {
    format: root.version,
    groups: data.groups.length,
    examples: data.groups.reduce((n, g) => n + g.examples.length, 0),
    likes: data.groups.reduce((n, g) => n + g.examples.reduce((k, e) => k + e.likedBy.length, 0), 0),
    logicalBytes: Buffer.byteLength(JSON.stringify(data)),
    logicalSha256: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
    rootBytes: Buffer.byteLength(raw.text),
  };
  console.log(JSON.stringify(summary));
  if (command === 'restore' && root.version === 3) {
    const written = await putExampleRoot(data, { ifMatch: raw.etag });
    const saved = await readMigrationSource();
    if (written === saved.etag && !isDeepStrictEqual(data, JSON.parse(saved.text)))
      throw Error('Restored index contents differ.');
    if (parseExampleRoot(saved.text).version !== 2) throw Error('Restore readback did not find a legacy document.');
    console.log('Restored the latest logical v2 data using the observed manifest ETag.');
  } else if ((command === 'activate' || command === 'stage') && root.version === 2) {
    const manifest: ExampleManifest = { version: 3, updatedAt: data.updatedAt, groups: await stageExampleGroups(data.groups) };
    const restored = await materializeExamples(manifest, undefined, true);
    if (!isDeepStrictEqual(data, restored)) throw Error('Shards did not reproduce the ordered source exactly.');
    const backup = `examples/shards-v3/backups/${createHash('sha256').update(raw.text).digest('hex')}.json.gz`;
    await putStyleGalleryObject(backup, gzipSync(raw.text), 'application/gzip');
    const copy = await getStyleGalleryObjectBytes(backup, 180_000);
    if (!copy || gunzipSync(copy).toString('utf8') !== raw.text) throw Error('Legacy backup readback mismatch.');
    console.log(
      JSON.stringify({
        verified: true,
        packs: new Set(manifest.groups.map((g) => g.pack)).size,
        manifestBytes: Buffer.byteLength(JSON.stringify(manifest)),
        backup,
      }),
    );
    if (command === 'activate') {
      const written = await putExampleRoot(manifest, { ifMatch: raw.etag });
      const saved = await readExampleRootSnapshot();
      if (saved.root.version !== 3) throw Error('Expected a sharded index after publication.');
      if (saved.etag === written && !isDeepStrictEqual(manifest, saved.root)) throw Error('Manifest readback mismatch.');
      console.log('Sharded index active. All groups verified before conditional publication.');
    }
  }
}
