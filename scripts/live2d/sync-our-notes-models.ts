import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { createHfS3Client } from '../../src/lib/hf-s3';
import { LIVE2D_MAX_ASSET_BYTES } from '../../src/lib/live2d/asset-registry';
import { nativeModelAssets, nativeModelManifestSchema } from '../../src/lib/live2d/native-package';
import { mergeOurNotesIndexes, ourNotesIdentity } from '../../src/lib/live2d/our-notes-source';
import { live2dCatalogSchema } from '../../src/lib/live2d/types';
import { configureEnvironmentProxy } from '../lib/environment-proxy.mjs';
import { commitRemoteCatalogUpdates, getPublisherConfig, type Live2DCatalogUpdate, publishLive2DModel } from './publish-models';

const SITES = [
  'https://assets.bdon.moe/chart-site',
  'https://storage.bdon.moe/moenotes/jp',
  'https://storage.bdon.moe/moenotes',
];
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

/** All external reads use Node's environment proxy. Failed writes are never added to the catalog. */
async function download(url: string): Promise<Uint8Array> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}: ${url}`);
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body?.getReader();
      if (!reader) throw new Error(`Empty response: ${url}`);
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > LIVE2D_MAX_ASSET_BYTES) throw new Error(`Asset exceeds serving limit: ${url}`);
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      return Buffer.concat(chunks, size);
    } catch (error) {
      if (attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
}

async function pool<T>(items: T[], count: number, action: (item: T) => Promise<void>) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(count, items.length) }, async () => {
      while (cursor < items.length) await action(items[cursor++]);
    }),
  );
}

async function cachedAsset(site: string, asset: { path: string; size: number; decodedSize: number }, destination: string) {
  // Source URLs come from manifests: allow only content-addressed files below assets/, never arbitrary URLs.
  const match = /^assets\/([a-f0-9]{64})\.[a-z0-9.]+$/.exec(asset.path);
  if (!match || asset.size > LIVE2D_MAX_ASSET_BYTES) throw new Error(`Invalid native asset: ${asset.path}`);
  const valid = (bytes: Uint8Array) => {
    if (bytes.length !== asset.size) return false;
    try {
      // bdon names gzip objects by the decoded content hash, not the compressed transport bytes.
      const decoded = asset.path.endsWith('.gz') ? gunzipSync(bytes, { maxOutputLength: 50_000_000 }) : bytes;
      return decoded.length === asset.decodedSize && sha256(decoded) === match[1];
    } catch {
      return false;
    }
  };
  const existing = await readFile(destination).catch(() => null);
  if (existing && valid(existing)) return;
  const bytes = await download(`${site}/${asset.path}`);
  if (!valid(bytes)) throw new Error(`Native asset hash/size mismatch: ${asset.path}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(`${destination}.part`, bytes);
  await rename(`${destination}.part`, destination);
}

