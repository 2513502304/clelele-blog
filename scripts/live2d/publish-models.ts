import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createHfS3Client, type HfS3Config, HfS3ConflictError } from '../../src/lib/hf-s3';
import { getLive2DObjectKey, live2dCatalog } from '../../src/lib/live2d/catalog';
import { LIVE2D_CATALOG_KEY } from '../../src/lib/live2d/metadata-store';
import { buildLive2DPackageManifest, serializeLive2DManifest } from '../../src/lib/live2d/package-manifest';
import {
  type Live2DCatalog,
  type Live2DCostume,
  type Live2DInteraction,
  type Live2DProvenance,
  type Live2DVoicePack,
  live2dCatalogSchema,
  live2dProvenanceSchema,
  live2dVoiceIndexSchema,
} from '../../src/lib/live2d/types';

export interface PublishOptions {
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
  replace: boolean;
  replaceInteractions?: boolean;
}

export interface Live2DCatalogUpdate {
  options: Pick<PublishOptions, 'characterId' | 'characterLabels' | 'replace' | 'replaceInteractions'>;
  costume: Live2DCostume;
}

export interface Live2DVoiceCatalogUpdate {
  characterId: string;
  characterLabels: Record<string, string>;
  voice: Live2DVoicePack;
}

export interface PublishVoiceOptions {
  packageRoot: string;
  characterId: string;
  characterLabels: Record<string, string>;
  sourceUrl: string;
  sourceRevision: string;
  acquiredAt: string;
  converterRepository: string;
  converterCommit: string;
  converterVersion?: string;
  licenseReferences: string[];
  publisher: string;
  approvedAudio: Set<string>;
  dryRun: boolean;
}

export interface PublishBehavior {
  /** 批量迁移时先发布不可变对象，随后由调用方一次性 CAS 合并目录。 */
  deferCatalog?: boolean;
}

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

export function parseArguments(arguments_: string[]): PublishOptions {
  const values = new Map<string, string>();
  const approvedAudio = new Set<string>();
  let dryRun = false;
  let replace = false;
  let replaceInteractions = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (argument === '--replace') {
      replace = true;
      continue;
    }
    if (argument === '--replace-interactions') {
      replaceInteractions = true;
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
    replace,
    replaceInteractions,
  };
}

export function getPublisherConfig(): HfS3Config {
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
  manifestObjects: Array<{
    path: string;
    size: number;
    mime: string;
    sha256: string;
  }>,
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

export async function publishImmutableJson(
  client: ReturnType<typeof createHfS3Client>,
  key: string,
  text: string,
  validateExisting?: (value: unknown) => void,
): Promise<void> {
  const bytes = new TextEncoder().encode(text);
  const existing = await client.get(key);
  if (existing) {
    if (existing.bytes.byteLength === bytes.byteLength && sha256(existing.bytes) === sha256(bytes)) return;
    if (validateExisting) {
      validateExisting(JSON.parse(new TextDecoder().decode(existing.bytes)));
      return;
    }
    throw new Error(`Existing immutable metadata conflicts for ${key}.`);
  }
  try {
    await client.put(key, bytes, 'application/json', { ifNoneMatch: '*' });
  } catch (error) {
    if (!(error instanceof HfS3ConflictError)) throw error;
    const raced = await client.get(key);
    if (!raced || raced.bytes.byteLength !== bytes.byteLength || sha256(raced.bytes) !== sha256(bytes)) throw error;
  }
}

export async function updateRemoteCatalog(
  client: ReturnType<typeof createHfS3Client>,
  options: Pick<PublishOptions, 'characterId' | 'characterLabels' | 'replace' | 'replaceInteractions'>,
  costume: Live2DCostume,
): Promise<void> {
  await updateRemoteCatalogBatch(client, [{ options, costume }], []);
}

/**
 * 一批 costume 只重写一次可变 catalog。CAS 冲突时基于最新快照重新合并，避免全量迁移
 * 随目录增长退化为逐模型 O(n²) 的元数据传输。
 */
export async function updateRemoteCatalogBatch(
  client: ReturnType<typeof createHfS3Client>,
  updates: readonly Live2DCatalogUpdate[],
  voiceUpdates: readonly Live2DVoiceCatalogUpdate[] = [],
): Promise<void> {
  if (updates.length === 0 && voiceUpdates.length === 0) return;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const snapshot = await client.get(LIVE2D_CATALOG_KEY);
    const catalog = snapshot ? live2dCatalogSchema.parse(JSON.parse(new TextDecoder().decode(snapshot.bytes))) : live2dCatalog;
    const nextCatalog = upsertCatalogBatch(catalog, updates, voiceUpdates);
    if (isDeepStrictEqual(catalog, nextCatalog)) return;
    if (snapshot && !snapshot.etag) throw new Error('Remote Live2D catalog response did not include an ETag.');
    const bytes = new TextEncoder().encode(`${JSON.stringify(nextCatalog, null, 2)}\n`);
    try {
      await client.put(
        LIVE2D_CATALOG_KEY,
        bytes,
        'application/json',
        snapshot?.etag ? { ifMatch: snapshot.etag } : { ifNoneMatch: '*' },
      );
      return;
    } catch (error) {
      if (!(error instanceof HfS3ConflictError) || attempt === 5) throw error;
    }
  }
}

