import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHfS3Client, type HfS3Config, HfS3ConflictError } from '../../src/lib/hf-s3';
import { getLive2DObjectKey } from '../../src/lib/live2d/catalog';
import { buildLive2DPackageManifest, serializeLive2DManifest } from '../../src/lib/live2d/package-manifest';
import {
  type Live2DCatalog,
  type Live2DCostume,
  type Live2DProvenance,
  live2dCatalogSchema,
  live2dProvenanceSchema,
} from '../../src/lib/live2d/types';

interface PublishOptions {
  packageRoot: string;
  characterId: string;
  characterLabels: Record<string, string>;
  costumeId: string;
  costumeLabels: Record<string, string>;
  sourceUrl: string;
  sourceRevision: string;
  acquiredAt: string;
  converterRepository: string;
  converterCommit: string;
  converterVersion?: string;
  licenseReferences: string[];
  publisher: string;
  scale: number;
  position: [number, number];
  approvedAudio: Set<string>;
  dryRun: boolean;
}

const repoRoot = path.resolve(import.meta.dirname, '../..');
const catalogPath = path.join(repoRoot, 'src/data/live2d/catalog.json');
const manifestDirectory = path.join(repoRoot, 'src/data/live2d/manifests');
const provenanceDirectory = path.join(repoRoot, 'src/data/live2d/provenance');

