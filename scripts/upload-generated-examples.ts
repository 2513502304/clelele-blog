/** Upload a completed generation receipt without spending generation credits. Safe to rerun after interruption. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { getStyleGalleryObjectBytes, putStyleGalleryObject } from '../src/lib/hf-s3-presign';
import { generationManifestSchema } from '../src/lib/style-gallery-generation';
import { getStoredStyleGalleryItem } from '../src/lib/style-gallery-store';
import { configureEnvironmentProxy } from './lib/environment-proxy.mjs';
import { runStyleGalleryExampleUpload } from './upload-style-examples';

export async function uploadGeneratedExamples(manifestPath: string, apply = false): Promise<void> {
  configureEnvironmentProxy();
  const raw = await readFile(manifestPath, 'utf8');
  if (Buffer.byteLength(raw) > 64 * 1024 * 1024)
    throw new Error('Receipt exceeds the 64 MiB raw metadata budget. Store image bytes separately.');
  const manifest = generationManifestSchema.parse(JSON.parse(raw));
  const files = manifest.outputs.map((output) => path.resolve(path.dirname(manifestPath), output.file));
  for (let i = 0; i < files.length; i++) {
    const bytes = await readFile(files[i]);
    if (createHash('sha256').update(bytes).digest('hex') !== manifest.outputs[i].sha256)
      throw new Error(`Output hash changed: ${files[i]}`);
  }
  const encoded = Buffer.from(JSON.stringify(manifest));
  // A private immutable receipt precedes public image publication. Retry uses the same ID and bytes.
  const key = `generation-receipts/v1/${manifest.source.slug}/${manifest.id}.json.gz`;
  console.log(
    `${apply ? 'Upload' : 'Plan'}: ${manifest.id}; ${files.length} image(s); ${manifest.generation.model}; ${manifest.generation.prompt.length} prompt characters.`,
  );
  if (!apply) return;
  const source = await getStoredStyleGalleryItem(manifest.source.slug, { fresh: true });
  if (
    !source ||
    !source.prompts.some((variant) => variant.id === manifest.source.promptId && variant.prompt === manifest.source.template)
  ) {
    throw new Error(
      'The source card/template changed or does not exist. Verify the stored template before publishing examples.',
    );
  }
  const previous = await getStyleGalleryObjectBytes(key);
  if (previous) {
    if (!gunzipSync(previous, { maxOutputLength: 64 * 1024 * 1024 }).equals(encoded))
      throw new Error('Receipt ID already belongs to different inputs. Use a new job ID; never overwrite provenance.');
  } else {
    await putStyleGalleryObject(key, gzipSync(encoded), 'application/gzip', { ifNoneMatch: '*' });
    const verified = await getStyleGalleryObjectBytes(key);
    if (!verified || !gunzipSync(verified, { maxOutputLength: 64 * 1024 * 1024 }).equals(encoded))
      throw new Error('Receipt verification failed.');
  }
  const result = await runStyleGalleryExampleUpload([
    '--item',
    manifest.source.slug,
    '--platform',
    manifest.generation.provider === 'pixai' ? 'PixAI' : 'GPT-Image',
    '--note',
    manifest.generation.prompt,
    ...files,
  ]);
  if (result !== 0) throw new Error('Some images failed to publish. Rerun this receipt; generation is not repeated.');
  console.log(`Archived full request/response metadata in private HF object ${key}.`);
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const manifest = process.argv.find((arg) => arg.endsWith('.json'));
  if (!manifest || process.argv.includes('--help'))
    console.log(
      'Usage: node --use-env-proxy --env-file-if-exists=.env.local --import tsx scripts/upload-generated-examples.ts receipt.json [--apply]\nDry run by default. File hashes and schema are verified before writing. --apply archives private metadata then publishes images and the complete submitted prompt.',
    );
  else await uploadGeneratedExamples(manifest, process.argv.includes('--apply'));
}
