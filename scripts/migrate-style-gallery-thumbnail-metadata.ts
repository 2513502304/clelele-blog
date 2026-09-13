import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  getStyleGalleryObjectTextSnapshot,
  putStyleGalleryObject,
  StyleGalleryObjectConflictError,
} from '../src/lib/hf-s3-presign';
import { mapWithConcurrency } from '../src/lib/map-with-concurrency';
import { stripStyleGalleryThumbnailMetadata } from '../src/lib/style-gallery-thumbnail-metadata';

/** Remove only redundant paths, with private revision backups and conditional writes. */
const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false } } });
const catalogKey = 'metadata/catalog-v5.json';
const catalog = await getStyleGalleryObjectTextSnapshot(catalogKey, 60_000);
if (!catalog.text) throw new Error('Catalog is missing.');
const slugs = (JSON.parse(catalog.text) as { items: { slug: string }[] }).items.map((item) => item.slug);
if (slugs.some((slug) => !/^[a-z0-9-]+$/i.test(slug))) throw new Error('Invalid catalog slug.');
const keys = [...new Set(slugs)].map((slug) => `items/${slug}.json`);
keys.push(catalogKey);
const backupDir = values.apply ? await mkdtemp(path.join(tmpdir(), 'gallery-thumbnail-metadata-')) : undefined;
let checked = 0,
  changed = 0,
  removed = 0,
  savedBytes = 0;
await mapWithConcurrency(keys, 8, async (key) => {
  for (let attempt = 0; attempt < 6; attempt++) {
    const snapshot = await getStyleGalleryObjectTextSnapshot(key, 60_000);
    if (!snapshot.text || !snapshot.etag) throw new Error(`Missing metadata snapshot: ${key}`);
    const original = JSON.parse(snapshot.text);
    const result = stripStyleGalleryThumbnailMetadata(original);
    if (!result.removed) break;
    const bytes = Buffer.from(JSON.stringify(result.value));
    if (values.apply && backupDir) {
      const revision = createHash('sha256').update(snapshot.text).digest('hex');
      await writeFile(path.join(backupDir, `${key.replaceAll('/', '_')}.${revision}.json`), snapshot.text, { mode: 0o600 });
      try {
        await putStyleGalleryObject(key, bytes, 'application/json', { ifMatch: snapshot.etag });
      } catch (error) {
        if (error instanceof StyleGalleryObjectConflictError && attempt < 5) continue;
        throw error;
      }
    }
    changed++;
    removed += result.removed;
    // Report field savings independent of pre-existing whitespace formatting.
    savedBytes += Buffer.byteLength(JSON.stringify(original)) - bytes.length;
    break;
  }
  checked++;
  if (checked % 200 === 0) console.log(JSON.stringify({ checked, changed, removed, savedBytes }));
});
console.log(JSON.stringify({ mode: values.apply ? 'apply' : 'audit', checked, changed, removed, savedBytes, backupDir }));
