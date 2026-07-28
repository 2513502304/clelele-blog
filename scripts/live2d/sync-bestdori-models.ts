import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Live2DCostume, Live2DInteraction, Live2DVoicePack } from '../../src/lib/live2d/types';
import {
  commitRemoteCatalogUpdates,
  type Live2DCatalogUpdate,
  type Live2DVoiceCatalogUpdate,
  publishLive2DModel,
  publishLive2DVoicePack,
  removeRemoteCatalogCharacters,
} from './publish-models';

const BESTDORI_API = 'https://bestdori.com/api';
const BESTDORI_ASSETS = 'https://bestdori.com/assets';
const DEFAULT_SERVERS = ['jp', 'cn', 'en', 'kr', 'tw'] as const;
const CONVERTER_COMMIT = 'b6f6b1b29352e073f5987da8b06d6ae1e4b70ef6';

interface Options {
  workspace: string;
  modelConcurrency: number;
  fileConcurrency: number;
  catalogBatchSize: number;
  attempts: number;
  timeoutMs: number;
  limit?: number;
  models: Set<string>;
  keepPackages: boolean;
  skipAudio: boolean;
  planOnly: boolean;
  refreshIndex: boolean;
  republish: boolean;
  republishVoices: boolean;
}

interface BundleFile {
  bundleName: string;
  fileName: string;
}

interface BuildData {
  model: BundleFile;
  physics?: BundleFile;
  textures: BundleFile[];
  motions: BundleFile[];
  expressions: BundleFile[];
}

class NonRetryableBestdoriResponseError extends Error {}

export class BestdoriAssetUnavailableError extends Error {
  constructor(
    readonly url: string,
    detail = 'indexed asset is no longer downloadable',
  ) {
    super(`Bestdori ${detail}: ${url}`);
    this.name = 'BestdoriAssetUnavailableError';
  }
}

interface SourceIndex {
  acquiredAt: string;
  cardsAcquiredAt?: string;
  assets: Array<{ model: string; server: string }>;
  characters: Record<string, { characterName?: Array<string | null> }>;
  costumes: Record<
    string,
    {
      characterId: number;
      assetBundleName: string;
      description?: Array<string | null>;
    }
  >;
  cards: Record<
    string,
    {
      characterId: number;
      resourceSetName?: string;
      prefix?: Array<string | null>;
    }
  >;
}

function integer(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function parseArguments(arguments_: string[]): Options {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (
      ['--keep-packages', '--skip-audio', '--plan-only', '--refresh-index', '--republish', '--republish-voices'].includes(
        argument,
      )
    ) {
      flags.add(argument);
      continue;
    }
    const value = arguments_[index + 1];
    if (!argument.startsWith('--') || !value || value.startsWith('--')) throw new Error(`Invalid argument: ${argument}`);
    values.set(argument, value);
    index += 1;
  }
  const limit = values.get('--limit');
  return {
    workspace: path.resolve(values.get('--workspace') ?? '.cache/live2d-bestdori'),
    modelConcurrency: integer(values.get('--model-concurrency') ?? '3', '--model-concurrency'),
    fileConcurrency: integer(values.get('--file-concurrency') ?? '16', '--file-concurrency'),
    catalogBatchSize: integer(values.get('--catalog-batch-size') ?? '100', '--catalog-batch-size'),
    attempts: integer(values.get('--attempts') ?? '5', '--attempts'),
    timeoutMs: integer(values.get('--timeout-ms') ?? '60000', '--timeout-ms'),
    limit: limit ? integer(limit, '--limit') : undefined,
    models: new Set((values.get('--models') ?? '').split(',').filter(Boolean)),
    keepPackages: flags.has('--keep-packages'),
    skipAudio: flags.has('--skip-audio'),
    planOnly: flags.has('--plan-only'),
    refreshIndex: flags.has('--refresh-index'),
    republish: flags.has('--republish'),
    republishVoices: flags.has('--republish-voices'),
  };
}

async function request(url: string, options: Options, allowMissing = false): Promise<Response | null> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(options.timeoutMs) });
      if (allowMissing && response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        if (response.body) await response.body.cancel().catch(() => undefined);
        if (!retryable) throw new NonRetryableBestdoriResponseError(`${url} returned ${response.status}.`);
        throw new Error(`${url} temporarily returned ${response.status}.`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (error instanceof NonRetryableBestdoriResponseError) throw error;
      if (attempt === options.attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200)));
    }
  }
  throw new Error(`Request failed after ${options.attempts} attempts: ${url}`, { cause: lastError });
}

