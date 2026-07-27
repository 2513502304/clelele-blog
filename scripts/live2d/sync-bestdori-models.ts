import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Live2DInteraction } from '../../src/lib/live2d/types';
import { publishLive2DModel, removeRemoteCatalogCharacters } from './publish-models';

const BESTDORI_API = 'https://bestdori.com/api';
const BESTDORI_ASSETS = 'https://bestdori.com/assets';
const DEFAULT_SERVERS = ['jp', 'cn', 'en', 'kr', 'tw'] as const;
const CONVERTER_COMMIT = 'b6f6b1b29352e073f5987da8b06d6ae1e4b70ef6';

interface Options {
  workspace: string;
  modelConcurrency: number;
  fileConcurrency: number;
  attempts: number;
  timeoutMs: number;
  limit?: number;
  models: Set<string>;
  keepPackages: boolean;
  skipAudio: boolean;
  planOnly: boolean;
  refreshIndex: boolean;
  republish: boolean;
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

interface SourceIndex {
  acquiredAt: string;
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
    if (['--keep-packages', '--skip-audio', '--plan-only', '--refresh-index', '--republish'].includes(argument)) {
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
    attempts: integer(values.get('--attempts') ?? '5', '--attempts'),
    timeoutMs: integer(values.get('--timeout-ms') ?? '60000', '--timeout-ms'),
    limit: limit ? integer(limit, '--limit') : undefined,
    models: new Set((values.get('--models') ?? '').split(',').filter(Boolean)),
    keepPackages: flags.has('--keep-packages'),
    skipAudio: flags.has('--skip-audio'),
    planOnly: flags.has('--plan-only'),
    refreshIndex: flags.has('--refresh-index'),
    republish: flags.has('--republish'),
  };
}

async function request(url: string, options: Options, allowMissing = false): Promise<Response | null> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(options.timeoutMs) });
      if (allowMissing && response.status === 404) return null;
      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        if (!retryable) throw new Error(`${url} returned ${response.status}.`);
        throw new Error(`${url} temporarily returned ${response.status}.`);
      }
      return response;
    } catch (error) {
      lastError = error;
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
    if (cached) return cached;
  }
  const [characters, costumes, ...assetIndexes] = await Promise.all([
    fetchJson<SourceIndex['characters']>(`${BESTDORI_API}/characters/all.2.json`, options),
    fetchJson<SourceIndex['costumes']>(`${BESTDORI_API}/costumes/all.5.json`, options),
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
    assets: [...assets]
      .map(([model, server]) => ({ model, server }))
      .sort((left, right) => left.model.localeCompare(right.model)),
    characters,
    costumes,
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

async function downloadBundleFile(
  source: BundleFile,
  destination: string,
  server: string,
  options: Options,
  allowMissing = false,
): Promise<boolean> {
  if (await fileExists(destination)) return true;
  const url = `${BESTDORI_ASSETS}/${server}/${source.bundleName}_rip/${source.fileName}`;
  const response = await request(url, options, allowMissing);
  if (!response) return false;
  if (response.headers.get('content-type')?.startsWith('text/html')) throw new Error(`Bestdori returned HTML for ${url}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error(`Bestdori returned an empty file for ${url}.`);
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
  const build = await fetchJson<{ Base: BuildData }>(
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

async function attachDialogues(
  model: string,
  costumeEntry: [string, SourceIndex['costumes'][string]] | undefined,
  packageRoot: string,
  options: Options,
): Promise<{ interactions: Live2DInteraction[]; approvedAudio: Set<string> }> {
  const fallback = localized(costumeEntry?.[1].description, model).ja;
  if (!costumeEntry || options.skipAudio) {
    return { interactions: [{ area: 'head', dialogues: [{ text: fallback }] }], approvedAudio: new Set() };
  }
  const [costumeNumber] = costumeEntry;
  const apiCache = path.join(options.workspace, 'api-cache');
  const costume = await cachedJson<{ cards?: number[] }>(
    path.join(apiCache, 'costumes', `${costumeNumber}.json`),
    `${BESTDORI_API}/costumes/${costumeNumber}.json`,
    options,
  );
  const dialogues: Array<{ text: string; audio?: string }> = [];
  const approvedAudio = new Set<string>();
  for (const cardId of costume.cards ?? []) {
    const card = await cachedJson<{
      resourceSetName?: string;
      gachaText?: Array<string | null>;
      prefix?: Array<string | null>;
    }>(path.join(apiCache, 'cards', `${cardId}.json`), `${BESTDORI_API}/cards/${cardId}.json`, options);
    const text =
      card.gachaText?.[0]?.trim() || card.gachaText?.[1]?.trim() || card.prefix?.[0]?.trim() || card.prefix?.[1]?.trim();
    if (!text) continue;
    const relativeAudio = `audio/gacha-${cardId}.mp3`;
    if (card.resourceSetName) {
      const destination = path.join(packageRoot, relativeAudio);
      const response = await request(
        `${BESTDORI_ASSETS}/jp/sound/voice/gacha/operationspin_rip/${card.resourceSetName}.mp3`,
        options,
        true,
      );
      if (response) {
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, new Uint8Array(await response.arrayBuffer()));
        approvedAudio.add(relativeAudio);
        dialogues.push({ text, audio: relativeAudio });
        continue;
      }
    }
    dialogues.push({ text });
  }
  if (dialogues.length === 0) dialogues.push({ text: fallback });
  return { interactions: [{ area: 'head', dialogues }], approvedAudio };
}

async function completedModels(file: string): Promise<Set<string>> {
  const text = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  return new Set(
    text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { model: string; status: string })
      .filter((entry) => entry.status === 'published')
      .map((entry) => entry.model),
  );
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const source = await loadSourceIndex(options);
  const checkpoint = path.join(options.workspace, 'manifest.jsonl');
  const completed = await completedModels(checkpoint);
  const costumesByAsset = new Map(
    Object.entries(source.costumes)
      .filter((entry) => entry[1].assetBundleName)
      .map((entry) => [entry[1].assetBundleName, entry] as const),
  );
  let tasks = source.assets.filter(({ model }) => {
    const requested = options.models.size === 0 || options.models.has(model);
    return requested && (options.republish || !completed.has(model));
  });
  if (options.limit) tasks = tasks.slice(0, options.limit);
  console.log(`Bestdori index: ${source.assets.length} renderable model(s); ${tasks.length} pending in this run.`);
  if (options.planOnly || tasks.length === 0) return;

  await mkdir(path.dirname(checkpoint), { recursive: true });
  const failures: Array<{ model: string; error: unknown }> = [];
  const supersededCharacterIds = new Set<string>();
  let finished = 0;
  let checkpointTail = Promise.resolve();
  await runPool(tasks, options.modelConcurrency, async ({ model, server }) => {
    const numericCharacterId = characterIdForModel(model);
    if (!numericCharacterId) {
      failures.push({ model, error: new Error('Model name does not contain a Bestdori character id.') });
      return;
    }
    const packageRoot = path.join(options.workspace, 'packages', model);
    try {
      await buildPackage(model, server, packageRoot, options);
      const costumeEntry = costumesByAsset.get(model);
      const { interactions, approvedAudio } = await attachDialogues(model, costumeEntry, packageRoot, options);
      const character = source.characters[numericCharacterId];
      const result = await publishLive2DModel(
        {
          packageRoot,
          characterId: catalogCharacterId(numericCharacterId),
          characterLabels: localized(character?.characterName, `Bestdori ${numericCharacterId}`),
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
          approvedAudio,
          dryRun: false,
          replace: true,
          replaceInteractions: true,
        },
        interactions,
      );
      checkpointTail = checkpointTail.then(() =>
        appendFile(
          checkpoint,
          `${JSON.stringify({ model, server, status: 'published', releaseId: result.releaseId, publishedAt: new Date().toISOString() })}\n`,
        ),
      );
      await checkpointTail;
      if (bootstrapCharacterIds.has(numericCharacterId)) supersededCharacterIds.add(`bestdori-${numericCharacterId}`);
      if (!options.keepPackages) await rm(packageRoot, { recursive: true, force: true });
      finished += 1;
      console.log(`[${finished}/${tasks.length}] completed ${model}`);
    } catch (error) {
      failures.push({ model, error });
      console.error(`Failed ${model}:`, error instanceof Error ? error.message : error);
    }
  });
  if (failures.length > 0) {
    throw new Error(`${failures.length} model(s) failed; rerun the same command to resume.`);
  }
  await removeRemoteCatalogCharacters(supersededCharacterIds);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

// LIVE2D_HF_S3_WRITE_ACCESS_KEY_ID=$(aws configure get aws_access_key_id --profile hf) LIVE2D_HF_S3_WRITE_SECRET_ACCESS_KEY=$(aws configure get aws_secret_access_key --profile hf) npm run sync:live2d-bestdori -- --model-concurrency 3 --file-concurrency 16