/** 为批量同步器创建一次短生命周期客户端并原子提交一批目录更新。 */
export async function commitRemoteCatalogUpdates(
  updates: readonly Live2DCatalogUpdate[],
  voiceUpdates: readonly Live2DVoiceCatalogUpdate[] = [],
): Promise<void> {
  if (updates.length === 0 && voiceUpdates.length === 0) return;
  const client = createHfS3Client(getPublisherConfig(), {
    attempts: 5,
    transferTimeoutMs: 120_000,
  });
  await updateRemoteCatalogBatch(client, updates, voiceUpdates);
}

/** Removes superseded character aliases with the same optimistic concurrency contract as catalog publishing. */
export async function removeRemoteCatalogCharacters(characterIds: ReadonlySet<string>): Promise<void> {
  if (characterIds.size === 0) return;
  const client = createHfS3Client(getPublisherConfig(), {
    attempts: 5,
    transferTimeoutMs: 120_000,
  });
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const snapshot = await client.get(LIVE2D_CATALOG_KEY);
    if (!snapshot) return;
    const catalog = live2dCatalogSchema.parse(JSON.parse(new TextDecoder().decode(snapshot.bytes)));
    const nextCatalog = removeCatalogCharacters(catalog, characterIds);
    if (isDeepStrictEqual(catalog, nextCatalog)) return;
    if (!snapshot.etag) throw new Error('Remote Live2D catalog response did not include an ETag.');
    try {
      await client.put(
        LIVE2D_CATALOG_KEY,
        new TextEncoder().encode(`${JSON.stringify(nextCatalog, null, 2)}\n`),
        'application/json',
        { ifMatch: snapshot.etag },
      );
      return;
    } catch (error) {
      if (!(error instanceof HfS3ConflictError) || attempt === 5) throw error;
    }
  }
}

/** Pure catalog transform used by the Bestdori migration after canonical IDs have been published. */
export function removeCatalogCharacters(catalog: Live2DCatalog, characterIds: ReadonlySet<string>): Live2DCatalog {
  return live2dCatalogSchema.parse({
    ...catalog,
    characters: catalog.characters.filter((character) => !characterIds.has(character.id)),
  });
}

/** 默认只创建新 costume；显式 --replace 更新发布字段，但保留已有的手工交互配置。 */
export function upsertCatalog(
  catalog: Live2DCatalog,
  options: Pick<PublishOptions, 'characterId' | 'characterLabels' | 'replace' | 'replaceInteractions'>,
  costume: Live2DCostume,
): Live2DCatalog {
  return upsertCatalogBatch(catalog, [{ options, costume }]);
}