async function fetchJson<T>(url: string, options: Options): Promise<T> {
  const response = await request(url, options);
  return (await response?.json()) as T;
}

async function fetchAssetJson<T>(url: string, options: Options): Promise<T> {
  const response = await request(url, options, true);
  if (!response) throw new BestdoriAssetUnavailableError(url, 'returned 404 for required asset');
  if (response?.headers.get('content-type')?.startsWith('text/html')) {
    await response.body?.cancel();
    throw new BestdoriAssetUnavailableError(url, 'returned HTML for required asset');
  }
  return (await response?.json()) as T;
}

async function readJsonIfExists<T>(file: string): Promise<T | null> {
  return readFile(file, 'utf8')
    .then((text) => JSON.parse(text) as T)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
}

async function cachedJson<T>(file: string, url: string, options: Options): Promise<T> {
  const cached = await readJsonIfExists<T>(file);
  if (cached) return cached;
  const value = await fetchJson<T>(url, options);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
  return value;
}

async function loadSourceIndex(options: Options): Promise<SourceIndex> {
  const file = path.join(options.workspace, 'source-index.json');
  if (!options.refreshIndex) {
    const cached = await readJsonIfExists<SourceIndex>(file);
    if (cached?.cards) return cached;
    if (cached) {
      const cards = await fetchJson<SourceIndex['cards']>(`${BESTDORI_API}/cards/all.5.json`, options);
      const upgraded = { ...cached, cards, cardsAcquiredAt: new Date().toISOString() };
      await writeFile(file, `${JSON.stringify(upgraded, null, 2)}\n`);
      return upgraded;
    }
  }
  const [characters, costumes, cards, ...assetIndexes] = await Promise.all([
    fetchJson<SourceIndex['characters']>(`${BESTDORI_API}/characters/all.2.json`, options),
    fetchJson<SourceIndex['costumes']>(`${BESTDORI_API}/costumes/all.5.json`, options),
    fetchJson<SourceIndex['cards']>(`${BESTDORI_API}/cards/all.5.json`, options),
    ...DEFAULT_SERVERS.map((server) =>
      fetchJson<{ live2d?: { chara?: Record<string, unknown> } }>(
        `${BESTDORI_API}/explorer/${server}/assets/_info.json`,
        options,
      ),
    ),
  ]);
  const assets = new Map<string, string>();
  assetIndexes.forEach((index, position) => {
    const server = DEFAULT_SERVERS[position];
    for (const model of Object.keys(index.live2d?.chara ?? {})) {
      if (!model.endsWith('_general') && !assets.has(model)) assets.set(model, server);
    }
  });
  const source: SourceIndex = {
    acquiredAt: new Date().toISOString(),
    cardsAcquiredAt: new Date().toISOString(),
    assets: [...assets]
      .map(([model, server]) => ({ model, server }))
      .sort((left, right) => left.model.localeCompare(right.model)),
    characters,
    costumes,
    cards,
  };
  await mkdir(options.workspace, { recursive: true });
  await writeFile(file, `${JSON.stringify(source, null, 2)}\n`);
  return source;
}

function safeName(value: string): string {
  const name = path.posix.basename(value.replace(/\.bytes$/, ''));
  if (!name || name === '.' || name === '..') throw new Error(`Unsafe Bestdori file name: ${value}`);
  return name;
}

async function fileExists(file: string): Promise<boolean> {
  return stat(file)
    .then((value) => value.isFile() && value.size > 0)
    .catch(() => false);
}

/**
 * Bestdori 的索引偶尔会保留已经下线的文件，并用 HTML 页面响应资源 URL。
 * 可选资源（目前是 physics）缺失时允许继续发布；模型、贴图等必需资源缺失时必须跳过整个模型。
 */