async function main() {
  configureEnvironmentProxy();
  const { values } = parseArgs({
    options: {
      workspace: { type: 'string', default: '.cache/live2d-our-notes' },
      models: { type: 'string' },
      publish: { type: 'boolean', default: false },
      'commit-catalog': { type: 'boolean', default: false },
      'plan-only': { type: 'boolean', default: false },
    },
  });
  const workspace = path.resolve(values.workspace);
  const publish = values.publish;
  const commitCatalog = values['commit-catalog'];
  if (commitCatalog && !publish) throw new Error('--commit-catalog requires --publish.');
  const selected = new Set(
    values.models
      ?.split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
  if (values.models !== undefined && !selected.size) throw new Error('--models must not be empty.');
  await mkdir(workspace, { recursive: true });
  const snapshots = await Promise.all(
    SITES.map(async (site) => {
      const data = JSON.parse(new TextDecoder().decode(await download(`${site}/models.json`)));
      if (!Array.isArray(data.models)) throw new Error(`Invalid model index: ${site}`);
      return { site, models: data.models };
    }),
  );
  const models = mergeOurNotesIndexes(snapshots).filter((m) => !selected.size || selected.has(m.id));
  const missing = [...selected].filter((id) => !models.some((model) => model.id === id));
  if (missing.length) throw new Error(`Unknown model IDs: ${missing.join(', ')}`);
  await writeFile(
    path.join(workspace, 'source-index.json'),
    JSON.stringify({ acquiredAt: new Date().toISOString(), snapshots }, null, 2),
  );
  console.log(`Our Notes: ${models.length} unique model(s), ${snapshots.length} source indexes.`);
  if (values['plan-only']) return;
  const client = createHfS3Client(getPublisherConfig());
  const snapshot = await client.get('catalog.json');
  if (!snapshot) throw new Error('Existing HF catalog is required to merge character identities.');
  const catalog = live2dCatalogSchema.parse(JSON.parse(new TextDecoder().decode(snapshot.bytes)));
  const failures: Array<{ id: string; error: string }> = [];
  const updates: Live2DCatalogUpdate[] = [];
  await pool(models, 2, async (model) => {
    try {
      const url = `${model.site}/models/${model.id}.json`;
      const bytes = await download(url);
      const manifest = nativeModelManifestSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
      if (manifest.id !== model.id) throw new Error('Model manifest identity mismatch.');
      const packageRoot = path.join(workspace, 'packages', model.id);
      await mkdir(packageRoot, { recursive: true });
      await pool(nativeModelAssets(manifest), 4, (asset) => cachedAsset(model.site, asset, path.join(packageRoot, asset.path)));
      await writeFile(path.join(packageRoot, 'model.native.json'), JSON.stringify(manifest));
      const identity = ourNotesIdentity(model, catalog);
      const result = await publishLive2DModel(
        {
          ...identity,
          packageRoot,
          entryPath: 'model.native.json',
          sourceUrl: url,
          sourceRevision: sha256(bytes),
          acquiredAt: new Date().toISOString(),
          converterRepository: 'https://github.com/StarMoe-org/moenotes',
          converterCommit: '9300d8650539fbabbc33ea70f1584958d300fd5c',
          converterVersion: 'Native Our Notes manifest; no model conversion',
          licenseReferences: [
            'https://bdon.moe/about',
            'https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html',
          ],
          publisher: 'clelele',
          scale: 1,
          position: [0, 0],
          approvedAudio: new Set(),
          dryRun: !publish,
          replace: false,
        },
        [],
        { deferCatalog: true, objectConcurrency: 4 },
      );
      updates.push({ options: { ...identity, replace: false }, costume: result.costume });
      await writeFile(
        path.join(workspace, `${model.id}.release.json`),
        JSON.stringify({ options: { ...identity, replace: false }, costume: result.costume }, null, 2),
      );
      console.log(
        `[${updates.length}/${models.length}] ${publish ? 'Published' : 'Prepared'} ${model.id}: ${result.totalBytes} bytes`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ id: model.id, error: message });
      console.error(`Failed ${model.id}: ${message}`);
    }
  });
  let catalogCommitted = false;
  // Publish the catalog only after the matching blog runtime has deployed; old clients cannot read native models.
  if (commitCatalog && !failures.length) {
    await commitRemoteCatalogUpdates(updates);
    catalogCommitted = true;
    console.log(`Cataloged ${updates.length} Our Notes models.`);
  }
  await writeFile(
    path.join(workspace, 'report.json'),
    JSON.stringify(
      { models: models.length, prepared: updates.length, published: publish, catalogCommitted, failures },
      null,
      2,
    ),
  );
  if (commitCatalog && failures.length) throw new Error('Catalog unchanged: resolve failed model packages before committing.');
  if (failures.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

// Load the existing HF write profile into LIVE2D_HF_S3_WRITE_ACCESS_KEY_ID / SECRET_ACCESS_KEY.
// npm run sync:live2d-our-notes -- --models adv_live2d_anon_002_casual_spring_01_glasses
// npm run sync:live2d-our-notes -- --publish  # immutable files only; safe before deployment
// npm run sync:live2d-our-notes -- --publish --commit-catalog  # after the new renderer deploys
