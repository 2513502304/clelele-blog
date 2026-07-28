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
  /** 大型批量迁移可提高单个 release 内的对象并发；独立发布保留保守默认值。 */
  objectConcurrency?: number;
  /** 覆盖 HF S3 单次请求的重试次数；批量同步器应与其 CLI 参数保持一致。 */
  requestAttempts?: number;
  /** HEAD/DELETE 等小请求的独立超时。 */
  requestTimeoutMs?: number;
  /** PUT/GET 等传输请求的独立超时。 */
  transferTimeoutMs?: number;
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

type RemoteObjectVerifier = Pick<ReturnType<typeof createHfS3Client>, 'get' | 'head'>;

/**
 * HF 新对象写入后，HEAD 与 GET 偶尔会在很短的时间内看到不同快照。
 * 校验层允许这种瞬时不一致收敛，但绝不覆盖持续冲突的不可变 release。
 */
export async function verifyRemoteObject(
  client: RemoteObjectVerifier,
  key: string,
  expected: { size: number; sha256: string },
  options: { attempts?: number; delayMs?: number } = {},
): Promise<boolean> {
  const attempts = options.attempts ?? 4;
  const delayMs = options.delayMs ?? 500;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const head = await client.head(key);
    if (!head.exists) return false;
    const snapshot = await client.get(key);
    const sizeMatches = head.size === null || head.size === expected.size;
    const bytesMatch =
      snapshot !== null && snapshot.bytes.byteLength === expected.size && sha256(snapshot.bytes) === expected.sha256;
    if (sizeMatches && bytesMatch) return true;
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs * 2 ** (attempt - 1)));
    }
  }
  throw new Error(`Remote bytes conflict for ${key}.`);
}

type RemoteObjectPublisher = Pick<ReturnType<typeof createHfS3Client>, 'get' | 'head' | 'put'>;

export async function publishObjects(
  client: RemoteObjectPublisher,
  releaseId: string,
  files: Map<string, Uint8Array>,
  manifestObjects: Array<{
    path: string;
    size: number;
    mime: string;
    sha256: string;
  }>,
  options: { concurrency?: number } = {},
): Promise<void> {
  let completed = 0;
  const requestedConcurrency = options.concurrency ?? 6;
  const normalizedConcurrency = Number.isFinite(requestedConcurrency) ? Math.max(1, Math.floor(requestedConcurrency)) : 6;
  const concurrency = Math.min(normalizedConcurrency, manifestObjects.length);
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
          // SigV4 已把 payload SHA-256 签入请求；成功的条件 PUT 即是新对象的完整性确认。
          // 只有断点恢复或 412 竞争得到的既有对象才需要上面的 GET + SHA-256 全量复核。
        }
        completed += 1;
        console.log(`[${completed}/${manifestObjects.length}] verified ${object.path}`);
      }
    }),
  );
}

type ImmutableJsonPublisher = Pick<ReturnType<typeof createHfS3Client>, 'get' | 'put'>;

function reconcileExistingImmutableJson(
  existingBytes: Uint8Array,
  requestedBytes: Uint8Array,
  validateExisting?: (value: unknown) => void,
): boolean {
  if (existingBytes.byteLength === requestedBytes.byteLength && sha256(existingBytes) === sha256(requestedBytes)) {
    return true;
  }
  if (!validateExisting) return false;
  validateExisting(JSON.parse(new TextDecoder().decode(existingBytes)));
  return true;
}

export async function publishImmutableJson(
  client: ImmutableJsonPublisher,
  key: string,
  text: string,
  validateExisting?: (value: unknown) => void,
): Promise<void> {
  const bytes = new TextEncoder().encode(text);
  const existing = await client.get(key);
  if (existing) {
    if (reconcileExistingImmutableJson(existing.bytes, bytes, validateExisting)) return;
    throw new Error(`Existing immutable metadata conflicts for ${key}.`);
  }
  try {
    await client.put(key, bytes, 'application/json', { ifNoneMatch: '*' });
  } catch (error) {
    if (!(error instanceof HfS3ConflictError)) throw error;
    const raced = await client.get(key);
    if (raced && reconcileExistingImmutableJson(raced.bytes, bytes, validateExisting)) return;
    throw error;
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
  behavior: Pick<PublishBehavior, 'requestAttempts' | 'requestTimeoutMs' | 'transferTimeoutMs'> = {},
): Promise<void> {
  if (updates.length === 0 && voiceUpdates.length === 0) return;
  const client = createHfS3Client(getPublisherConfig(), {
    attempts: behavior.requestAttempts ?? 5,
    requestTimeoutMs: behavior.requestTimeoutMs ?? 120_000,
    transferTimeoutMs: behavior.transferTimeoutMs ?? 120_000,
  });
  await updateRemoteCatalogBatch(client, updates, voiceUpdates);
}

/** Removes superseded character aliases with the same optimistic concurrency contract as catalog publishing. */
export async function removeRemoteCatalogCharacters(
  characterIds: ReadonlySet<string>,
  behavior: Pick<PublishBehavior, 'requestAttempts' | 'requestTimeoutMs' | 'transferTimeoutMs'> = {},
): Promise<void> {
  if (characterIds.size === 0) return;
  const client = createHfS3Client(getPublisherConfig(), {
    attempts: behavior.requestAttempts ?? 5,
    requestTimeoutMs: behavior.requestTimeoutMs ?? 120_000,
    transferTimeoutMs: behavior.transferTimeoutMs ?? 120_000,
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

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableJson(entry)]),
    );
  }
  return value;
}