export async function readBestdoriBundleResponse(
  response: Response | null,
  url: string,
  allowMissing: boolean,
): Promise<Uint8Array | null> {
  const unavailable = (detail: string) => {
    if (allowMissing) return null;
    throw new BestdoriAssetUnavailableError(url, detail);
  };
  if (!response) return unavailable('returned 404 for required asset');
  if (response.headers.get('content-type')?.startsWith('text/html')) {
    await response.body?.cancel();
    return unavailable('returned HTML for required asset');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.byteLength > 0 ? bytes : unavailable('returned an empty required asset');
}

async function downloadBundleFile(
  source: BundleFile,
  destination: string,
  server: string,
  options: Options,
  allowMissing = false,
): Promise<boolean> {
  if (await fileExists(destination)) return true;
  const url = `${BESTDORI_ASSETS}/${server}/${source.bundleName}_rip/${source.fileName}`;
  const response = await request(url, options, true);
  const bytes = await readBestdoriBundleResponse(response, url, allowMissing);
  if (!bytes) return false;
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.part`;
  await writeFile(temporary, bytes);
  await rename(temporary, destination);
  return true;
}

async function runPool<T>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor];
        cursor += 1;
        await worker(item);
      }
    }),
  );
}

async function buildPackage(model: string, server: string, root: string, options: Options): Promise<void> {
  const build = await fetchAssetJson<{ Base: BuildData }>(
    `${BESTDORI_ASSETS}/${server}/live2d/chara/${model}_rip/buildData.asset`,
    options,
  );
  if (!build.Base?.model) throw new Error(`Bestdori buildData is invalid for ${model}.`);
  const data = build.Base;
  data.model.fileName = data.model.fileName.replace(/\.bytes$/, '');
  data.motions = (data.motions ?? []).map((motion) => ({ ...motion, fileName: motion.fileName.replace(/\.bytes$/, '') }));
  data.textures = (data.textures ?? []).map((texture) => ({
    ...texture,
    fileName: texture.fileName.includes('.') ? texture.fileName : `${texture.fileName}.png`,
  }));

  const modelPath = path.join(root, 'data/model.moc');
  const physicsPath = path.join(root, 'data/physics.json');
  const tasks: Array<{ source: BundleFile; destination: string; optional?: boolean }> = [
    { source: data.model, destination: modelPath },
    ...(data.physics?.bundleName ? [{ source: data.physics, destination: physicsPath, optional: true }] : []),
    ...data.textures.map((source) => ({ source, destination: path.join(root, 'data/textures', safeName(source.fileName)) })),
    ...data.motions.map((source) => ({ source, destination: path.join(root, 'data/motions', safeName(source.fileName)) })),
    ...(data.expressions ?? []).map((source) => ({
      source,
      destination: path.join(root, 'data/expressions', safeName(source.fileName)),
    })),
  ];
  const present = new Set<string>();
  await runPool(tasks, options.fileConcurrency, async (task) => {
    if (await downloadBundleFile(task.source, task.destination, server, options, task.optional)) present.add(task.destination);
  });
  if (!present.has(modelPath) && !(await fileExists(modelPath))) throw new Error(`Model binary is missing for ${model}.`);

  const relative = (file: string) => path.relative(root, file).split(path.sep).join('/');
  const motions = Object.fromEntries(
    data.motions.map((source) => {
      const file = path.join(root, 'data/motions', safeName(source.fileName));
      return [path.parse(file).name, [{ file: relative(file) }]];
    }),
  );
  const expressions = (data.expressions ?? []).map((source) => {
    const file = path.join(root, 'data/expressions', safeName(source.fileName));
    return { name: path.parse(file).name, file: relative(file) };
  });
  const modelJson = {
    version: 'Sample 1.0.0',
    layout: { center_x: 0, center_y: 0, width: 2 },
    hit_areas_custom: { head_x: [-0.25, 1], head_y: [0.25, 0.2], body_x: [-0.3, 0.2], body_y: [0.3, -1.9] },
    model: relative(modelPath),
    ...((await fileExists(physicsPath)) ? { physics: relative(physicsPath) } : {}),
    textures: data.textures.map((source) => relative(path.join(root, 'data/textures', safeName(source.fileName)))),
    motions,
    expressions,
  };
  await writeFile(path.join(root, 'model.json'), `${JSON.stringify(modelJson, null, 2)}\n`);
}

function localized(values: Array<string | null> | undefined, fallback: string): Record<string, string> {
  return {
    zh: values?.[3]?.trim() || values?.[0]?.trim() || fallback,
    en: values?.[1]?.trim() || values?.[0]?.trim() || fallback,
    ja: values?.[0]?.trim() || values?.[1]?.trim() || fallback,
  };
}

function characterIdForModel(model: string): string | null {
  const match = model.match(/^(?:bili_)?(\d{3})_/);
  return match ? String(Number.parseInt(match[1], 10)) : null;
}

const bootstrapCharacterIds = new Map([
  ['36', 'takamatsu-tomori'],
  ['37', 'chihaya-anon'],
]);

function catalogCharacterId(numericCharacterId: string): string {
  return bootstrapCharacterIds.get(numericCharacterId) ?? `bestdori-${numericCharacterId}`;
}

function costumeId(model: string): string {
  const bootstrap = new Map([
    ['037_live_default', 'default'],
    ['037_live_sr_01', 'live-sr-01'],
    ['036_live_default', 'default'],
    ['036_live_sr_01', 'live-sr-01'],
  ]);
  return (
    bootstrap.get(model) ??
    model
      .toLocaleLowerCase('en-US')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  );
}

interface BestdoriCardDetail {
  resourceSetName?: string;
  gachaText?: Array<string | null>;
  prefix?: Array<string | null>;
  type?: string;
}

/** Card summaries provide the complete character relation; costume records alone omit cards from other outfits. */
export function characterCardIds(cards: SourceIndex['cards'], numericCharacterId: string): string[] {
  const characterId = Number.parseInt(numericCharacterId, 10);
  return Object.entries(cards)
    .filter(([, card]) => card.characterId === characterId)
    .map(([cardId]) => cardId)
    .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));
}

/** Japanese gacha text is authoritative; English and card-prefix text are explicit fallbacks. */
export function cardDialogueText(card: BestdoriCardDetail, summary: SourceIndex['cards'][string] | undefined): string | null {
  return (
    card.gachaText?.[0]?.trim() ||
    card.gachaText?.[1]?.trim() ||
    card.prefix?.[0]?.trim() ||
    card.prefix?.[1]?.trim() ||
    summary?.prefix?.[0]?.trim() ||
    summary?.prefix?.[1]?.trim() ||
    null
  );
}

/** Bestdori only exposes a matching gacha MP3 when the card has localized gacha dialogue text. */
export function cardHasVoiceText(card: BestdoriCardDetail): boolean {
  return Boolean(card.gachaText?.[0]?.trim() || card.gachaText?.[1]?.trim());
}

const GACHA_VOICE_DIRECTORIES = ['operationspin', 'limitedspin', 'birthdayspin', 'spin', 'newsituationintroduction'] as const;

/** Type-based ordering avoids predictable HTML misses while fallbacks cover new or historic card categories. */
export function cardVoiceDirectories(type: string | undefined): readonly string[] {
  const preferred =
    type === 'birthday'
      ? 'birthdayspin'
      : type === 'limited' || type === 'dreamfes'
        ? 'limitedspin'
        : type === 'permanent'
          ? 'operationspin'
          : null;
  return preferred
    ? [preferred, ...GACHA_VOICE_DIRECTORIES.filter((directory) => directory !== preferred)]
    : GACHA_VOICE_DIRECTORIES;
}

function modelFallbackInteractions(
  model: string,
  costumeEntry: [string, SourceIndex['costumes'][string]] | undefined,
): Live2DInteraction[] {
  return [{ area: 'head', dialogues: [{ text: localized(costumeEntry?.[1].description, model).ja }] }];
}

function currentGitCommit(): string {
  return (
    process.env.GITHUB_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  );
}

async function buildAndPublishCharacterVoice(
  numericCharacterId: string,
  source: SourceIndex,
  options: Options,
): Promise<{ characterId: string; characterLabels: Record<string, string>; voice: Live2DVoicePack }> {
  const cardIds = characterCardIds(source.cards, numericCharacterId);
  const packageRoot = path.join(options.workspace, 'voices', numericCharacterId);
  const apiCache = path.join(options.workspace, 'api-cache', 'cards');
  const dialogues = new Array<{ text: string; audio?: string } | null>(cardIds.length).fill(null);
  const approvedAudio = new Set<string>();
  await mkdir(packageRoot, { recursive: true });

  await runPool(
    cardIds.map((cardId, index) => ({ cardId, index })),
    options.fileConcurrency,
    async ({ cardId, index }) => {
      const summary = source.cards[cardId];
      const card = await cachedJson<BestdoriCardDetail>(
        path.join(apiCache, `${cardId}.json`),
        `${BESTDORI_API}/cards/${cardId}.json`,
        options,
      );
      const text = cardDialogueText(card, summary);
      if (!text) return;
      const resourceSetName = card.resourceSetName ?? summary?.resourceSetName;
      const relativeAudio = `audio/gacha-${cardId}.mp3`;
      if (!options.skipAudio && resourceSetName && cardHasVoiceText(card)) {
        const destination = path.join(packageRoot, relativeAudio);
        if (
          (await fileExists(destination)) ||
          (await (async () => {
            for (const directory of cardVoiceDirectories(card.type)) {
              const response = await request(
                `${BESTDORI_ASSETS}/jp/sound/voice/gacha/${directory}_rip/${resourceSetName}.mp3`,
                options,
                true,
              );
              if (!response) continue;
              if (response.headers.get('content-type')?.startsWith('text/html')) {
                // 未消费的 fallback body 会让 Undici 连接保持活跃，并阻止批量同步进程退出。
                await response.body?.cancel();
                continue;
              }
              await mkdir(path.dirname(destination), { recursive: true });
              await writeFile(destination, new Uint8Array(await response.arrayBuffer()));
              return true;
            }
            return false;
          })())
        ) {
          approvedAudio.add(relativeAudio);
          dialogues[index] = { text, audio: relativeAudio };
          return;
        }
      }
      dialogues[index] = { text };
    },
  );

  const characterLabels = localized(source.characters[numericCharacterId]?.characterName, `Bestdori ${numericCharacterId}`);
  const visibleDialogues = dialogues.filter((dialogue): dialogue is { text: string; audio?: string } => dialogue !== null);
  if (visibleDialogues.length === 0) visibleDialogues.push({ text: characterLabels.ja });
  const interactions: Live2DInteraction[] = [{ area: 'head', dialogues: visibleDialogues }];
  const result = await publishLive2DVoicePack(
    {
      packageRoot,
      characterId: catalogCharacterId(numericCharacterId),
      characterLabels,
      sourceUrl: `${BESTDORI_API}/cards/all.5.json`,
      sourceRevision: createHash('sha256').update(cardIds.join(',')).digest('hex'),
      acquiredAt: source.cardsAcquiredAt ?? source.acquiredAt,
      converterRepository: 'https://github.com/2513502304/clelele-blog',
      converterCommit: currentGitCommit(),
      converterVersion: 'Bestdori character voice pack v1',
      licenseReferences: ['https://bestdori.com/info/terms'],
      publisher: 'clelele',
      approvedAudio,
      dryRun: false,
    },
    interactions,
    {
      objectConcurrency: options.fileConcurrency,
      requestAttempts: options.attempts,
      requestTimeoutMs: options.timeoutMs,
      transferTimeoutMs: options.timeoutMs,
    },
  );
  if (!options.keepPackages) await rm(packageRoot, { recursive: true, force: true });
  return { characterId: catalogCharacterId(numericCharacterId), characterLabels, voice: result.voice };
}

interface CheckpointRecord {
  model: string;
  server: string;
  status: 'uploaded' | 'cataloged' | 'published' | 'skipped';
  releaseId?: string;
  publishedAt: string;
  reason?: string;
  characterId?: string;
  characterLabels?: Record<string, string>;
  costume?: Live2DCostume;
}

interface CheckpointState {
  completed: Set<string>;
  pendingCatalog: Map<string, UploadedCheckpointRecord>;
}

type UploadedCheckpointRecord = CheckpointRecord &
  Required<Pick<CheckpointRecord, 'releaseId' | 'characterId' | 'characterLabels' | 'costume'>>;

interface VoiceCheckpointRecord {
  characterId: string;
  characterLabels: Record<string, string>;
  status: 'uploaded' | 'cataloged';
  voice: Live2DVoicePack;
  publishedAt: string;
}

interface VoiceCheckpointState {
  completed: Set<string>;
  pendingCatalog: Map<string, VoiceCheckpointRecord>;
}

export async function checkpointState(file: string): Promise<CheckpointState> {
  const text = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const completed = new Set<string>();
  const pendingCatalog = new Map<string, UploadedCheckpointRecord>();
  for (const line of text.split('\n').filter(Boolean)) {
    const entry = JSON.parse(line) as CheckpointRecord;
    if (entry.status === 'cataloged' || entry.status === 'published' || entry.status === 'skipped') {
      completed.add(entry.model);
      pendingCatalog.delete(entry.model);
      continue;
    }
    if (entry.status === 'uploaded' && entry.releaseId && entry.characterId && entry.characterLabels && entry.costume) {
      pendingCatalog.set(entry.model, {
        ...entry,
        releaseId: entry.releaseId,
        characterId: entry.characterId,
        characterLabels: entry.characterLabels,
        costume: entry.costume,
      });
    }
  }
  return { completed, pendingCatalog };
}

export async function voiceCheckpointState(file: string): Promise<VoiceCheckpointState> {
  const text = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const completed = new Set<string>();
  const pendingCatalog = new Map<string, VoiceCheckpointRecord>();
  for (const line of text.split('\n').filter(Boolean)) {
    const entry = JSON.parse(line) as VoiceCheckpointRecord;
    if (entry.status === 'cataloged') {
      completed.add(entry.characterId);
      pendingCatalog.delete(entry.characterId);
    } else if (entry.status === 'uploaded') {
      pendingCatalog.set(entry.characterId, entry);
    }
  }
  return { completed, pendingCatalog };
}

function catalogUpdate(record: UploadedCheckpointRecord) {
  return {
    options: {
      characterId: record.characterId,
      characterLabels: record.characterLabels,
      replace: true,
      replaceInteractions: true,
    },
    costume: record.costume,
  } satisfies Live2DCatalogUpdate;
}

function voiceCatalogUpdate(record: VoiceCheckpointRecord): Live2DVoiceCatalogUpdate {
  return {
    characterId: record.characterId,
    characterLabels: record.characterLabels,
    voice: record.voice,
  };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const source = await loadSourceIndex(options);
  const checkpoint = path.join(options.workspace, 'manifest.jsonl');
  const voiceCheckpoint = path.join(options.workspace, 'voice-manifest.jsonl');
  const checkpointSnapshot = await checkpointState(checkpoint);
  const voiceCheckpointSnapshot = await voiceCheckpointState(voiceCheckpoint);
  const completed = checkpointSnapshot.completed;
  const costumesByAsset = new Map(
    Object.entries(source.costumes)
      .filter((entry) => entry[1].assetBundleName)
      .map((entry) => [entry[1].assetBundleName, entry] as const),
  );
  const requestedAssets = source.assets.filter(({ model }) => options.models.size === 0 || options.models.has(model));
  let tasks = requestedAssets.filter(({ model }) => {
    const alreadyUploaded = checkpointSnapshot.pendingCatalog.has(model);
    return options.republish || (!completed.has(model) && !alreadyUploaded);
  });
  if (options.limit) tasks = tasks.slice(0, options.limit);
  const voiceScope = options.limit ? tasks : requestedAssets;
  const targetVoiceCharacterIds = new Set(
    voiceScope.map(({ model }) => characterIdForModel(model)).filter((value): value is string => value !== null),
  );
  const voiceTasks = [...targetVoiceCharacterIds].filter((numericCharacterId) => {
    const characterId = catalogCharacterId(numericCharacterId);
    return (
      options.republish ||
      options.republishVoices ||
      (!voiceCheckpointSnapshot.completed.has(characterId) && !voiceCheckpointSnapshot.pendingCatalog.has(characterId))
    );
  });
  console.log(
    `Bestdori index: ${source.assets.length} renderable model(s); ${tasks.length} model package(s) pending; ${voiceTasks.length} character voice package(s) pending; ${checkpointSnapshot.pendingCatalog.size + voiceCheckpointSnapshot.pendingCatalog.size} catalog update(s) recovering.`,
  );
  if (options.planOnly) return;

  await mkdir(path.dirname(checkpoint), { recursive: true });
  const failures: Array<{ asset: string; error: unknown }> = [];
  const supersededCharacterIds = new Set<string>();
  let finished = 0;
  let checkpointTail = Promise.resolve();
  const appendCheckpoint = (record: CheckpointRecord) => {
    checkpointTail = checkpointTail.then(() => appendFile(checkpoint, `${JSON.stringify(record)}\n`));
    return checkpointTail;
  };
  const appendVoiceCheckpoint = (record: VoiceCheckpointRecord) => {
    checkpointTail = checkpointTail.then(() => appendFile(voiceCheckpoint, `${JSON.stringify(record)}\n`));
    return checkpointTail;
  };
  const pendingVoices = new Map(voiceCheckpointSnapshot.pendingCatalog);
  const commitCatalogBatch = async (
    records: UploadedCheckpointRecord[],
    voiceRecords = [...pendingVoices.values()].filter((voice) =>
      records.some((record) => record.characterId === voice.characterId),
    ),
  ) => {
    if (records.length === 0 && voiceRecords.length === 0) return;
    await commitRemoteCatalogUpdates(records.map(catalogUpdate), voiceRecords.map(voiceCatalogUpdate), {
      requestAttempts: options.attempts,
      requestTimeoutMs: options.timeoutMs,
      transferTimeoutMs: options.timeoutMs,
    });
    for (const record of records) {
      await appendCheckpoint({ ...record, status: 'cataloged' });
      completed.add(record.model);
    }
    for (const record of voiceRecords) {
      await appendVoiceCheckpoint({ ...record, status: 'cataloged' });
      voiceCheckpointSnapshot.completed.add(record.characterId);
      pendingVoices.delete(record.characterId);
    }
    console.log(`Cataloged ${records.length} model(s) and ${voiceRecords.length} character voice pack(s) in one atomic batch.`);
  };

  await runPool(voiceTasks, options.modelConcurrency, async (numericCharacterId) => {
    try {
      const result = await buildAndPublishCharacterVoice(numericCharacterId, source, options);
      const record: VoiceCheckpointRecord = {
        ...result,
        status: 'uploaded',
        publishedAt: new Date().toISOString(),
      };
      await appendVoiceCheckpoint(record);
      pendingVoices.set(record.characterId, record);
      console.log(`Uploaded character voice pack ${record.characterId} (${record.voice.dialogueCount} dialogues).`);
    } catch (error) {
      failures.push({ asset: `voice:${numericCharacterId}`, error });
      console.error(`Failed voice:${numericCharacterId}:`, error instanceof Error ? error.message : error);
    }
  });

  await commitCatalogBatch([...checkpointSnapshot.pendingCatalog.values()]);

  for (let offset = 0; offset < tasks.length; offset += options.catalogBatchSize) {
    const batch = tasks.slice(offset, offset + options.catalogBatchSize);
    const uploaded: UploadedCheckpointRecord[] = [];
    await runPool(batch, options.modelConcurrency, async ({ model, server }) => {
      const numericCharacterId = characterIdForModel(model);
      if (!numericCharacterId) {
        const reason = 'Bestdori index entry is not a character model.';
        await appendCheckpoint({ model, server, status: 'skipped', publishedAt: new Date().toISOString(), reason });
        completed.add(model);
        finished += 1;
        console.warn(`[${finished}/${tasks.length}] skipped non-character ${model}`);
        return;
      }
      const packageRoot = path.join(options.workspace, 'packages', model);
      try {
        await buildPackage(model, server, packageRoot, options);
        const costumeEntry = costumesByAsset.get(model);
        const interactions = modelFallbackInteractions(model, costumeEntry);
        const characterId = catalogCharacterId(numericCharacterId);
        const characterLabels = localized(
          source.characters[numericCharacterId]?.characterName,
          `Bestdori ${numericCharacterId}`,
        );
        const result = await publishLive2DModel(
          {
            packageRoot,
            characterId,
            characterLabels,
            costumeId: costumeId(model),
            costumeLabels: localized(costumeEntry?.[1].description, model),
            sourceUrl: `https://bestdori.com/tool/explorer/asset/${server}/live2d/chara/${model}`,
            sourceRevision: model,
            acquiredAt: source.acquiredAt,
            converterRepository: 'https://github.com/A-kirami/bestdori-live2d-downloader',
            converterCommit: CONVERTER_COMMIT,
            converterVersion: 'TypeScript headless port',
            licenseReferences: [
              'https://bestdori.com/info/terms',
              'https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html',
            ],
            publisher: 'clelele',
            scale: 0.9,
            position: [0, -0.1],
            approvedAudio: new Set(),
            dryRun: false,
            replace: true,
            replaceInteractions: true,
          },
          interactions,
          {
            deferCatalog: true,
            objectConcurrency: options.fileConcurrency,
            requestAttempts: options.attempts,
            requestTimeoutMs: options.timeoutMs,
            transferTimeoutMs: options.timeoutMs,
          },
        );
        const record = {
          model,
          server,
          status: 'uploaded' as const,
          releaseId: result.releaseId,
          publishedAt: new Date().toISOString(),
          characterId,
          characterLabels,
          costume: result.costume,
        };
        await appendCheckpoint(record);
        uploaded.push(record);
        if (bootstrapCharacterIds.has(numericCharacterId)) supersededCharacterIds.add(`bestdori-${numericCharacterId}`);
        if (!options.keepPackages) await rm(packageRoot, { recursive: true, force: true });
        finished += 1;
        console.log(`[${finished}/${tasks.length}] uploaded ${model}`);
      } catch (error) {
        if (error instanceof BestdoriAssetUnavailableError) {
          await appendCheckpoint({
            model,
            server,
            status: 'skipped',
            publishedAt: new Date().toISOString(),
            reason: error.message,
          });
          completed.add(model);
          await rm(packageRoot, { recursive: true, force: true });
          finished += 1;
          console.warn(`[${finished}/${tasks.length}] skipped unavailable ${model}`);
          return;
        }
        failures.push({ asset: model, error });
        console.error(`Failed ${model}:`, error instanceof Error ? error.message : error);
      }
    });
    await commitCatalogBatch(uploaded);
  }
  if (!failures.some(({ asset }) => !asset.startsWith('voice:'))) {
    await commitCatalogBatch([], [...pendingVoices.values()]);
  }
  if (failures.length > 0) {
    throw new Error(`${failures.length} model or voice package(s) failed; rerun the same command to resume.`);
  }
  await removeRemoteCatalogCharacters(supersededCharacterIds, {
    requestAttempts: options.attempts,
    requestTimeoutMs: options.timeoutMs,
    transferTimeoutMs: options.timeoutMs,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

/*
前台全量同步（推荐）：直接在终端显示进度，按 Ctrl+C 或关闭终端即可停止；再次运行会从
.cache/live2d-bestdori/*.jsonl checkpoint 继续，已验证的不可变 HF 对象不会重复上传。

LIVE2D_HF_S3_WRITE_ACCESS_KEY_ID=$(aws configure get aws_access_key_id --profile hf) \
LIVE2D_HF_S3_WRITE_SECRET_ACCESS_KEY=$(aws configure get aws_secret_access_key --profile hf) \
npm run sync:live2d-bestdori -- \
  --model-concurrency 8 \
  --file-concurrency 16 \
  --catalog-batch-size 100 \
  --attempts 8 \
  --timeout-ms 120000

并发峰值约为 --model-concurrency × --file-concurrency。Bestdori 当前模型通常包含几十到近百个
对象，8 × 16 在完成速度、远端压力和单模型故障隔离之间较均衡；不建议使用 24 × 16。

主要参数：
- --model-concurrency：同时构建/发布的模型包数量。
- --file-concurrency：每个模型内下载、上传和验证对象的并发数量。
- --catalog-batch-size：累计多少个模型后原子更新一次远端目录。
- --attempts：Bestdori 下载及 HF S3 请求各自的最大尝试次数。
- --timeout-ms：每次 Bestdori/HF 请求独立使用的超时，不是整批任务共用的总时限。
- --keep-packages：保留 .cache 下转换后的模型包，默认成功后删除以节省本地空间。
- --skip-audio：跳过角色日文语音包同步。
- --refresh-index：忽略本地源索引缓存，重新读取 Bestdori 目录。
- --plan-only：只生成同步计划，不上传对象或改写远端目录。
- --limit N / --models a,b：限制本轮处理数量，或只处理指定模型。
- --republish / --republish-voices：强制重新走模型或语音发布流程；日常断点续跑不需要。
*/