/** 克隆一次目录并合并一批发布结果；源目录和调用方传入的 costume 均保持不变。 */
export function upsertCatalogBatch(
  catalog: Live2DCatalog,
  updates: readonly Live2DCatalogUpdate[],
  voiceUpdates: readonly Live2DVoiceCatalogUpdate[] = [],
): Live2DCatalog {
  const characters = catalog.characters.map((character) => ({
    ...character,
    costumes: [...character.costumes],
  }));
  const charactersById = new Map(characters.map((character) => [character.id, character]));
  for (const { options, costume } of updates) {
    let character = charactersById.get(options.characterId);
    if (!character) {
      character = {
        id: options.characterId,
        label: { ...options.characterLabels },
        costumes: [],
      };
      characters.push(character);
      charactersById.set(character.id, character);
    }
    const existingIndex = character.costumes.findIndex((candidate) => candidate.id === costume.id);
    const existing = character.costumes[existingIndex];
    const nextCostume =
      existing && !options.replaceInteractions
        ? { ...costume, interactions: existing.interactions }
        : { ...costume, interactions: [...costume.interactions] };
    if (existing && isDeepStrictEqual(existing, nextCostume)) continue;
    if (existingIndex !== -1 && !options.replace) {
      throw new Error(
        `Catalog costume ${options.characterId}/${costume.id} already exists; pass --replace to replace it after verification.`,
      );
    }
    if (existingIndex === -1) character.costumes.push(nextCostume);
    else character.costumes[existingIndex] = nextCostume;
  }
  for (const update of voiceUpdates) {
    const character = charactersById.get(update.characterId);
    if (!character) {
      throw new Error(`Cannot attach a voice pack before character ${update.characterId} has a published costume.`);
    }
    character.voice = { ...update.voice };
  }
  return live2dCatalogSchema.parse({ version: 1, characters });
}

/** publishedAt 仅记录本次执行时间，其余 provenance 字段均属于不可变发布事实。 */
export function assertImmutableProvenanceMatches(existing: Live2DProvenance, next: Live2DProvenance): void {
  const { publishedAt: _existingPublishedAt, ...existingImmutable } = live2dProvenanceSchema.parse(existing);
  const { publishedAt: _nextPublishedAt, ...nextImmutable } = live2dProvenanceSchema.parse(next);
  if (!isDeepStrictEqual(existingImmutable, nextImmutable)) {
    throw new Error(`Existing provenance for release ${next.releaseId} conflicts with immutable publication fields.`);
  }
}

interface ImmutablePackageOptions {
  packageRoot: string;
  entryPath: string;
  sourceUrl: string;
  sourceRevision: string;
  acquiredAt: string;
  converterRepository: string;
  converterCommit: string;
  converterVersion?: string;
  licenseReferences: string[];
  publisher: string;
  approvedAudio: Set<string>;
  dryRun: boolean;
  converterOptions: Record<string, unknown>;
}

/**
 * Publishes one content-addressed package before any mutable catalog pointer is changed.
 * Both model and character-voice releases use this path so verification and CAS invariants stay identical.
 */
async function publishImmutablePackage(options: ImmutablePackageOptions) {
  const { manifest, transformedFiles } = await buildLive2DPackageManifest(options.packageRoot, {
    entryPath: options.entryPath,
    approvedAudio: options.approvedAudio,
  });
  const manifestText = serializeLive2DManifest(manifest);
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
      options: options.converterOptions,
    },
    manifestSha256: sha256(manifestText),
    licenseReferences: options.licenseReferences,
    publisher: options.publisher,
    publishedAt: new Date().toISOString(),
  });

  let client: ReturnType<typeof createHfS3Client> | null = null;
  if (!options.dryRun) {
    client = createHfS3Client(getPublisherConfig(), {
      attempts: 5,
      transferTimeoutMs: 120_000,
    });
    await publishObjects(client, manifest.releaseId, transformedFiles, manifest.objects);
    await publishImmutableJson(client, `manifests/${manifest.releaseId}.json`, manifestText);
    await publishImmutableJson(
      client,
      `provenance/${manifest.releaseId}.json`,
      `${JSON.stringify(provenance, null, 2)}\n`,
      (value) => assertImmutableProvenanceMatches(live2dProvenanceSchema.parse(value), provenance),
    );
  }
  return { client, manifest };
}