function requireValue(arguments_: string[], index: number, name: string): string {
  const value = arguments_[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function parseLabels(value: string, name: string): Record<string, string> {
  const labels = Object.fromEntries(
    value.split(',').map((entry) => {
      const separator = entry.indexOf('=');
      if (separator <= 0 || separator === entry.length - 1) throw new Error(`${name} must use locale=value entries.`);
      return [entry.slice(0, separator), entry.slice(separator + 1)];
    }),
  );
  if (!labels.zh) throw new Error(`${name} must include zh=...`);
  return labels;
}

function parsePosition(value: string): [number, number] {
  const values = value.split(',').map(Number);
  if (values.length !== 2 || values.some((item) => !Number.isFinite(item))) throw new Error('--position must be x,y.');
  return [values[0], values[1]];
}

function parseArguments(arguments_: string[]): PublishOptions {
  const values = new Map<string, string>();
  const approvedAudio = new Set<string>();
  let dryRun = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (argument === '--audio') {
      approvedAudio.add(requireValue(arguments_, index, argument));
      index += 1;
      continue;
    }
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`);
    values.set(argument, requireValue(arguments_, index, argument));
    index += 1;
  }
  const required = (name: string) => {
    const value = values.get(name);
    if (!value) throw new Error(`Missing ${name}.`);
    return value;
  };
  const scale = Number(values.get('--scale') ?? '1');
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('--scale must be a positive number.');
  return {
    packageRoot: path.resolve(required('--package')),
    characterId: required('--character-id'),
    characterLabels: parseLabels(required('--character-labels'), '--character-labels'),
    costumeId: required('--costume-id'),
    costumeLabels: parseLabels(required('--costume-labels'), '--costume-labels'),
    sourceUrl: required('--source-url'),
    sourceRevision: required('--source-revision'),
    acquiredAt: required('--acquired-at'),
    converterRepository: required('--converter-repository'),
    converterCommit: required('--converter-commit'),
    converterVersion: values.get('--converter-version'),
    licenseReferences: required('--license').split(',').filter(Boolean),
    publisher: required('--publisher'),
    scale,
    position: parsePosition(values.get('--position') ?? '0,0'),
    approvedAudio,
    dryRun,
  };
}

function getPublisherConfig(): HfS3Config {
  const accessKeyId = process.env.LIVE2D_HF_S3_WRITE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.LIVE2D_HF_S3_WRITE_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'Missing Live2D publisher credentials. Set LIVE2D_HF_S3_WRITE_ACCESS_KEY_ID and LIVE2D_HF_S3_WRITE_SECRET_ACCESS_KEY.',
    );
  }
  return {
    accessKeyId,
    secretAccessKey,
    endpoint: new URL(process.env.LIVE2D_HF_S3_ENDPOINT ?? 'https://s3.hf.co/clelele0722'),
    bucket: process.env.LIVE2D_HF_S3_BUCKET ?? 'raw-datasets',
    prefix: process.env.LIVE2D_HF_S3_PREFIX ?? 'bestdori',
    region: process.env.LIVE2D_HF_S3_REGION ?? 'us-east-1',
  };
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function verifyRemoteObject(
  client: ReturnType<typeof createHfS3Client>,
  key: string,
  expected: { size: number; sha256: string },
): Promise<boolean> {
  const head = await client.head(key);
  if (!head.exists) return false;
  if (head.size !== null && head.size !== expected.size) throw new Error(`Remote size conflicts for ${key}.`);
  const snapshot = await client.get(key);
  if (!snapshot || snapshot.bytes.byteLength !== expected.size || sha256(snapshot.bytes) !== expected.sha256) {
    throw new Error(`Remote bytes conflict for ${key}.`);
  }
  return true;
}

async function publishObjects(
  client: ReturnType<typeof createHfS3Client>,
  releaseId: string,
  files: Map<string, Uint8Array>,
  manifestObjects: Array<{ path: string; size: number; mime: string; sha256: string }>,
): Promise<void> {
  let completed = 0;
  const concurrency = Math.min(6, manifestObjects.length);
  await Promise.all(
    Array.from({ length: concurrency }, async (_, workerIndex) => {
      for (let index = workerIndex; index < manifestObjects.length; index += concurrency) {
        const object = manifestObjects[index];
        const key = getLive2DObjectKey(releaseId, object.path);
        if (!(await verifyRemoteObject(client, key, object))) {
          try {
            await client.put(key, files.get(object.path) ?? new Uint8Array(), object.mime, { ifNoneMatch: '*' });
          } catch (error) {
            if (!(error instanceof HfS3ConflictError) || !(await verifyRemoteObject(client, key, object))) throw error;
          }
          if (!(await verifyRemoteObject(client, key, object))) throw new Error(`Remote verification failed for ${key}.`);
        }
        completed += 1;
        console.log(`[${completed}/${manifestObjects.length}] verified ${object.path}`);
      }
    }),
  );
}

function upsertCatalog(catalog: Live2DCatalog, options: PublishOptions, costume: Live2DCostume): Live2DCatalog {
  const characters = catalog.characters.map((character) => ({ ...character, costumes: [...character.costumes] }));
  let character = characters.find((candidate) => candidate.id === options.characterId);
  if (!character) {
    character = { id: options.characterId, label: options.characterLabels, costumes: [] };
    characters.push(character);
  }
  const existing = character.costumes.find((candidate) => candidate.id === costume.id);
  if (existing && existing.releaseId !== costume.releaseId) {
    throw new Error(`Catalog costume ${options.characterId}/${costume.id} already points at a different immutable release.`);
  }
  if (!existing) character.costumes.push(costume);
  return live2dCatalogSchema.parse({ version: 1, characters });
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const { manifest, transformedFiles } = await buildLive2DPackageManifest(options.packageRoot, {
    approvedAudio: options.approvedAudio,
  });
  const manifestText = serializeLive2DManifest(manifest);
  const manifestSha256 = sha256(manifestText);
  const provenance: Live2DProvenance = live2dProvenanceSchema.parse({
    version: 1,
    releaseId: manifest.releaseId,
    source: {
      url: options.sourceUrl,
      revision: options.sourceRevision,
      acquiredAt: options.acquiredAt,
    },
    converter: {
      repository: options.converterRepository,
      commit: options.converterCommit,
      version: options.converterVersion,
      options: { coreAudioRemoved: true, approvedAudio: [...options.approvedAudio].sort() },
    },
    manifestSha256,
    licenseReferences: options.licenseReferences,
    publisher: options.publisher,
    publishedAt: new Date().toISOString(),
  });
  const costume: Live2DCostume = {
    id: options.costumeId,
    label: options.costumeLabels,
    releaseId: manifest.releaseId,
    entryPath: getLive2DObjectKey(manifest.releaseId, manifest.entryPath),
    packageBytes: manifest.totalBytes,
    scale: options.scale,
    position: options.position,
    interactions: [{ area: 'head', motionGroup: 'smile01', lines: ['你好，很高兴见到你。'] }],
    provenancePath: `src/data/live2d/provenance/${manifest.releaseId}.json`,
  };
  const catalog = live2dCatalogSchema.parse(JSON.parse(await readFile(catalogPath, 'utf8')));
  const nextCatalog = upsertCatalog(catalog, options, costume);

  if (!options.dryRun) {
    await publishObjects(
      createHfS3Client(getPublisherConfig(), { attempts: 5, transferTimeoutMs: 120_000 }),
      manifest.releaseId,
      transformedFiles,
      manifest.objects,
    );
    await mkdir(manifestDirectory, { recursive: true });
    await mkdir(provenanceDirectory, { recursive: true });
    await writeFile(path.join(manifestDirectory, `${manifest.releaseId}.json`), manifestText, { flag: 'wx' }).catch(
      async (error) => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if ((await readFile(path.join(manifestDirectory, `${manifest.releaseId}.json`), 'utf8')) !== manifestText) throw error;
      },
    );
    const provenanceText = `${JSON.stringify(provenance, null, 2)}\n`;
    await writeFile(path.join(provenanceDirectory, `${manifest.releaseId}.json`), provenanceText, { flag: 'wx' }).catch(
      async (error) => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const existing = live2dProvenanceSchema.parse(
          JSON.parse(await readFile(path.join(provenanceDirectory, `${manifest.releaseId}.json`), 'utf8')),
        );
        if (existing.releaseId !== provenance.releaseId || existing.manifestSha256 !== provenance.manifestSha256) throw error;
      },
    );
    await writeFile(catalogPath, `${JSON.stringify(nextCatalog, null, 2)}\n`);
  }
  console.log(
    `${options.dryRun ? 'Validated' : 'Published'} ${options.characterId}/${options.costumeId}: ${manifest.releaseId}`,
  );
  console.log(`${manifest.objects.length} immutable object(s), ${manifest.totalBytes} byte(s).`);
}

await main();

// npm run publish:live2d-models -- --package /absolute/model-dir --character-id chihaya-anon --character-labels 'zh=千早爱音,en=Chihaya Anon,ja=千早愛音' --costume-id default --costume-labels 'zh=默认,en=Default,ja=デフォルト' --source-url https://bestdori.com/tool/explorer/asset/jp/live2d/chara --source-revision 037_live_default --acquired-at 2026-07-27T00:00:00.000Z --converter-repository https://github.com/A-kirami/bestdori-live2d-downloader --converter-commit b6f6b1b29352e073f5987da8b06d6ae1e4b70ef6 --license https://bestdori.com/info/terms,https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html --publisher clelele --scale 0.9 --position 0,-0.1