function getImmutableProvenanceIdentity(value: Live2DProvenance) {
  const provenance = live2dProvenanceSchema.parse(value);
  const { acquiredAt: _acquiredAt, ...source } = provenance.source;
  const { commit: _commit, ...converter } = provenance.converter;
  const { publishedAt: _publishedAt, source: _source, converter: _converter, ...rest } = provenance;
  return { ...rest, source, converter };
}

/**
 * 同一组模型字节可能由多个 Bestdori 入口复用。release 继续按内容去重，来源记录则按
 * 不含执行时间与当前 Git commit 的语义身份分开，避免来源别名互相覆盖或重复执行产生新 key。
 */
export function getProvenanceObjectKey(value: Live2DProvenance): string {
  const provenance = live2dProvenanceSchema.parse(value);
  const identity = stableJson(getImmutableProvenanceIdentity(provenance));
  return `provenance/${provenance.releaseId}/${sha256(JSON.stringify(identity))}.json`;
}

/** 发现时间、发布时间和执行代码 commit 不改变已发布字节，其余字段必须保持一致。 */
export function assertImmutableProvenanceMatches(existing: Live2DProvenance, next: Live2DProvenance): void {
  const parsedNext = live2dProvenanceSchema.parse(next);
  if (!isDeepStrictEqual(getImmutableProvenanceIdentity(existing), getImmutableProvenanceIdentity(parsedNext))) {
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
  objectConcurrency?: number;
  requestAttempts?: number;
  requestTimeoutMs?: number;
  transferTimeoutMs?: number;
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
  const provenancePath = getProvenanceObjectKey(provenance);

  let client: ReturnType<typeof createHfS3Client> | null = null;
  if (!options.dryRun) {
    client = createHfS3Client(getPublisherConfig(), {
      attempts: options.requestAttempts ?? 5,
      requestTimeoutMs: options.requestTimeoutMs ?? 120_000,
      transferTimeoutMs: options.transferTimeoutMs ?? 120_000,
    });
    await publishObjects(client, manifest.releaseId, transformedFiles, manifest.objects, {
      concurrency: options.objectConcurrency,
    });
    await publishImmutableJson(client, `manifests/${manifest.releaseId}.json`, manifestText);
    await publishImmutableJson(client, provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, (value) =>
      assertImmutableProvenanceMatches(live2dProvenanceSchema.parse(value), provenance),
    );
  }
  return { client, manifest, provenancePath };
}

export async function publishLive2DModel(
  options: PublishOptions,
  interactions: Live2DInteraction[] = [{ area: 'head', motionGroup: 'smile01', lines: ['你好，很高兴见到你。'] }],
  behavior: PublishBehavior = {},
): Promise<{ releaseId: string; objectCount: number; totalBytes: number; costume: Live2DCostume }> {
  const { client, manifest, provenancePath } = await publishImmutablePackage({
    ...options,
    entryPath: 'model.json',
    converterOptions: {
      coreAudioRemoved: true,
      approvedAudio: [...options.approvedAudio].sort(),
    },
    objectConcurrency: behavior.objectConcurrency,
    requestAttempts: behavior.requestAttempts,
    requestTimeoutMs: behavior.requestTimeoutMs,
    transferTimeoutMs: behavior.transferTimeoutMs,
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
    provenancePath,
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
  behavior: PublishBehavior = {},
): Promise<{ releaseId: string; objectCount: number; totalBytes: number; voice: Live2DVoicePack }> {
  const index = live2dVoiceIndexSchema.parse({ version: 1, interactions });
  await writeFile(path.join(options.packageRoot, 'dialogues.json'), `${JSON.stringify(index, null, 2)}\n`);
  const { manifest, provenancePath } = await publishImmutablePackage({
    ...options,
    entryPath: 'dialogues.json',
    converterOptions: {
      aggregation: 'character',
      localePriority: ['ja', 'en'],
      approvedAudio: [...options.approvedAudio].sort(),
    },
    objectConcurrency: behavior.objectConcurrency,
    requestAttempts: behavior.requestAttempts,
    requestTimeoutMs: behavior.requestTimeoutMs,
    transferTimeoutMs: behavior.transferTimeoutMs,
  });
  const voice: Live2DVoicePack = {
    releaseId: manifest.releaseId,
    entryPath: getLive2DObjectKey(manifest.releaseId, manifest.entryPath),
    packageBytes: manifest.totalBytes,
    dialogueCount: index.interactions.reduce(
      (total, interaction) => total + (interaction.dialogues?.length ?? interaction.lines?.length ?? 0),
      0,
    ),
    provenancePath,
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