export async function publishLive2DModel(
  options: PublishOptions,
  interactions: Live2DInteraction[] = [{ area: 'head', motionGroup: 'smile01', lines: ['你好，很高兴见到你。'] }],
  behavior: PublishBehavior = {},
): Promise<{ releaseId: string; objectCount: number; totalBytes: number; costume: Live2DCostume }> {
  const { client, manifest } = await publishImmutablePackage({
    ...options,
    entryPath: 'model.json',
    converterOptions: {
      coreAudioRemoved: true,
      approvedAudio: [...options.approvedAudio].sort(),
    },
  });
  const costume: Live2DCostume = {
    id: options.costumeId,
    label: options.costumeLabels,
    releaseId: manifest.releaseId,
    entryPath: getLive2DObjectKey(manifest.releaseId, manifest.entryPath),
    packageBytes: manifest.totalBytes,
    scale: options.scale,
    position: options.position,
    interactions,
    provenancePath: `provenance/${manifest.releaseId}.json`,
  };

  if (client) {
    // catalog 是唯一可变指针，必须在 release 与两份不可变元数据全部验证后以 CAS 更新。
    if (!behavior.deferCatalog) await updateRemoteCatalog(client, options, costume);
  }
  console.log(
    `${options.dryRun ? 'Validated' : 'Published'} ${options.characterId}/${options.costumeId}: ${manifest.releaseId}`,
  );
  console.log(`${manifest.objects.length} immutable object(s), ${manifest.totalBytes} byte(s).`);
  return { releaseId: manifest.releaseId, objectCount: manifest.objects.length, totalBytes: manifest.totalBytes, costume };
}

/** Publishes one character-wide dialogue/audio pool without duplicating it into every costume release. */
export async function publishLive2DVoicePack(
  options: PublishVoiceOptions,
  interactions: Live2DInteraction[],
): Promise<{ releaseId: string; objectCount: number; totalBytes: number; voice: Live2DVoicePack }> {
  const index = live2dVoiceIndexSchema.parse({ version: 1, interactions });
  await writeFile(path.join(options.packageRoot, 'dialogues.json'), `${JSON.stringify(index, null, 2)}\n`);
  const { manifest } = await publishImmutablePackage({
    ...options,
    entryPath: 'dialogues.json',
    converterOptions: {
      aggregation: 'character',
      localePriority: ['ja', 'en'],
      approvedAudio: [...options.approvedAudio].sort(),
    },
  });
  const voice: Live2DVoicePack = {
    releaseId: manifest.releaseId,
    entryPath: getLive2DObjectKey(manifest.releaseId, manifest.entryPath),
    packageBytes: manifest.totalBytes,
    dialogueCount: index.interactions.reduce(
      (total, interaction) => total + (interaction.dialogues?.length ?? interaction.lines?.length ?? 0),
      0,
    ),
    provenancePath: `provenance/${manifest.releaseId}.json`,
  };
  console.log(
    `${options.dryRun ? 'Validated' : 'Published'} ${options.characterId}/voice: ${manifest.releaseId} (${voice.dialogueCount} dialogues)`,
  );
  return { releaseId: manifest.releaseId, objectCount: manifest.objects.length, totalBytes: manifest.totalBytes, voice };
}

async function main(): Promise<void> {
  await publishLive2DModel(parseArguments(process.argv.slice(2)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

// npm run publish:live2d-models -- --package /absolute/model-dir --character-id chihaya-anon --character-labels 'zh=千早爱音,en=Chihaya Anon,ja=千早愛音' --costume-id default --costume-labels 'zh=默认,en=Default,ja=デフォルト' --source-url https://bestdori.com/tool/explorer/asset/jp/live2d/chara --source-revision 037_live_default --acquired-at 2026-07-27T00:00:00.000Z --converter-repository https://github.com/A-kirami/bestdori-live2d-downloader --converter-commit b6f6b1b29352e073f5987da8b06d6ae1e4b70ef6 --license https://bestdori.com/info/terms,https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html --publisher clelele --scale 0.9 --position 0,-0.1
